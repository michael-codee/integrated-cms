import datetime

import django_filters
from django.http import HttpResponse
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from drf_spectacular.types import OpenApiTypes
from rest_framework import permissions, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import RoleAssignment
from apps.audit import services as audit
from apps.audit.models import AuditLog
from apps.core import scoping
from apps.core.exports import Column, ExportMeta, ExportMixin, export_response
from apps.core.views import ScopedModelViewSet
from apps.members.filters import WithinUnitFilter
from apps.organization.models import OrgUnit

from . import periods, services
from .models import ReportSubmission, ReportTemplate
from .pdf import render_report
from .serializers import ReportSubmissionSerializer, ReportTemplateSerializer, ReviewSerializer


class TemplateViewSet(viewsets.ModelViewSet):
    """Report templates: readable by anyone who works with reports, editable with settings.edit."""

    serializer_class = ReportTemplateSerializer
    queryset = ReportTemplate.objects.all()
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = []
    pagination_class = None

    def check_permissions(self, request):
        super().check_permissions(request)
        perm = "reports.view" if request.method in permissions.SAFE_METHODS else "settings.edit"
        if not scoping.has_perm_anywhere(request.user, perm):
            raise PermissionDenied(f"You need '{perm}'.")

    def perform_destroy(self, instance):
        if instance.submissions.exists():
            raise ValidationError({"detail": "Reports have been submitted with this template. Deactivate it instead."})
        instance.delete()


class SubmissionFilter(django_filters.FilterSet):
    org_unit = WithinUnitFilter()
    period_from = django_filters.DateFilter(field_name="period_start", lookup_expr="gte")
    period_to = django_filters.DateFilter(field_name="period_start", lookup_expr="lte")
    status = django_filters.MultipleChoiceFilter(choices=ReportSubmission.Status.choices)

    class Meta:
        model = ReportSubmission
        fields = ["template", "status", "period_start"]


class SubmissionViewSet(ExportMixin, ScopedModelViewSet):
    module = "reports"
    serializer_class = ReportSubmissionSerializer
    filterset_class = SubmissionFilter
    ordering_fields = ["period_start", "submitted_at"]
    queryset = ReportSubmission.objects.select_related("template", "org_unit__parent", "submitted_by", "reviewed_by")
    action_permissions = {"submit": "submit", "review": "view", "figures": "view", "pdf": None, "awaiting": "view",
                          "export": None}
    export_title = "Report submissions"
    export_columns = [
        Column("template.name", "Report", 22), Column("org_unit.name", "Unit", 22), Column("period_start", "Period", 11),
        Column("status", "Status", 11), Column("submitted_at", "Submitted", 16), Column("submitted_by.full_name", "By", 18),
        Column("reviewed_by.full_name", "Reviewed by", 18),
    ]

    def check_editable(self, instance):
        if instance.status in (ReportSubmission.Status.SUBMITTED, ReportSubmission.Status.APPROVED):
            raise ValidationError({"detail": "Submitted reports cannot be changed or deleted."})

    @action(detail=True, methods=["get"])
    def figures(self, request, pk=None):
        """Live figures for a draft (submitted reports keep the figures frozen at submission)."""
        r = self.get_object()
        if r.status in (ReportSubmission.Status.SUBMITTED, ReportSubmission.Status.APPROVED):
            return Response({"live": False, "figures": r.figures})
        return Response({"live": True, "figures": services.compute_figures(r.template, r.org_unit, r.period_start,
                                                                           r.period_end)})

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        r = self.get_object()
        self.require("submit", r.org_unit)
        return Response(self.get_serializer(services.submit(r, request.user)).data)

    @extend_schema(request=ReviewSerializer)
    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        s = ReviewSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        r = services.review(self.get_object(), request.user, s.validated_data["accept"], s.validated_data["comment"])
        return Response(self.get_serializer(r).data)

    @action(detail=False, methods=["get"])
    def awaiting(self, request):
        """Reports submitted by units below and waiting for this user's review."""
        qs = self.scope(self.get_queryset(), "reports.approve").filter(status=ReportSubmission.Status.SUBMITTED)
        rows = [r for r in qs[:300] if services.can_review(request.user, r)]
        return Response(self.get_serializer(rows, many=True).data)

    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        r = self.get_object()
        if not scoping.can(request.user, "reports.print", r.org_unit):
            raise PermissionDenied("You do not have 'reports.print' permission for this unit.")
        figures = r.figures if r.status in ("submitted", "approved") else services.compute_figures(
            r.template, r.org_unit, r.period_start, r.period_end)
        content = render_report(r, figures, request.user)
        audit.record(AuditLog.Action.PRINT, instance=r)
        response = HttpResponse(content, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="report-{r.org_unit.code}-{r.period_start:%Y-%m}.pdf"'
        response["Access-Control-Expose-Headers"] = "Content-Disposition"
        return response


def _period_from_request(template, request):
    raw = request.query_params.get("period_start")
    if raw:
        try:
            day = datetime.date.fromisoformat(raw)
        except ValueError as exc:
            raise ValidationError({"period_start": "Use YYYY-MM-DD."}) from exc
        return periods.period_containing(template.frequency, day)
    return periods.previous_period(template.frequency, timezone.localdate())


class ComplianceView(APIView):
    """``GET /api/reports/compliance/?template=<id>&period_start=YYYY-MM-DD[&file_format=pdf|xlsx|csv]``"""

    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        template = ReportTemplate.objects.filter(pk=request.query_params.get("template")).first() \
            if request.query_params.get("template") else ReportTemplate.objects.filter(is_active=True).first()
        if template is None:
            raise ValidationError({"template": "Choose a report template."})
        start, end = _period_from_request(template, request)
        data = services.compliance(request.user, template, start, end)
        if data is None:
            raise PermissionDenied("You do not have access to reports.")
        fmt = request.query_params.get("file_format")
        if fmt:
            perm = "reports.print" if fmt == "pdf" else "reports.export"
            if not scoping.has_perm_anywhere(request.user, perm):
                raise PermissionDenied(f"You do not have '{perm}' permission.")
            status_label = {"missing": "Not started", "draft": "Draft", "returned": "Returned", "submitted": "Submitted",
                            "approved": "Accepted"}
            rows = [{**r, "status_label": status_label[r["status"]] + (" (overdue)" if r["overdue"] else "")
                     + (" (late)" if r["submitted_late"] else "")} for r in data["rows"]]
            columns = [Column("org_unit_name", "Unit", 28), Column("parent_name", "Under", 24),
                       Column("status_label", "Status", 22), Column("submitted_at", "Submitted", 16)]
            meta = ExportMeta(title=f"Reporting compliance — {template.name}", period=data["period"]["label"],
                              prepared_by=request.user.full_name,
                              summary=[("Expected", data["expected"]), ("Submitted", f"{data['rate'] or 0}%"),
                                       ("On time", f"{data['on_time_rate'] or 0}%")])
            audit.record(AuditLog.Action.EXPORT, entity=meta.title, message=f"{fmt.upper()} · {len(rows)} rows")
            return export_response(fmt, columns, [_Row(r) for r in rows], meta)
        data["periods"] = [{"start": s, "label": periods.label(template.frequency, s)}
                           for s, _ in periods.recent_periods(template.frequency, timezone.localdate(), 12)]
        return Response(data)


class _Row(dict):
    """Lets the export Column resolve dict keys like attributes."""

    def __getattr__(self, item):
        try:
            return self[item]
        except KeyError as exc:
            raise AttributeError(item) from exc


class DueView(APIView):
    """Reports the signed-in user's own units owe for the most recent ended period of each template."""

    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(due_reports(request.user))


def due_reports(user):
    unit_ids = {a.org_unit_id for a in RoleAssignment.objects.current().filter(user=user, department_id__isnull=True)}
    units = [u for u in OrgUnit.objects.filter(pk__in=unit_ids, status="active")
             if scoping.can(user, "reports.create", u)]
    today = timezone.localdate()
    out = []
    for unit in units:
        for t in services.templates_for_unit(unit):
            start, end = periods.previous_period(t.frequency, today)
            sub = ReportSubmission.objects.filter(template=t, org_unit=unit, period_start=start).first()
            if sub and sub.status in ("submitted", "approved"):
                continue
            due = services.due_date(t, end)
            out.append({"template": str(t.pk), "template_name": t.name, "org_unit": str(unit.pk),
                        "org_unit_name": unit.name, "period_start": start, "period_end": end,
                        "period_label": periods.label(t.frequency, start), "due": due, "overdue": today > due,
                        "submission": str(sub.pk) if sub else None, "status": sub.status if sub else "missing"})
    return out
