from rest_framework import serializers

from apps.core import scoping

from .models import Department, DepartmentMember


class DepartmentSerializer(serializers.ModelSerializer):
    org_unit_name = serializers.CharField(source="org_unit.name", read_only=True)
    leader_display = serializers.SerializerMethodField()
    member_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Department
        fields = ["id", "org_unit", "org_unit_name", "name", "kind", "description", "leader", "leader_name",
                  "leader_display", "meeting_schedule", "is_active", "member_count", "created_at"]
        read_only_fields = ["created_at"]

    def get_leader_display(self, obj):
        return obj.leader.full_name if obj.leader_id else obj.leader_name

    def validate(self, attrs):
        if self.instance and "org_unit" in attrs and attrs["org_unit"] != self.instance.org_unit:
            raise serializers.ValidationError({"org_unit": "A department cannot move to another unit."})
        unit = attrs.get("org_unit") or getattr(self.instance, "org_unit", None)
        name = attrs.get("name") or getattr(self.instance, "name", "")
        clash = Department.objects.filter(org_unit=unit, name__iexact=name.strip())
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if unit and clash.exists():
            raise serializers.ValidationError({"name": "This unit already has a department with that name."})
        return attrs


class DepartmentMemberSerializer(serializers.ModelSerializer):
    member_name = serializers.CharField(source="member.full_name", read_only=True)
    membership_no = serializers.CharField(source="member.membership_no", read_only=True)
    gender = serializers.CharField(source="member.gender", read_only=True)

    class Meta:
        model = DepartmentMember
        fields = ["id", "department", "member", "member_name", "membership_no", "gender", "role", "joined_on",
                  "left_on"]

    def validate(self, attrs):
        dept = attrs.get("department") or self.instance.department
        member = attrs.get("member") or self.instance.member
        if self.instance is None and DepartmentMember.objects.filter(department=dept, member=member,
                                                                     left_on__isnull=True).exists():
            raise serializers.ValidationError({"member": "This member is already in the department."})
        if not member.org_unit.path.startswith(dept.org_unit.path):
            raise serializers.ValidationError({"member": "The member must belong to this department's unit."})
        request = self.context["request"]
        if not scoping.can(request.user, "departments.edit", dept.org_unit, dept.pk):
            raise serializers.ValidationError("You cannot manage this department.")
        return attrs
