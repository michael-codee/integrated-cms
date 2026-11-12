from django.db.models import Prefetch, Q
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from apps.core import scoping
from apps.core.exports import Column, ExportMixin
from apps.core.views import ScopedModelViewSet, ScopedViewMixin
from apps.organization.models import OrgUnit

from . import services
from .filters import MemberFilter, WithinUnitFilter
from .models import BaptismRecord, Member, MemberTransfer
from .serializers import (BaptismSerializer, DecisionSerializer, MemberListSerializer, MemberSerializer,
                          MembershipHistorySerializer, StatusChangeSerializer, TransferSerializer)
from .stats import scoped_member_stats


class MemberViewSet(ExportMixin, ScopedModelViewSet):
    """Membership register. Every query is limited to the user's jurisdiction."""

    module = "members"
    queryset = Member.objects.select_related("org_unit", "category")
    filterset_class = MemberFilter
    search_fields = ["first_name", "middle_name", "last_name", "membership_no", "phone", "email"]
    ordering_fields = ["last_name", "first_name", "joined_on", "membership_no", "created_at", "date_of_birth"]
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    action_permissions = {"history": "view", "stats": "view", "set_status": "edit", "baptize": "edit",
                          "check_duplicates": "view", "export": None}
    export_title = "Membership register"
    export_columns = [
        Column("membership_no", "Membership No.", 16),
        Column("full_name", "Full name", 26),
        Column("gender", "Gender", 9),
        Column("age", "Age", 6, numeric=False),
        Column("phone", "Phone", 15),
        Column("org_unit.name", "Branch", 22),
        Column("category.name", "Category", 16),
        Column("status", "Status", 10),
        Column("baptism_status", "Baptism", 12),
        Column("joined_on", "Joined", 12),
    ]

    def get_serializer_class(self):
        return MemberListSerializer if self.action == "list" else MemberSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action in ("list", "retrieve"):
            qs = qs.prefetch_related(Prefetch("transfers", queryset=MemberTransfer.objects.filter(status="pending")
                                              .select_related("to_unit"), to_attr="_pending_transfers"))
        return qs

    def get_export_summary(self, queryset):
        total = queryset.count()
        active = queryset.filter(status="active").count()
        male = queryset.filter(gender="male").count()
        baptized = queryset.filter(baptism_status="baptized").count()
        return [("Members", f"{total:,}"), ("Active", f"{active:,}"), ("Male", f"{male:,}"),
                ("Female", f"{total - male:,}"), ("Baptized", f"{baptized:,}")]

    def after_create(self, instance):
        services.on_registered(instance, self.request.user)
        from apps.core.events import publish

        publish("member.registered", org_unit=instance.org_unit, actor=self.request.user,
                title=f"New member: {instance.full_name}", link=f"/members/{instance.pk}")

    def perform_update(self, serializer):
        before = {k: getattr(serializer.instance, k) for k in services.TRACKED}
        super().perform_update(serializer)
        services.on_updated(serializer.instance, before, self.request.user)

    @action(detail=True)
    def history(self, request, pk=None):
        member = self.get_object()
        qs = member.history.select_related("created_by", "org_unit")
        return Response(MembershipHistorySerializer(qs, many=True).data)

    @extend_schema(request=StatusChangeSerializer)
    @action(detail=True, methods=["post"], url_path="status")
    def set_status(self, request, pk=None):
        member = self.get_object()
        self.require("edit", member.org_unit)
        s = StatusChangeSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        services.change_status(member, s.validated_data["status"], request.user, s.validated_data["reason"],
                               s.validated_data.get("effective_date"))
        return Response(MemberSerializer(member, context={"request": request}).data)

    @extend_schema(request=BaptismSerializer, responses=BaptismSerializer)
    @action(detail=True, methods=["post"])
    def baptize(self, request, pk=None):
        member = self.get_object()
        self.require("edit", member.org_unit)
        s = BaptismSerializer(data={**request.data, "member": str(member.pk)})
        s.is_valid(raise_exception=True)
        data = s.validated_data
        rec = services.record_baptism(member, request.user, date=data["date"], location=data.get("location", ""),
                                      officiated_by=data.get("officiated_by", ""),
                                      certificate_no=data.get("certificate_no", ""), notes=data.get("notes", ""),
                                      record_id=data.get("id"))
        return Response(BaptismSerializer(rec).data, status=201)

    @action(detail=False, methods=["get"], url_path="check-duplicates")
    def check_duplicates(self, request):
        first, last = request.query_params.get("first_name", ""), request.query_params.get("last_name", "")
        if not first or not last:
            return Response([])
        dups = services.find_possible_duplicates(
            first_name=first, last_name=last, date_of_birth=request.query_params.get("date_of_birth") or None,
            phone=request.query_params.get("phone", ""), exclude=request.query_params.get("exclude"))
        # Only reveal names inside the user's jurisdiction; elsewhere just say a match exists.
        visible = self.scope(dups)
        return Response({
            "matches": MemberListSerializer(visible[:5], many=True, context={"request": request}).data,
            "outside_jurisdiction": dups.count() - visible.count(),
        })

    @action(detail=False)
    def stats(self, request):
        unit_id = request.query_params.get("org_unit")
        unit = OrgUnit.objects.filter(pk=unit_id).first() if unit_id else None
        return Response(scoped_member_stats(request.user, unit))


class BaptismViewSet(ExportMixin, ScopedViewMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                     viewsets.GenericViewSet):
    module = "members"
    serializer_class = BaptismSerializer
    queryset = BaptismRecord.objects.select_related("member", "org_unit")
    filterset_fields = {"date": ["gte", "lte"], "member": ["exact"]}
    search_fields = ["member__first_name", "member__last_name", "location", "certificate_no"]
    export_title = "Baptism records"
    export_columns = [Column("member.membership_no", "Membership No.", 16), Column("member.full_name", "Name", 26),
                      Column("date", "Date", 12), Column("location", "Location", 20),
                      Column("officiated_by", "Officiated by", 20), Column("org_unit.name", "Branch", 20),
                      Column("certificate_no", "Certificate", 14)]

    def get_queryset(self):
        qs = self.scope(super().get_queryset())
        unit = self.request.query_params.get("org_unit")
        if unit:
            qs = WithinUnitFilter().filter(qs, unit)
        return qs


class TransferViewSet(ScopedViewMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                      viewsets.GenericViewSet):
    """Transfers are visible to both the sending and the receiving side."""

    module = "members"
    serializer_class = TransferSerializer
    filterset_fields = ["status", "member"]
    search_fields = ["member__first_name", "member__last_name", "member__membership_no"]
    action_permissions = {"create": "edit", "decide": "approve", "cancel": "edit"}

    def get_queryset(self):
        user = self.request.user
        out_q = scoping.scope_q(user, "members.view", "org_unit__path")
        in_q = scoping.scope_q(user, "members.view", "to_unit__path")
        if out_q is None:
            return MemberTransfer.objects.none()
        qs = MemberTransfer.objects.filter(out_q | in_q).select_related(
            "member", "org_unit", "to_unit", "created_by", "decided_by")
        direction = self.request.query_params.get("direction")
        if direction == "incoming":
            approvable = scoping.scope_q(user, "members.approve", "to_unit__path")
            qs = qs.filter(approvable) if approvable is not None else qs.none()
        return qs

    def create(self, request, *args, **kwargs):
        s = self.get_serializer(data=request.data)
        s.is_valid(raise_exception=True)
        member = s.validated_data["member"]
        # The requester must be able to see and edit the member at the sending branch.
        if not Member.objects.filter(pk=member.pk).filter(
                scoping.scope_q(request.user, "members.edit") or Q(pk__in=[])).exists():
            raise PermissionDenied("You cannot transfer members outside your jurisdiction.")
        transfer = services.request_transfer(member, s.validated_data["to_unit"], request.user,
                                             s.validated_data.get("reason", ""),
                                             s.validated_data.get("effective_date"), s.validated_data.get("id"))
        return Response(self.get_serializer(transfer).data, status=201)

    @extend_schema(request=DecisionSerializer)
    @action(detail=True, methods=["post"])
    def decide(self, request, pk=None):
        transfer = self.get_object()
        s = DecisionSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        services.decide_transfer(transfer, request.user, s.validated_data["approve"], s.validated_data["note"])
        transfer.refresh_from_db()
        return Response(self.get_serializer(transfer).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        transfer = self.get_object()
        if not scoping.can(request.user, "members.edit", transfer.org_unit) and transfer.created_by_id != request.user.pk:
            raise PermissionDenied("Only the sending branch can cancel this transfer.")
        services.cancel_transfer(transfer, request.user)
        return Response(self.get_serializer(transfer).data)
