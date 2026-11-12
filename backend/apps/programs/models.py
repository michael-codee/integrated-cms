"""Programs, services and events (crusades, conferences, revivals, outreach…)."""
from decimal import Decimal

from django.db import models

from apps.core.models import SyncModel


class Program(SyncModel):
    class Status(models.TextChoices):
        PLANNED = "planned", "Planned"
        PENDING = "pending_approval", "Awaiting approval"
        APPROVED = "approved", "Approved"
        COMPLETED = "completed", "Completed"
        POSTPONED = "postponed", "Postponed"
        CANCELLED = "cancelled", "Cancelled"

    title = models.CharField(max_length=200)
    category = models.ForeignKey("configuration.ProgramCategory", on_delete=models.PROTECT, related_name="programs")
    org_unit = models.ForeignKey("organization.OrgUnit", on_delete=models.PROTECT, related_name="programs",
                                 help_text="Organising unit")
    department = models.ForeignKey("departments.Department", null=True, blank=True, on_delete=models.PROTECT,
                                   related_name="programs")
    description = models.TextField(blank=True, default="")
    venue = models.CharField(max_length=200, blank=True, default="")
    starts_at = models.DateTimeField(db_index=True)
    ends_at = models.DateTimeField()
    coordinator = models.CharField(max_length=160, blank=True, default="")
    speakers = models.CharField(max_length=300, blank=True, default="")
    expected_attendance = models.PositiveIntegerField(null=True, blank=True)
    budget_amount = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0"))
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PLANNED, db_index=True)
    is_public = models.BooleanField(default=False, help_text="Shown to every unit (e.g. national conference)")
    # outcome report
    report_summary = models.TextField(blank=True, default="")
    salvations = models.PositiveIntegerField(null=True, blank=True, help_text="Decisions for Christ")
    baptisms = models.PositiveIntegerField(null=True, blank=True)
    follow_up_notes = models.TextField(blank=True, default="")
    decided_by = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_comment = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-starts_at"]
        indexes = [models.Index(fields=["org_unit", "starts_at"])]
        constraints = [models.CheckConstraint(condition=models.Q(ends_at__gte=models.F("starts_at")),
                                              name="program_ends_after_start")]

    def __str__(self):
        return self.title
