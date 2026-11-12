import django_filters
from django.db.models import Q
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, permissions, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core import scoping
from apps.core.exceptions import BusinessRuleError
from apps.core.exports import Column, ExportMixin
from apps.core.views import ModulePermission, ScopedModelViewSet, ScopedViewMixin
from apps.members.filters import WithinUnitFilter
from apps.organization.models import OrgUnit

from . import services
from .models import Asset, AssetDisposal, AssetMovement, MaintenanceRecord
from .serializers import (AssetDecisionSerializer, AssetListSerializer, AssetSerializer, DisposalSerializer,
                          MaintenanceSerializer, MovementSerializer)


class AssetFilter(django_filters.FilterSet):
    org_unit = WithinUnitFilter()
    on_register = django_filters.BooleanFilter(method="filter_on_register")
    acquired_from = django_filters.DateFilter(field_name="acquisition_date", lookup_expr="gte")
    acquired_to = django_filters.DateFilter(field_name="acquisition_date", lookup_expr="lte")

    class Meta:
        model = Asset
        fields = ["category", "condition", "status", "acquisition_method"]

    def filter_on_register(self, qs, name, value):
        return qs.exclude(status__in=services.CLOSED) if value else qs.filter(status__in=services.CLOSED)


class AssetViewSet(ExportMixin, ScopedModelViewSet):
    module = "assets"
    queryset = Asset.objects.select_related("category", "org_unit", "currency")
    filterset_class = AssetFilter
    search_fields = ["name", "asset_no", "serial_number", "registration_no", "location", "custodian"]
    ordering_fields = ["asset_no", "name", "acquisition_date", "cost", "condition"]
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    action_permissions = {"depreciation": "view", "history": "view", "transfer": "edit", "dispose": "edit",
                          "export": None}
    export_title = "Asset register"
    export_columns = [
        Column("asset_no", "Asset No.", 12), Column("name", "Asset", 24), Column("category.name", "Category", 18),
        Column("org_unit.name", "Unit", 20), Column("location", "Location", 16), Column("condition", "Condition", 10),
        Column("status", "Status", 10), Column("acquisition_date", "Acquired", 11),
        Column("cost", "Cost", 13, numeric=True), Column("book_value", "Book value", 13, numeric=True),
    ]

    def get_serializer_class(self):
        return AssetListSerializer if self.action in ("list",) else AssetSerializer

    def get_export_summary(self, queryset):
        rows = list(queryset)
        return [("Assets", f"{len(rows):,}"), ("Total cost", f"{sum(a.cost for a in rows):,.2f}"),
                ("Book value", f"{sum(a.book_value() for a in rows):,.2f}")]

    def perform_create(self, serializer):
        unit = serializer.validated_data["org_unit"]
        self.require("create", unit)
        from .models import next_asset_no

        serializer.validated_data["asset_no"] = next_asset_no()
        super().perform_create(serializer)

    def check_editable(self, instance):
        services.ensure_open(instance)

    def perform_destroy(self, instance):
        raise BusinessRuleError("Assets are never deleted. Propose a disposal (or write-off) instead.",
                                code="no_delete", status_code=409)

    @action(detail=True)
    def depreciation(self, request, pk=None):
        asset = self.get_object()
        return Response({"rate": asset.effective_rate, "book_value": asset.book_value(),
                         "schedule": asset.depreciation_schedule()})

    @action(detail=True)
    def history(self, request, pk=None):
        asset = self.get_object()
        ctx = self.get_serializer_context()
        return Response({
            "movements": MovementSerializer(asset.movements.select_related("from_unit", "to_unit", "created_by",
                                                                           "decided_by"), many=True, context=ctx).data,
            "maintenance": MaintenanceSerializer(asset.maintenance.select_related("created_by"), many=True).data,
            "disposals": DisposalSerializer(asset.disposals.select_related("created_by", "decided_by"), many=True,
                                            context=ctx).data,
        })


class MovementViewSet(ScopedViewMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                      viewsets.GenericViewSet):
    """Visible to the sending unit (assets.view) and to approvers at the receiving unit."""

    module = "assets"
    serializer_class = MovementSerializer
    permission_classes = [permissions.IsAuthenticated, ModulePermission]
    filterset_fields = ["status", "asset"]
    action_permissions = {"create": "edit", "decide": "view", "cancel": "edit"}

    def get_queryset(self):
        user = self.request.user
        qs_filter = Q(pk__in=[])
        for q in (scoping.scope_q(user, "assets.view", "from_unit__path"),
                  scoping.scope_q(user, "assets.approve", "to_unit__path")):
            if q is not None:
                qs_filter |= q
        qs = AssetMovement.objects.filter(qs_filter).select_related("asset", "from_unit", "to_unit", "created_by",
                                                                    "decided_by")
        if self.request.query_params.get("direction") == "incoming":
            q = scoping.scope_q(user, "assets.approve", "to_unit__path")
            qs = qs.filter(q) if q is not None else qs.none()
        return qs

    def create(self, request, *args, **kwargs):
        s = self.get_serializer(data=request.data)
        s.is_valid(raise_exception=True)
        asset = s.validated_data["asset"]
        if not scoping.can(request.user, "assets.edit", asset.org_unit):
            raise PermissionDenied("You cannot transfer assets outside your jurisdiction.")
        mv = services.request_movement(asset, s.validated_data["to_unit"], request.user, s.validated_data["reason"],
                                       s.validated_data.get("new_location", ""),
                                       s.validated_data.get("new_custodian", ""))
        return Response(self.get_serializer(mv).data, status=201)

    @extend_schema(request=AssetDecisionSerializer)
    @action(detail=True, methods=["post"])
    def decide(self, request, pk=None):
        s = AssetDecisionSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        mv = services.decide_movement(self.get_object(), request.user, s.validated_data["approve"],
                                      s.validated_data["comment"])
        return Response(self.get_serializer(mv).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        return Response(self.get_serializer(services.cancel_movement(self.get_object(), request.user)).data)


class MaintenanceViewSet(ScopedViewMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                         viewsets.GenericViewSet):
    module = "assets"
    serializer_class = MaintenanceSerializer
    permission_classes = [permissions.IsAuthenticated, ModulePermission]
    scope_path_field = "asset__org_unit__path"
    filterset_fields = ["asset", "kind"]
    action_permissions = {"create": "edit"}

    def get_queryset(self):
        return self.scope(MaintenanceRecord.objects.select_related("asset", "created_by"))

    def perform_create(self, serializer):
        asset = serializer.validated_data["asset"]
        self.require("edit", asset.org_unit)
        record = MaintenanceRecord(**serializer.validated_data)
        serializer.instance = services.record_maintenance(record, self.request.user)


class DisposalViewSet(ScopedViewMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                      viewsets.GenericViewSet):
    module = "assets"
    serializer_class = DisposalSerializer
    permission_classes = [permissions.IsAuthenticated, ModulePermission]
    scope_path_field = "asset__org_unit__path"
    filterset_fields = ["asset", "status", "method"]
    action_permissions = {"create": "edit", "decide": "view"}

    def get_queryset(self):
        return self.scope(AssetDisposal.objects.select_related("asset__org_unit__parent", "created_by", "decided_by"))

    def create(self, request, *args, **kwargs):
        s = self.get_serializer(data=request.data)
        s.is_valid(raise_exception=True)
        v = s.validated_data
        if not scoping.can(request.user, "assets.edit", v["asset"].org_unit):
            raise PermissionDenied("You cannot propose disposals for this unit.")
        d = services.request_disposal(v["asset"], request.user, v["method"], v["reason"], v.get("proposed_date"),
                                      v.get("proceeds"))
        return Response(self.get_serializer(d).data, status=201)

    @extend_schema(request=AssetDecisionSerializer)
    @action(detail=True, methods=["post"])
    def decide(self, request, pk=None):
        s = AssetDecisionSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = services.decide_disposal(self.get_object(), request.user, s.validated_data["approve"],
                                     s.validated_data["comment"])
        return Response(self.get_serializer(d).data)


class AssetSummaryView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        if not scoping.has_perm_anywhere(request.user, "assets.view"):
            raise PermissionDenied("You do not have access to the asset register.")
        unit = None
        if request.query_params.get("org_unit"):
            unit = OrgUnit.objects.filter(pk=request.query_params["org_unit"]).first()
            if unit is None or not scoping.can(request.user, "assets.view", unit):
                raise PermissionDenied("That unit is outside your jurisdiction.")
        return Response(services.asset_summary(request.user, unit))
