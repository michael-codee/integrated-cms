import datetime

from django.db.models import Prefetch, Sum
from django.db.models.functions import TruncMonth
from django.http import HttpResponse
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from drf_spectacular.types import OpenApiTypes
from rest_framework import mixins, permissions, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit import services as audit
from apps.audit.models import AuditLog
from apps.configuration.models import FinancialYear
from apps.core import scoping
from apps.core.exceptions import BusinessRuleError
from apps.core.exports import Column, ExportMixin
from apps.core.views import ModulePermission, ScopedModelViewSet, ScopedViewMixin
from apps.organization.models import OrgUnit

from . import services
from .filters import BudgetFilter, TransactionFilter
from .models import Account, ApprovalPolicy, Budget, Reconciliation, Transaction
from .receipts import render_receipt
from .serializers import (AccountSerializer, ApprovalPolicySerializer, BudgetSerializer, DecisionSerializer,
                          ReasonSerializer, ReconciliationSerializer, TransactionListSerializer,
                          TransactionSerializer)


class AccountViewSet(ScopedModelViewSet):
    module = "finance"
    queryset = Account.objects.select_related("org_unit", "currency")
    serializer_class = AccountSerializer
    filterset_fields = ["org_unit", "kind", "is_active", "currency"]
    search_fields = ["name", "institution", "account_number"]
    action_permissions = {"statement": "view"}

    def perform_destroy(self, instance):
        if instance.transactions.exists():
            raise BusinessRuleError("This account has transactions. Mark it inactive instead of deleting it.")
        super().perform_destroy(instance)


class ApprovalPolicyViewSet(ScopedViewMixin, viewsets.ModelViewSet):
    """Approval thresholds and levels. Readable by finance users; editable by settings administrators."""

    module = "settings"
    queryset = ApprovalPolicy.objects.prefetch_related("steps")
    serializer_class = ApprovalPolicySerializer
    permission_classes = [permissions.IsAuthenticated, ModulePermission]
    pagination_class = None
    filterset_fields = ["applies_to", "is_active"]

    def get_required_permission(self):
        if self.action in ("list", "retrieve"):
            return "finance.view"
        return "settings.edit"

    def _audit(self, action_, instance, before=None):
        after = audit.snapshot(instance)
        after["steps"] = [f"{s.order}:{s.level}:{s.label}" for s in instance.steps.all()]
        audit.record(action_, instance=instance, changes=audit.diff(before or {}, after))

    def perform_create(self, serializer):
        self._audit(AuditLog.Action.CREATE, serializer.save(created_by=self.request.user))

    def perform_update(self, serializer):
        before = audit.snapshot(serializer.instance)
        before["steps"] = [f"{s.order}:{s.level}:{s.label}" for s in serializer.instance.steps.all()]
        self._audit(AuditLog.Action.UPDATE, serializer.save(updated_by=self.request.user), before)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])
        audit.record(AuditLog.Action.UPDATE, instance=instance, message="Policy deactivated")


class TransactionViewSet(ExportMixin, ScopedModelViewSet):
    module = "finance"
    queryset = Transaction.objects.select_related(
        "org_unit", "account", "category", "currency", "financial_year", "member", "created_by", "submitted_by",
        "reversal_of",
    )
    filterset_class = TransactionFilter
    search_fields = ["reference", "party", "description", "external_ref", "member__last_name",
                     "member__membership_no"]
    ordering_fields = ["transaction_date", "amount", "created_at", "reference"]
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    action_permissions = {"submit": "submit", "approve": "approve", "reject": "view", "reverse": "create",
                          "receipt": "print", "awaiting": "approve", "export": None}
    export_title = "Finance transactions"
    export_columns = [
        Column("reference", "Reference", 18), Column("transaction_date", "Date", 12),
        Column("kind", "Type", 9), Column("org_unit.name", "Unit", 22), Column("category.name", "Category", 20),
        Column("party", "Received from / paid to", 22), Column("account.name", "Account", 16),
        Column("amount", "Amount", 14, numeric=True), Column("currency_id", "Cur.", 6), Column("status", "Status", 10),
    ]

    def get_serializer_class(self):
        return TransactionListSerializer if self.action in ("list", "awaiting") else TransactionSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action not in ("list", "export", "awaiting"):
            qs = qs.prefetch_related("approvals__created_by")
        return qs

    def get_export_summary(self, queryset):
        t = services.totals(queryset)
        return [("Entries", f"{queryset.count():,}"), ("Income (posted)", f"{t['income']:,.2f}"),
                ("Expenditure (posted)", f"{t['expense']:,.2f}"), ("Net", f"{t['net']:,.2f}")]

    def perform_create(self, serializer):
        unit = serializer.validated_data["org_unit"]
        self.require("create", unit)
        account = serializer.validated_data["account"]
        if account.org_unit_id != unit.pk:
            raise BusinessRuleError("The account must belong to the same unit as the transaction.")
        super().perform_create(serializer)

    def check_editable(self, instance):
        if instance.status != Transaction.Status.DRAFT:
            raise BusinessRuleError("Only drafts can be changed or deleted. Approved entries are corrected by reversal.",
                                    code="locked", status_code=409)

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        txn = services.submit(self.get_object(), request.user)
        return Response(TransactionSerializer(txn, context=self.get_serializer_context()).data)

    @extend_schema(request=DecisionSerializer)
    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        s = DecisionSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        txn = services.approve(self.get_object(), request.user, s.validated_data["comment"])
        return Response(TransactionSerializer(Transaction.objects.get(pk=txn.pk),
                                              context=self.get_serializer_context()).data)

    @extend_schema(request=DecisionSerializer)
    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        s = DecisionSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        txn = services.reject(self.get_object(), request.user, s.validated_data["comment"],
                              s.validated_data["return_to_draft"])
        return Response(TransactionSerializer(Transaction.objects.get(pk=txn.pk),
                                              context=self.get_serializer_context()).data)

    @extend_schema(request=ReasonSerializer)
    @action(detail=True, methods=["post"])
    def reverse(self, request, pk=None):
        s = ReasonSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        rev = services.request_reversal(self.get_object(), request.user, s.validated_data["reason"])
        return Response(TransactionSerializer(rev, context=self.get_serializer_context()).data, status=201)

    @action(detail=True)
    def receipt(self, request, pk=None):
        txn = self.get_object()
        if txn.kind != Transaction.Kind.INCOME or txn.status not in services.POSTED or txn.reversal_of_id:
            raise BusinessRuleError("Receipts are issued only for approved income.")
        if not scoping.can(request.user, "finance.print", txn.org_unit):
            raise PermissionDenied("You cannot print receipts for this unit.")
        audit.record(AuditLog.Action.PRINT, instance=txn, message=f"Receipt {txn.reference}")
        response = HttpResponse(render_receipt(txn, request.user), content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="receipt-{txn.reference}.pdf"'
        response["Access-Control-Expose-Headers"] = "Content-Disposition"
        return response

    @action(detail=False)
    def awaiting(self, request):
        items = services.awaiting_user(request.user, self.filter_queryset(self.get_queryset()))
        return Response(TransactionListSerializer(items, many=True).data)


class BudgetViewSet(ScopedModelViewSet):
    module = "budgets"
    queryset = Budget.objects.select_related("org_unit", "financial_year", "submitted_by", "decided_by") \
        .prefetch_related("lines__category")
    serializer_class = BudgetSerializer
    filterset_class = BudgetFilter
    search_fields = ["name", "org_unit__name"]
    action_permissions = {"submit": "submit", "decide": "view", "performance": "view"}

    def check_editable(self, instance):
        if instance.status in (Budget.Status.SUBMITTED, Budget.Status.APPROVED):
            raise BusinessRuleError("Submitted or approved budgets cannot be changed.", code="locked", status_code=409)

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        budget = self.get_object()
        self.require("submit", budget.org_unit)
        services.submit_budget(budget, request.user)
        return Response(self.get_serializer(self.get_queryset().get(pk=budget.pk)).data)

    @extend_schema(request=DecisionSerializer)
    @action(detail=True, methods=["post"])
    def decide(self, request, pk=None):
        approve = request.data.get("decision") == "approve"
        services.decide_budget(self.get_object(), request.user, approve, request.data.get("comment", ""))
        return Response(self.get_serializer(self.get_queryset().get(pk=pk)).data)

    @action(detail=True)
    def performance(self, request, pk=None):
        return Response(services.budget_vs_actual(self.get_object()))


class ReconciliationViewSet(ScopedViewMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                            mixins.CreateModelMixin, viewsets.GenericViewSet):
    module = "finance"
    scope_path_field = "account__org_unit__path"
    permission_classes = [permissions.IsAuthenticated, ModulePermission]
    queryset = Reconciliation.objects.select_related("account__org_unit", "created_by")
    serializer_class = ReconciliationSerializer
    filterset_fields = ["account"]

    def get_queryset(self):
        return self.scope(super().get_queryset())

    def perform_create(self, serializer):
        account = serializer.validated_data["account"]
        self.require("edit", account.org_unit)
        as_of = serializer.validated_data["as_of"]
        if as_of > timezone.localdate():
            raise ValidationError({"as_of": "Reconciliation date cannot be in the future."})
        book = services.account_balance(account, as_of)
        rec = serializer.save(book_balance=book, difference=serializer.validated_data["statement_balance"] - book,
                              created_by=self.request.user)
        audit.record(AuditLog.Action.CREATE, instance=rec, message=f"{account.name}: difference {rec.difference}")


def _period(request):
    q = request.query_params
    fy = None
    if q.get("financial_year"):
        fy = FinancialYear.objects.filter(pk=q["financial_year"]).first()
    start = q.get("from") or q.get("date_from")
    end = q.get("to") or q.get("date_to")
    if start or end:
        try:
            start = datetime.date.fromisoformat(start) if start else datetime.date(1900, 1, 1)
            end = datetime.date.fromisoformat(end) if end else timezone.localdate()
        except ValueError as exc:
            raise ValidationError({"detail": "Dates must be YYYY-MM-DD."}) from exc
        return start, end, None
    fy = fy or FinancialYear.for_date(timezone.localdate())
    return fy.start_date, fy.end_date, fy


def finance_summary(user, unit=None, start=None, end=None):
    """Income & expenditure statement figures within the user's jurisdiction."""
    base = scoping.filter_queryset(Transaction.objects.all(), user, "finance.view")
    if unit is not None:
        base = base.filter(org_unit__path__startswith=unit.path)
    period = base.filter(transaction_date__gte=start, transaction_date__lte=end)
    posted = services.posted(period)
    net = services.net_amount_expr()
    by_category = list(posted.values("kind", "category__name").annotate(total=Sum(net)).order_by("kind", "-total"))
    by_month = {}
    for row in posted.annotate(m=TruncMonth("transaction_date")).values("m", "kind").annotate(total=Sum(net)):
        key = row["m"].strftime("%Y-%m")
        by_month.setdefault(key, {"month": key, "income": 0, "expense": 0})[row["kind"]] = row["total"]
    # Roll up to the next level below the selected unit (or the user's top units).
    parents = [unit] if unit else list(scoping.root_scope_units(user, "finance.view"))
    if len(parents) == 1:
        children = list(OrgUnit.objects.filter(parent=parents[0]).order_by("name")) or parents
    else:
        children = parents
    by_unit = []
    for child in children:
        t = services.totals(period.filter(org_unit__path__startswith=child.path))
        if t["income"] or t["expense"]:
            by_unit.append({"id": str(child.id), "name": child.name, "unit_type": child.unit_type, **t})
    pending = period.filter(status=Transaction.Status.SUBMITTED)
    accounts_qs = scoping.filter_queryset(Account.objects.filter(is_active=True), user, "finance.view") \
        .select_related("org_unit")
    if unit is not None:
        accounts_qs = accounts_qs.filter(org_unit__path__startswith=unit.path)
    accounts = [{"id": str(a.id), "name": a.name, "org_unit_name": a.org_unit.name, "currency": a.currency_id,
                 "kind": a.kind, "balance": services.account_balance(a)} for a in accounts_qs[:200]]
    return {
        "period": {"from": start, "to": end},
        "totals": services.totals(period),
        "by_category": by_category,
        "by_month": sorted(by_month.values(), key=lambda r: r["month"]),
        "by_unit": by_unit,
        "pending": {"count": pending.count(),
                    "amount": pending.aggregate(s=Sum("amount"))["s"] or 0},
        "accounts": accounts,
    }


class FinanceSummaryView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        if not scoping.has_perm_anywhere(request.user, "finance.view"):
            raise PermissionDenied("You do not have finance access.")
        unit = None
        if request.query_params.get("org_unit"):
            unit = OrgUnit.objects.filter(pk=request.query_params["org_unit"]).first()
            if unit is None or not scoping.can(request.user, "finance.view", unit):
                raise PermissionDenied("That unit is outside your jurisdiction.")
        start, end, fy = _period(request)
        data = finance_summary(request.user, unit, start, end)
        data["financial_year"] = fy.name if fy else None
        return Response(data)
