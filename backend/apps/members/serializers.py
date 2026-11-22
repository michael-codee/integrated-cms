from django.utils import timezone
from rest_framework import serializers

from apps.core.files import SignedFilesMixin
from apps.organization.models import OrgUnit

from .models import BaptismRecord, DiscipleshipClass, DiscipleshipCompletion, Member, MembershipHistory, MemberTransfer


class MemberSerializer(SignedFilesMixin, serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    full_name = serializers.CharField(read_only=True)
    age = serializers.IntegerField(read_only=True)
    org_unit_name = serializers.CharField(source="org_unit.name", read_only=True)
    category_name = serializers.CharField(source="category.name", read_only=True, default=None)
    pending_transfer = serializers.SerializerMethodField()

    class Meta:
        model = Member
        fields = [
            "id", "membership_no", "first_name", "middle_name", "last_name", "full_name", "gender", "date_of_birth",
            "age", "phone", "email", "address", "org_unit", "org_unit_name", "joined_on", "previous_affiliation",
            "category", "category_name", "status", "baptism_status", "baptism_date", "baptism_location",
            "marital_status", "occupation", "emergency_contact_name", "emergency_contact_phone", "photo",
            "photo_consent", "exit_date", "exit_reason", "notes", "is_demo", "version", "sync_seq", "created_at",
            "updated_at", "client_created_at", "client_updated_at", "pending_transfer", "discipleship_badge_on",
        ]
        read_only_fields = ["membership_no", "status", "exit_date", "exit_reason", "is_demo", "version", "sync_seq",
                            "created_at", "updated_at", "discipleship_badge_on"]

    def get_pending_transfer(self, obj):
        t = next((t for t in getattr(obj, "_pending_transfers", []) if t), None)
        if t is None and not hasattr(obj, "_pending_transfers"):
            t = obj.transfers.filter(status="pending").select_related("to_unit").first()
        return {"id": str(t.id), "to_unit_name": t.to_unit.name} if t else None

    def validate_org_unit(self, unit: OrgUnit):
        if unit.unit_type not in ("branch", "congregation"):
            raise serializers.ValidationError("Choose a branch or congregation.")
        if unit.status != "active" and (not self.instance or self.instance.org_unit_id != unit.pk):
            raise serializers.ValidationError("This branch is not active.")
        return unit

    def validate_date_of_birth(self, value):
        if value and value > timezone.localdate():
            raise serializers.ValidationError("Date of birth cannot be in the future.")
        if value and value.year < 1900:
            raise serializers.ValidationError("Check the year of birth.")
        return value

    def validate_joined_on(self, value):
        if value and value > timezone.localdate():
            raise serializers.ValidationError("Date joined cannot be in the future.")
        return value

    def validate_photo(self, value):
        if value and value.size > 3 * 1024 * 1024:
            raise serializers.ValidationError("Photographs must be smaller than 3 MB.")
        return value

    def validate(self, attrs):
        if self.instance and "org_unit" in attrs and attrs["org_unit"].pk != self.instance.org_unit_id:
            raise serializers.ValidationError({"org_unit": "Use a transfer to move a member to another branch."})
        if self.instance and "id" in attrs:
            attrs.pop("id")
        consent = attrs.get("photo_consent", getattr(self.instance, "photo_consent", False))
        if attrs.get("photo") and not consent:
            raise serializers.ValidationError({"photo": "Record the member's consent before storing a photograph."})
        if "photo_consent" in attrs and not attrs["photo_consent"] and self.instance and self.instance.photo:
            attrs["photo"] = None  # consent withdrawn: remove the photograph
        if attrs.get("baptism_status") == Member.Baptism.BAPTIZED and not self.instance and not attrs.get("baptism_date"):
            raise serializers.ValidationError({"baptism_date": "Enter the baptism date."})
        if attrs.get("id") and Member.all_objects.filter(pk=attrs["id"]).exists():
            raise serializers.ValidationError({"id": "A record with this identifier already exists."})
        return attrs


class MemberListSerializer(MemberSerializer):
    class Meta(MemberSerializer.Meta):
        fields = ["id", "membership_no", "full_name", "first_name", "last_name", "gender", "age", "date_of_birth",
                  "phone", "org_unit", "org_unit_name", "category", "category_name", "status", "baptism_status",
                  "joined_on", "is_demo", "version", "photo", "discipleship_badge_on"]


class MembershipHistorySerializer(serializers.ModelSerializer):
    by = serializers.CharField(source="created_by.full_name", read_only=True, default=None)
    org_unit_name = serializers.CharField(source="org_unit.name", read_only=True)

    class Meta:
        model = MembershipHistory
        fields = ["id", "event", "changes", "effective_date", "org_unit_name", "note", "by", "created_at"]


class BaptismSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    member_name = serializers.CharField(source="member.full_name", read_only=True)
    membership_no = serializers.CharField(source="member.membership_no", read_only=True)
    org_unit_name = serializers.CharField(source="org_unit.name", read_only=True)

    class Meta:
        model = BaptismRecord
        fields = ["id", "member", "member_name", "membership_no", "org_unit", "org_unit_name", "date", "location",
                  "officiated_by", "certificate_no", "notes", "created_at", "version"]
        read_only_fields = ["org_unit", "created_at", "version"]


class TransferSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    member_name = serializers.CharField(source="member.full_name", read_only=True)
    membership_no = serializers.CharField(source="member.membership_no", read_only=True)
    from_unit_name = serializers.CharField(source="org_unit.name", read_only=True)
    to_unit_name = serializers.CharField(source="to_unit.name", read_only=True)
    requested_by = serializers.CharField(source="created_by.full_name", read_only=True, default=None)
    decided_by_name = serializers.CharField(source="decided_by.full_name", read_only=True, default=None)
    can_decide = serializers.SerializerMethodField()

    class Meta:
        model = MemberTransfer
        fields = ["id", "member", "member_name", "membership_no", "org_unit", "from_unit_name", "to_unit",
                  "to_unit_name", "reason", "effective_date", "status", "requested_by", "decided_by_name",
                  "decided_at", "decision_note", "created_at", "can_decide", "version"]
        read_only_fields = ["org_unit", "status", "decided_at", "decision_note", "created_at", "version"]

    def get_can_decide(self, obj):
        from apps.core import scoping

        request = self.context.get("request")
        return bool(request and obj.status == "pending" and scoping.can(request.user, "members.approve", obj.to_unit))


class StatusChangeSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Member.Status.choices)
    reason = serializers.CharField(required=False, allow_blank=True, default="")
    effective_date = serializers.DateField(required=False)


class DecisionSerializer(serializers.Serializer):
    approve = serializers.BooleanField()
    note = serializers.CharField(required=False, allow_blank=True, default="")


class DiscipleshipCompletionSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    course_name = serializers.CharField(source="get_course_display", read_only=True)
    member_name = serializers.CharField(source="member.full_name", read_only=True)
    membership_no = serializers.CharField(source="member.membership_no", read_only=True)
    org_unit_name = serializers.CharField(source="org_unit.name", read_only=True)
    recorded_by = serializers.CharField(source="created_by.full_name", read_only=True, default=None)

    class Meta:
        model = DiscipleshipCompletion
        fields = ["id", "member", "member_name", "membership_no", "course", "course_name", "completed_on",
                  "facilitator", "certificate_no", "notes", "org_unit", "org_unit_name", "recorded_by", "created_at",
                  "version"]
        read_only_fields = ["member", "org_unit", "created_at", "version"]

    def validate_completed_on(self, value):
        if value > timezone.localdate():
            raise serializers.ValidationError("Completion date cannot be in the future.")
        return value


class DiscipleshipRegisterSerializer(serializers.ModelSerializer):
    """One row per member: the date each class was completed (null while outstanding) and the badge."""

    full_name = serializers.CharField(read_only=True)
    org_unit_name = serializers.CharField(source="org_unit.name", read_only=True)
    foundation_on = serializers.DateField(read_only=True)
    discipleship_on = serializers.DateField(read_only=True)
    spiritual_growth_on = serializers.DateField(read_only=True)
    classes_completed = serializers.SerializerMethodField()

    class Meta:
        model = Member
        fields = ["id", "membership_no", "full_name", "gender", "org_unit", "org_unit_name", "status",
                  "foundation_on", "discipleship_on", "spiritual_growth_on", "classes_completed",
                  "discipleship_badge_on", "is_demo"]

    def get_classes_completed(self, obj) -> int:
        return sum(1 for k in ("foundation_on", "discipleship_on", "spiritual_growth_on") if getattr(obj, k, None))


class RemoveCompletionSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, default="")


DISCIPLESHIP_CLASSES = [{"value": v, "label": label} for v, label in DiscipleshipClass.choices]
