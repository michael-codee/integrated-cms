"""Hierarchical reporting: periodic reports that each unit submits to the unit above.

A *template* defines who reports (unit types), how often and which narrative
questions are asked. A *submission* is one unit's report for one period. Its
figures (membership, attendance, finance, programs and, for higher levels, how
many sub-units reported) are computed from the live records and frozen when
the report is submitted, so later corrections never silently change a report
that leadership has already reviewed.
"""
from django.db import models

from apps.core.models import BaseModel, SyncModel


class ReportTemplate(BaseModel):
    class Frequency(models.TextChoices):
        MONTHLY = "monthly", "Monthly"
        QUARTERLY = "quarterly", "Quarterly"
        ANNUAL = "annual", "Annual"

    code = models.SlugField(max_length=40, unique=True)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True, default="")
    frequency = models.CharField(max_length=10, choices=Frequency.choices)
    unit_types = models.JSONField(default=list, help_text="Unit types that must submit, e.g. [\"branch\"]")
    due_days = models.PositiveSmallIntegerField(default=10, help_text="Days after the period ends")
    questions = models.JSONField(default=list, help_text="[{key, label, help}] narrative questions")
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class ReportSubmission(SyncModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SUBMITTED = "submitted", "Submitted"
        APPROVED = "approved", "Accepted"
        RETURNED = "returned", "Returned for correction"

    template = models.ForeignKey(ReportTemplate, on_delete=models.PROTECT, related_name="submissions")
    org_unit = models.ForeignKey("organization.OrgUnit", on_delete=models.PROTECT, related_name="report_submissions")
    period_start = models.DateField()
    period_end = models.DateField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT, db_index=True)
    figures = models.JSONField(default=dict, blank=True)
    answers = models.JSONField(default=dict, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    submitted_by = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    review_comment = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-period_start", "org_unit__name"]
        constraints = [models.UniqueConstraint(fields=["template", "org_unit", "period_start"],
                                               condition=models.Q(is_deleted=False), name="one_report_per_period")]

    def __str__(self):
        return f"{self.template.name} · {self.org_unit.name} · {self.period_start:%b %Y}"
