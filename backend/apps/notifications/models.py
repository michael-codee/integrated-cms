"""In-app notifications (from domain events) and announcements."""
from django.db import models
from django.utils import timezone

from apps.core.models import BaseModel, SoftDeleteModel


class Notification(models.Model):
    id = models.BigAutoField(primary_key=True)
    recipient = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="notifications")
    event_type = models.CharField(max_length=60)
    title = models.CharField(max_length=240)
    body = models.TextField(blank=True, default="")
    link = models.CharField(max_length=300, blank=True, default="")
    org_unit = models.ForeignKey("organization.OrgUnit", null=True, blank=True, on_delete=models.SET_NULL,
                                 related_name="+")
    actor_name = models.CharField(max_length=160, blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["recipient", "read_at"])]


class Announcement(SoftDeleteModel):
    class Priority(models.TextChoices):
        NORMAL = "normal", "Normal"
        IMPORTANT = "important", "Important"
        URGENT = "urgent", "Urgent"

    org_unit = models.ForeignKey("organization.OrgUnit", on_delete=models.PROTECT, related_name="announcements",
                                 help_text="Audience: this unit and every unit below it")
    title = models.CharField(max_length=200)
    body = models.TextField()
    priority = models.CharField(max_length=10, choices=Priority.choices, default=Priority.NORMAL)
    publish_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField(null=True, blank=True)
    is_pinned = models.BooleanField(default=False)

    class Meta:
        ordering = ["-is_pinned", "-publish_at"]
