from django.db.models import Exists, OuterRef, Prefetch, Q, Subquery
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from apps.core import scoping
from apps.core.exports import Column, ExportMixin
from apps.core.views import ScopedModelViewSet, ScopedViewMixin
from apps.organization.models import OrgUnit

from . import services
from .filters import DiscipleshipRegisterFilter, MemberFilter, WithinUnitFilter
from .models import BaptismRecord, DiscipleshipClass, DiscipleshipCompletion, Member, MemberTransfer
from .serializers import (DISCIPLESHIP_CLASSES, BaptismSerializer, DecisionSerializer, DiscipleshipCompletionSerializer,
                          DiscipleshipRegisterSerializer, MemberListSerializer, RegisterDiscipleSerializer, MemberSerializer,
                          MembershipHistorySerializer, RemoveCompletionSerializer, StatusChangeSerializer,
                          TransferSerializer)
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
                          "discipleship": "edit", "check_duplicates": "view", "export": None}
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

    @extend_schema(request=DiscipleshipCompletionSerializer, responses=DiscipleshipCompletionSerializer)
    @action(detail=True, methods=["post"])
    def discipleship(self, request, pk=None):
        """Record that the member completed one of the three discipleship classes."""
        member = self.get_object()
        self.require("edit", member.org_unit)
        s = DiscipleshipCompletionSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        data = s.validated_data
        rec = services.record_class_completion(
            member, request.user, course=data["course"], completed_on=data["completed_on"],
            facilitator=data.get("facilitator", ""), certificate_no=data.get("certificate_no", ""),
            notes=data.get("notes", ""), record_id=data.get("id"))
        return Response(DiscipleshipCompletionSerializer(rec).data, status=201)

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


def _completed_on(course):
    return Subquery(DiscipleshipCompletion.objects.filter(member=OuterRef("pk"), course=course)
                    .values("completed_on")[:1])


class DiscipleshipRegisterViewSet(ExportMixin, ScopedViewMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    """The discipleship register: every member in the user's jurisdiction with the date each of the three
    classes was completed, and whether the badge of discipleship has been earned."""

    module = "members"
    serializer_class = DiscipleshipRegisterSerializer
    queryset = Member.objects.select_related("org_unit")
    action_permissions = {"register": "edit", "summary": "view", "export": None}
    filterset_class = DiscipleshipRegisterFilter
    search_fields = ["first_name", "middle_name", "last_name", "membership_no"]
    ordering_fields = ["last_name", "first_name", "membership_no", "discipleship_badge_on", "foundation_on",
                       "discipleship_on", "spiritual_growth_on"]
    export_title = "Discipleship register"
    export_columns = [
        Column("membership_no", "Membership No.", 16),
        Column("full_name", "Full name", 26),
        Column("org_unit.name", "Branch", 22),
        Column("foundation_on", "Foundation Class", 14),
        Column("discipleship_on", "Discipleship Class", 14),
        Column("spiritual_growth_on", "Spiritual Growth Class", 14),
        Column("discipleship_badge_on", "Badge of discipleship", 14,
               getter=lambda m: f"Awarded {m.discipleship_badge_on}" if m.discipleship_badge_on else ""),
    ]

    def get_queryset(self):
        return self.scope(super().get_queryset()).annotate(
            foundation_on=_completed_on(DiscipleshipClass.FOUNDATION),
            discipleship_on=_completed_on(DiscipleshipClass.DISCIPLESHIP),
            spiritual_growth_on=_completed_on(DiscipleshipClass.SPIRITUAL_GROWTH),
        )

    def get_export_summary(self, queryset):
        total = queryset.count()
        started = queryset.filter(Exists(DiscipleshipCompletion.objects.filter(member=OuterRef("pk")))).count()
        badge = queryset.filter(discipleship_badge_on__isnull=False).count()
        return [("Members", f"{total:,}"), ("Started the classes", f"{started:,}"),
                ("Badge of discipleship", f"{badge:,}")]

    @extend_schema(request=RegisterDiscipleSerializer, responses=DiscipleshipRegisterSerializer)
    @action(detail=False, methods=["post"])
    def register(self, request):
        """Register a disciple: record one or more completed classes for a member in one step."""
        s = RegisterDiscipleSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        data = s.validated_data
        member = self.get_queryset().filter(pk=data["member"]).first()
        if member is None:
            raise NotFound("Member not found in your jurisdiction.")
        self.require("edit", member.org_unit)
        services.register_disciple(member, request.user, classes=data["classes"], facilitator=data["facilitator"],
                                   certificate_no=data["certificate_no"], notes=data["notes"])
        row = self.get_queryset().get(pk=member.pk)
        return Response(self.get_serializer(row).data, status=201)

    @action(detail=False)
    def summary(self, request):
        qs = self.filter_queryset(self.get_queryset())
        by_class = {c: 0 for c in DiscipleshipClass.values}
        completions = DiscipleshipCompletion.objects.filter(member__in=qs.values("pk"))
        for course in by_class:
            by_class[course] = completions.filter(course=course).count()
        return Response({
            "members": qs.count(),
            "started": qs.filter(Exists(DiscipleshipCompletion.objects.filter(member=OuterRef("pk")))).count(),
            "badges": qs.filter(discipleship_badge_on__isnull=False).count(),
            "by_class": [{"value": c["value"], "label": c["label"], "count": by_class[c["value"]]}
                         for c in DISCIPLESHIP_CLASSES],
        })


class DiscipleshipCompletionViewSet(ScopedViewMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                                    viewsets.GenericViewSet):
    """Individual class completions (shown on a member's Discipleship tab). Recorded through
    ``POST /members/{id}/discipleship/``; a mistaken entry is removed with ``POST …/remove/``."""

    module = "members"
    serializer_class = DiscipleshipCompletionSerializer
    queryset = DiscipleshipCompletion.objects.select_related("member", "org_unit", "created_by")
    filterset_fields = {"member": ["exact"], "course": ["exact"], "completed_on": ["gte", "lte"]}
    action_permissions = {"remove": "edit"}

    def get_queryset(self):
        # Completions follow the member: scope by the member's current branch so the record
        # travels with them after a transfer.
        return super().get_queryset().filter(member__in=self.scope(Member.objects.all()).values("pk"))

    @extend_schema(request=RemoveCompletionSerializer, responses=None)
    @action(detail=True, methods=["post"])
    def remove(self, request, pk=None):
        rec = self.get_object()
        self.require("edit", rec.member.org_unit)
        s = RemoveCompletionSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        services.remove_class_completion(rec, request.user, s.validated_data["reason"])
        return Response(status=204)
