import django_filters
from django.db.models import Q
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core import scoping
from apps.core.exports import Column, ExportMixin
from apps.core.views import ScopedModelViewSet
from apps.members.filters import WithinUnitFilter

from . import services
from .models import Program
from .serializers import ProgramDecisionSerializer, ProgramSerializer, ProgramStatusSerializer


class ProgramFilter(django_filters.FilterSet):
    org_unit = WithinUnitFilter()
    start = django_filters.IsoDateTimeFilter(field_name="ends_at", lookup_expr="gte")
    end = django_filters.IsoDateTimeFilter(field_name="starts_at", lookup_expr="lte")
    date_from = django_filters.DateFilter(field_name="starts_at__date", lookup_expr="gte")
    date_to = django_filters.DateFilter(field_name="starts_at__date", lookup_expr="lte")
    status = django_filters.MultipleChoiceFilter(choices=Program.Status.choices)

    class Meta:
        model = Program
        fields = ["category", "department", "status", "is_public"]


class ProgramViewSet(ExportMixin, ScopedModelViewSet):
    module = "programs"
    scope_department_field = "department_id"
    serializer_class = ProgramSerializer
    filterset_class = ProgramFilter
    search_fields = ["title", "venue", "coordinator", "speakers"]
    ordering_fields = ["starts_at", "title"]
    pagination_class = None
    queryset = Program.objects.select_related("org_unit", "category", "department", "created_by", "decided_by") \
        .prefetch_related("attendance_records")
    action_permissions = {"submit": "edit", "decide": "view", "set_status": "edit", "export": None}
    export_title = "Programs and events"
    export_columns = [
        Column("starts_at", "Starts", 16), Column("title", "Program", 28), Column("category.name", "Category", 16),
        Column("org_unit.name", "Unit", 20), Column("venue", "Venue", 18), Column("status", "Status", 12),
        Column("expected_attendance", "Expected", 9, numeric=True), Column("salvations", "Salvations", 9, numeric=True),
    ]

    def scope(self, queryset, perm=None):
        perm = perm or "programs.view"
        q = scoping.scope_q(self.request.user, perm, "org_unit__path", "department_id")
        if q is None:
            return queryset.none()
        return queryset.filter(q | Q(is_public=True))

    def list(self, request, *args, **kwargs):
        qs = self.filter_queryset(self.get_queryset())
        if not any(k in request.query_params for k in ("start", "end", "date_from", "date_to")):
            qs = qs[:500]
        return Response(self.get_serializer(qs, many=True).data)

    def _department_of(self, instance_or_data):
        if isinstance(instance_or_data, dict):
            d = instance_or_data.get("department")
            return getattr(d, "pk", d)
        return instance_or_data.department_id

    def check_editable(self, instance):
        if instance.org_unit_id and not scoping.can(self.request.user, "programs.edit", instance.org_unit,
                                                    instance.department_id):
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied("Public programs can only be changed by the organising unit.")

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        p = self.get_object()
        self.require("edit", p.org_unit, p.department_id)
        return Response(self.get_serializer(services.submit(p, request.user)).data)

    @extend_schema(request=ProgramDecisionSerializer)
    @action(detail=True, methods=["post"])
    def decide(self, request, pk=None):
        s = ProgramDecisionSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        p = services.decide(self.get_object(), request.user, s.validated_data["approve"], s.validated_data["comment"])
        return Response(self.get_serializer(p).data)

    @extend_schema(request=ProgramStatusSerializer)
    @action(detail=True, methods=["post"], url_path="status")
    def set_status(self, request, pk=None):
        p = self.get_object()
        self.require("edit", p.org_unit, p.department_id)
        s = ProgramStatusSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        p = services.set_status(p, request.user, s.validated_data["status"], s.validated_data["comment"])
        return Response(self.get_serializer(p).data)
