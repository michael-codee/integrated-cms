from rest_framework import serializers

from apps.core import scoping
from apps.finance.serializers import ClientIdMixin

from .models import Program


class ProgramSerializer(ClientIdMixin, serializers.ModelSerializer):
    org_unit_name = serializers.CharField(source="org_unit.name", read_only=True)
    category_name = serializers.CharField(source="category.name", read_only=True)
    department_name = serializers.CharField(source="department.name", read_only=True, default=None)
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True, default=None)
    decided_by_name = serializers.CharField(source="decided_by.full_name", read_only=True, default=None)
    attendance_total = serializers.SerializerMethodField()
    can_decide = serializers.SerializerMethodField()

    class Meta:
        model = Program
        fields = ["id", "title", "category", "category_name", "org_unit", "org_unit_name", "department",
                  "department_name", "description", "venue", "starts_at", "ends_at", "coordinator", "speakers",
                  "expected_attendance", "budget_amount", "status", "is_public", "report_summary", "salvations",
                  "baptisms", "follow_up_notes", "created_by_name", "decided_by_name", "decided_at",
                  "decision_comment", "attendance_total", "can_decide", "version", "client_created_at", "created_at"]
        read_only_fields = ["status", "decided_at", "decision_comment", "version", "created_at"]

    def get_attendance_total(self, obj):
        totals = getattr(obj, "_attendance_total", None)
        if totals is not None:
            return totals
        return sum(r.total for r in obj.attendance_records.all())

    def get_can_decide(self, obj):
        from .services import approver_unit

        request = self.context.get("request")
        return bool(request and obj.status == Program.Status.PENDING and request.user.pk != obj.created_by_id
                    and scoping.can(request.user, "programs.approve", approver_unit(obj)))

    def validate(self, attrs):
        if self.instance is not None:
            attrs.pop("id", None)
            if self.instance.status in (Program.Status.CANCELLED,):
                raise serializers.ValidationError("Cancelled programs cannot be changed.")
        start = attrs.get("starts_at") or getattr(self.instance, "starts_at", None)
        end = attrs.get("ends_at") or getattr(self.instance, "ends_at", None)
        if start and end and end < start:
            raise serializers.ValidationError({"ends_at": "The program cannot end before it starts."})
        dept = attrs.get("department") or getattr(self.instance, "department", None)
        unit = attrs.get("org_unit") or getattr(self.instance, "org_unit", None)
        if dept and unit and dept.org_unit_id != unit.pk:
            raise serializers.ValidationError({"department": "The department must belong to the organising unit."})
        return attrs


class ProgramDecisionSerializer(serializers.Serializer):
    approve = serializers.BooleanField()
    comment = serializers.CharField(required=False, allow_blank=True, default="")


class ProgramStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=["completed", "postponed", "cancelled", "planned"])
    comment = serializers.CharField(required=False, allow_blank=True, default="")
