from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.configuration.models import SystemSetting
from apps.finance.serializers import ClientIdMixin
from apps.members.models import Member

from .models import AttendanceEntry, AttendanceRecord

COUNT_FIELDS = ("men", "women", "boys", "girls")


def _age(dob, on):
    if not dob:
        return None
    return on.year - dob.year - ((on.month, on.day) < (dob.month, dob.day))


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
                  "department", "department_name", "date", "men", "women", "boys", "girls", "visitors",
                  "first_timers", "new_converts", "total", "is_individual", "present_members", "present_member_ids",
                  "notes", "recorded_by", "version", "client_created_at", "is_demo", "created_at"]
        read_only_fields = ["is_individual", "version", "is_demo", "created_at"]

    def get_present_member_ids(self, obj):
        if not obj.is_individual or self.context.get("view") and self.context["view"].action == "list":
            return None
        return [str(e.member_id) for e in obj.entries.all()]

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
        if not attrs.get("_members") and sum(attrs.get(k, getattr(self.instance, k, 0) or 0) for k in COUNT_FIELDS) == 0 \
                and present is None:
            raise serializers.ValidationError("Enter at least one count.")
        if (attrs.get("visitors", 0) or 0) > sum(attrs.get(k, 0) or 0 for k in COUNT_FIELDS) and present is None:
            raise serializers.ValidationError({"visitors": "Visitors are part of the totals, so they cannot exceed them."})
        return attrs

    def _apply_members(self, record, members):
        on = record.date
        extra = {k: getattr(record, k) for k in COUNT_FIELDS}  # visitors / non-members entered by the user
        counts = dict.fromkeys(COUNT_FIELDS, 0)
        for m in members:
            child = (_age(m.date_of_birth, on) or 99) < 13
            key = ("boys" if m.gender == "male" else "girls") if child else ("men" if m.gender == "male" else "women")
            counts[key] += 1
        for k in COUNT_FIELDS:
            setattr(record, k, counts[k] + extra[k])
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
