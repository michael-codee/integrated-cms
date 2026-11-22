from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.configuration.models import SystemSetting
from apps.finance.serializers import ClientIdMixin
from apps.members.models import Member

from .models import GENDER_FIELDS, MINISTRY_FIELDS, AttendanceEntry, AttendanceRecord

# Age bands used to place a register member with no ministry department.
CHILD_UNDER, YOUTH_UNDER, YOUNG_ADULT_UNDER = 13, 25, 36
MINISTRY_DEPARTMENTS = ("children", "youth", "women", "men")  # department kinds, in order of precedence


def _age(dob, on):
    if not dob:
        return None
    return on.year - dob.year - ((on.month, on.day) < (dob.month, dob.day))


def ministry_of(member, on, department_kinds=()):
    """The ministry category a member is counted under: their ministry department if they belong to one,
    otherwise by age (unknown age counts as an adult)."""
    for kind in MINISTRY_DEPARTMENTS:
        if kind in department_kinds:
            return kind
    age = _age(member.date_of_birth, on)
    if age is not None and age < CHILD_UNDER:
        return "children"
    if age is not None and age < YOUTH_UNDER:
        return "youth"
    if age is not None and age < YOUNG_ADULT_UNDER:
        return "young_adults"
    return "men" if member.gender == "male" else "women"


class AttendanceSerializer(ClientIdMixin, serializers.ModelSerializer):
    org_unit_name = serializers.CharField(source="org_unit.name", read_only=True)
    service_type_name = serializers.CharField(source="service_type.name", read_only=True)
    program_title = serializers.CharField(source="program.title", read_only=True, default=None)
    department_name = serializers.CharField(source="department.name", read_only=True, default=None)
    recorded_by = serializers.CharField(source="created_by.full_name", read_only=True, default=None)
    total = serializers.IntegerField(read_only=True)
    present_members = serializers.ListField(child=serializers.UUIDField(), write_only=True, required=False)
    present_member_ids = serializers.SerializerMethodField()

    class Meta:
        model = AttendanceRecord
        fields = ["id", "org_unit", "org_unit_name", "service_type", "service_type_name", "program", "program_title",
                  "department", "department_name", "date", *MINISTRY_FIELDS, *GENDER_FIELDS, "visitors",
                  "first_timers", "new_converts", "total", "is_individual", "present_members", "present_member_ids",
                  "notes", "recorded_by", "version", "client_created_at", "is_demo", "created_at"]
        read_only_fields = ["is_individual", "version", "is_demo", "created_at"]

    def get_present_member_ids(self, obj):
        if not obj.is_individual or self.context.get("view") and self.context["view"].action == "list":
            return None
        return [{"id": str(e.member_id), "full_name": e.member.full_name, "membership_no": e.member.membership_no or "",
                 "gender": e.member.gender} for e in obj.entries.select_related("member")]

    def validate(self, attrs):
        if self.instance is not None:
            attrs.pop("id", None)
        get = lambda k: attrs.get(k, getattr(self.instance, k, None))  # noqa: E731
        unit, program, dept, date = get("org_unit"), get("program"), get("department"), get("date")
        if date and date > timezone.localdate():
            raise serializers.ValidationError({"date": "Attendance cannot be recorded for a future date."})
        if program and unit and not unit.path.startswith(program.org_unit.path) and not program.is_public \
                and program.org_unit_id != unit.pk:
            raise serializers.ValidationError({"program": "That program is not organised by this unit."})
        if dept and unit and dept.org_unit_id != unit.pk:
            raise serializers.ValidationError({"department": "The department must belong to this unit."})
        clash = AttendanceRecord.objects.filter(org_unit=unit, date=date, service_type=get("service_type"))
        if program:
            clash = AttendanceRecord.objects.filter(program=program, date=date)
        elif dept:
            clash = clash.filter(department=dept)
        else:
            clash = clash.filter(program__isnull=True, department__isnull=True)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if unit and date and clash.exists():
            raise serializers.ValidationError("Attendance for this gathering on this date has already been recorded. "
                                              "Open the existing record to correct it.")
        present = attrs.get("present_members")
        if present is not None:
            if not SystemSetting.get().allow_individual_attendance:
                raise serializers.ValidationError({"present_members": "Individual attendance is turned off in settings."})
            members = list(Member.objects.filter(pk__in=present, org_unit__path__startswith=unit.path))
            if len(members) != len(set(present)):
                raise serializers.ValidationError({"present_members": "Some members do not belong to this unit."})
            attrs["_members"] = members
        ministry = sum(get(k) or 0 for k in MINISTRY_FIELDS)
        gender = sum(get(k) or 0 for k in GENDER_FIELDS)
        if present is None and ministry == 0:
            raise serializers.ValidationError("Enter at least one count.")
        if ministry != gender:
            what = "others present" if present is not None else "attendance"
            raise serializers.ValidationError({"male": f"Male + female ({gender}) must equal the ministry total "
                                                       f"({ministry}) for {what}."})
        if present is None and (get("visitors") or 0) > ministry:
            raise serializers.ValidationError({"visitors": "Visitors are part of the totals, so they cannot exceed them."})
        return attrs

    def _apply_members(self, record, members):
        from apps.departments.models import DepartmentMember

        on = record.date
        kinds = {}
        for member_id, kind in DepartmentMember.objects.filter(
                member__in=members, left_on__isnull=True, department__is_deleted=False,
                department__kind__in=MINISTRY_DEPARTMENTS).values_list("member_id", "department__kind"):
            kinds.setdefault(member_id, set()).add(kind)
        fields = MINISTRY_FIELDS + GENDER_FIELDS
        counts = {k: getattr(record, k) for k in fields}  # others present (visitors, non-members) entered by the user
        for m in members:
            counts[ministry_of(m, on, kinds.get(m.pk, ()))] += 1
            counts["male" if m.gender == "male" else "female"] += 1
        for k in fields:
            setattr(record, k, counts[k])
        record.is_individual = True
        record.save()
        record.entries.all().delete()
        AttendanceEntry.objects.bulk_create([AttendanceEntry(record=record, member=m) for m in members])

    @transaction.atomic
    def create(self, validated_data):
        validated_data.pop("present_members", None)
        members = validated_data.pop("_members", None)
        record = super().create(validated_data)
        if members is not None:
            self._apply_members(record, members)
        return record

    @transaction.atomic
    def update(self, instance, validated_data):
        validated_data.pop("present_members", None)
        members = validated_data.pop("_members", None)
        record = super().update(instance, validated_data)
        if members is not None:
            self._apply_members(record, members)
        return record
