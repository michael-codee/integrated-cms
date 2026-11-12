"""Leadership appointments: appoint, replace (transfer responsibility) and end."""
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.models import RoleAssignment
from apps.audit import services as audit
from apps.audit.models import AuditLog
from apps.core import scoping
from apps.core.events import publish
from apps.core.exceptions import BusinessRuleError
from apps.core.views import ScopedModelViewSet

from .models import LeadershipAppointment, LeadershipPosition, OrgUnitHistory

DEFAULT_POSITIONS = [
    ("general-overseer", "General Overseer", "headquarters", "general_overseer", True),
    ("regional-overseer", "Regional Overseer", "region", "regional_overseer", True),
    ("district-overseer", "District Overseer", "district", "district_overseer", True),
    ("pastor-in-charge", "Pastor-in-Charge", "branch", "branch_pastor", True),
    ("assistant-pastor", "Assistant Pastor", "branch", None, False),
    ("congregation-leader", "Congregation / Assembly Leader", "congregation", "branch_pastor", True),
    ("church-secretary", "Church Secretary", "", "church_secretary", False),
    ("treasurer", "Treasurer", "", "treasurer", False),
    ("financial-secretary", "Financial Secretary", "", "financial_secretary", False),
    ("elder", "Elder", "", None, False),
    ("deacon", "Deacon / Deaconess", "", None, False),
    ("evangelist", "Evangelist", "", None, False),
]


def seed_positions():
    from apps.accounts.models import Role

    for i, (code, title, unit_type, role_code, is_head) in enumerate(DEFAULT_POSITIONS):
        LeadershipPosition.objects.get_or_create(code=code, defaults={
            "title": title, "unit_type": unit_type, "is_head": is_head, "sort_order": (i + 1) * 10,
            "grants_role": Role.objects.filter(code=role_code).first() if role_code else None,
        })


@transaction.atomic
def end_appointment(appt, user, reason="", ends_on=None):
    if appt.status != LeadershipAppointment.Status.ACTIVE:
        raise BusinessRuleError("This appointment has already ended.")
    appt.status = LeadershipAppointment.Status.ENDED
    appt.ends_on = ends_on or timezone.localdate()
    appt.end_reason = reason
    appt.updated_by = user
    appt.save()
    if appt.role_assignment_id:
        ra = appt.role_assignment
        ra.is_active = False
        ra.ends_on = appt.ends_on
        ra.save(update_fields=["is_active", "ends_on", "updated_at"])
    OrgUnitHistory.objects.create(org_unit=appt.org_unit, event=OrgUnitHistory.Event.LEADER_ENDED,
                                  changes={"position": appt.position.title, "person": appt.person_name},
                                  note=reason, created_by=user)
    audit.record(AuditLog.Action.UPDATE, instance=appt, message=f"Appointment ended. {reason}".strip())
    return appt


@transaction.atomic
def appoint(*, position, org_unit, user, person_name, appointee=None, member=None, starts_on=None,
            appointed_by="", notes="", replace_current=False, appointment_id=None):
    if position.unit_type and position.unit_type != org_unit.unit_type:
        raise BusinessRuleError(f"{position.title} applies to a {position.get_unit_type_display().lower()}, "
                                f"not a {org_unit.get_unit_type_display().lower()}.")
    if position.is_head:
        current = LeadershipAppointment.objects.filter(org_unit=org_unit, position=position, status="active").first()
        if current:
            if not replace_current:
                raise BusinessRuleError(f"{current.person_name} currently holds this office. "
                                        "Choose 'replace' to transfer the responsibility.", code="position_filled")
            end_appointment(current, user, reason=f"Succeeded by {person_name}", ends_on=starts_on)
    ra = None
    if appointee and position.grants_role:
        ra = RoleAssignment.objects.create(user=appointee, role=position.grants_role, org_unit=org_unit,
                                           granted_by=user, created_by=user,
                                           starts_on=starts_on or timezone.localdate(),
                                           notes=f"Granted by appointment as {position.title}")
    kwargs = {"id": appointment_id} if appointment_id else {}
    appt = LeadershipAppointment.objects.create(
        position=position, org_unit=org_unit, user=appointee, member=member, person_name=person_name,
        starts_on=starts_on or timezone.localdate(), appointed_by=appointed_by, notes=notes, role_assignment=ra,
        created_by=user, updated_by=user, **kwargs,
    )
    OrgUnitHistory.objects.create(org_unit=org_unit, event=OrgUnitHistory.Event.LEADER_ASSIGNED,
                                  changes={"position": position.title, "person": person_name}, created_by=user)
    audit.record(AuditLog.Action.CREATE, instance=appt)
    publish("leadership.changed", org_unit=org_unit, actor=user,
            title=f"{person_name} appointed {position.title}", body=org_unit.name,
            link=f"/structure?unit={org_unit.pk}", notify_perm="org.view")
    return appt


class PositionSerializer(serializers.ModelSerializer):
    grants_role_name = serializers.CharField(source="grants_role.name", read_only=True, default=None)

    class Meta:
        model = LeadershipPosition
        fields = ["id", "code", "title", "unit_type", "grants_role", "grants_role_name", "is_head", "sort_order",
                  "is_active"]


class AppointmentSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    position_title = serializers.CharField(source="position.title", read_only=True)
    is_head = serializers.BooleanField(source="position.is_head", read_only=True)
    org_unit_name = serializers.CharField(source="org_unit.name", read_only=True)
    user_name = serializers.CharField(source="user.full_name", read_only=True, default=None)
    replace_current = serializers.BooleanField(write_only=True, required=False, default=False)
    person_name = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model = LeadershipAppointment
        fields = ["id", "position", "position_title", "is_head", "org_unit", "org_unit_name", "user", "user_name",
                  "member", "person_name", "starts_on", "ends_on", "status", "appointed_by", "end_reason", "notes",
                  "replace_current", "created_at", "version"]
        read_only_fields = ["ends_on", "status", "end_reason", "created_at", "version"]

    def validate(self, attrs):
        if not self.instance:
            name = attrs.get("person_name") or (attrs.get("user") and attrs["user"].full_name) or (
                attrs.get("member") and attrs["member"].full_name)
            if not name:
                raise serializers.ValidationError({"person_name": "Enter the appointee's name or choose a user/member."})
            attrs["person_name"] = name
        return attrs


class PositionViewSet(viewsets.ModelViewSet):
    serializer_class = PositionSerializer
    queryset = LeadershipPosition.objects.select_related("grants_role")
    pagination_class = None

    def get_permissions(self):
        from rest_framework.permissions import IsAuthenticated

        return [IsAuthenticated()]

    def _check_write(self):
        if not scoping.has_perm_anywhere(self.request.user, "settings.edit"):
            self.permission_denied(self.request, "Only administrators can change positions.")

    def perform_create(self, serializer):
        self._check_write()
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        self._check_write()
        serializer.save(updated_by=self.request.user)

    def perform_destroy(self, instance):
        self._check_write()
        if instance.appointments.exists():
            raise BusinessRuleError("This position has appointment history; deactivate it instead.")
        instance.delete()


class AppointmentViewSet(ScopedModelViewSet):
    module = "leadership"
    serializer_class = AppointmentSerializer
    queryset = LeadershipAppointment.objects.select_related("position", "org_unit", "user")
    filterset_fields = ["status", "position", "org_unit"]
    search_fields = ["person_name", "position__title", "org_unit__name"]
    action_permissions = {"end": "edit"}
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        within = self.request.query_params.get("within")
        if within:
            from .models import OrgUnit

            unit = OrgUnit.objects.filter(pk=within).first()
            qs = qs.filter(org_unit__path__startswith=unit.path) if unit else qs.none()
        return qs

    def perform_create(self, serializer):
        data = serializer.validated_data
        self.require("create", data["org_unit"])
        appointee = data.get("user")
        if appointee and data["position"].grants_role:
            # Granting access through an appointment follows the same rules as granting a role.
            if not scoping.can(self.request.user, "users.edit", data["org_unit"]) and not scoping.can(
                    self.request.user, "leadership.create", data["org_unit"]):
                self.permission_denied(self.request, "You cannot grant access in this unit.")
            if data["position"].grants_role.level < scoping.senior_level_at(self.request.user, data["org_unit"]):
                self.permission_denied(self.request, "This appointment would grant a role more senior than yours.")
        serializer.instance = appoint(
            position=data["position"], org_unit=data["org_unit"], user=self.request.user,
            person_name=data["person_name"], appointee=appointee, member=data.get("member"),
            starts_on=data.get("starts_on"), appointed_by=data.get("appointed_by", ""), notes=data.get("notes", ""),
            replace_current=data.get("replace_current", False), appointment_id=data.get("id"),
        )

    @action(detail=True, methods=["post"])
    def end(self, request, pk=None):
        appt = self.get_object()
        self.require("edit", appt.org_unit)
        end_appointment(appt, request.user, request.data.get("reason", ""), request.data.get("ends_on") or None)
        return Response(self.get_serializer(appt).data)
