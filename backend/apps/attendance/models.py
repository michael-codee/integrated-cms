"""Service and program attendance.

Each record is one gathering (service type + date, optionally a program or a
department meeting) at one unit, with head counts. Branches that keep a
register can also mark individual members present; the counts are then
derived from the marked members plus visitors.
"""
from django.db import models
from django.utils import timezone

from apps.core.models import BaseModel, SyncModel


class AttendanceRecord(SyncModel):
    org_unit = models.ForeignKey("organization.OrgUnit", on_delete=models.PROTECT, related_name="attendance_records")
    service_type = models.ForeignKey("configuration.ServiceType", on_delete=models.PROTECT, related_name="+")
    program = models.ForeignKey("programs.Program", null=True, blank=True, on_delete=models.PROTECT,
                                related_name="attendance_records")
    department = models.ForeignKey("departments.Department", null=True, blank=True, on_delete=models.PROTECT,
                                   related_name="attendance_records")
    date = models.DateField(default=timezone.localdate, db_index=True)
    men = models.PositiveIntegerField(default=0)
    women = models.PositiveIntegerField(default=0)
    boys = models.PositiveIntegerField(default=0)
    girls = models.PositiveIntegerField(default=0)
    visitors = models.PositiveIntegerField(default=0, help_text="Included in the counts above")
    first_timers = models.PositiveIntegerField(default=0)
    new_converts = models.PositiveIntegerField(default=0)
    is_individual = models.BooleanField(default=False, help_text="Counts derived from a member register")
    notes = models.TextField(blank=True, default="")
    is_demo = models.BooleanField(default=False, db_index=True)

    class Meta:
        ordering = ["-date", "org_unit__name"]
        indexes = [models.Index(fields=["org_unit", "date"])]
        constraints = [
            models.UniqueConstraint(
                fields=["org_unit", "service_type", "date"],
                condition=models.Q(is_deleted=False, program__isnull=True, department__isnull=True),
                name="attendance_one_record_per_service"),
            models.UniqueConstraint(fields=["program", "date"], condition=models.Q(is_deleted=False),
                                    name="attendance_one_record_per_program_day"),
        ]

    @property
    def adults(self):
        return self.men + self.women

    @property
    def children(self):
        return self.boys + self.girls

    @property
    def total(self):
        return self.men + self.women + self.boys + self.girls


class AttendanceEntry(BaseModel):
    """A member marked present (individual attendance)."""

    record = models.ForeignKey(AttendanceRecord, on_delete=models.CASCADE, related_name="entries")
    member = models.ForeignKey("members.Member", on_delete=models.PROTECT, related_name="attendance_entries")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["record", "member"], name="attendance_entry_unique")]
