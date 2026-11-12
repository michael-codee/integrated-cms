"""Offline synchronisation bookkeeping: devices, idempotent replays and conflicts."""
from django.conf import settings
from django.db import models
from django.utils import timezone


class Device(models.Model):
    """A browser/phone that has signed in and synchronised."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="devices")
    device_id = models.CharField(max_length=64)
    label = models.CharField(max_length=120, blank=True, default="")
    user_agent = models.CharField(max_length=300, blank=True, default="")
    first_seen = models.DateTimeField(default=timezone.now)
    last_seen = models.DateTimeField(default=timezone.now)
    last_sync_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "device_id"], name="sync_device_unique")]
        ordering = ["-last_seen"]


class IdempotencyRecord(models.Model):
    """The stored outcome of a write sent with an ``Idempotency-Key``.

    A replay of the same key by the same user returns the stored response
    instead of applying the change again (queued offline writes are retried
    until the device sees a reply, so the server must tolerate repeats)."""

    IN_PROGRESS = 0

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    key = models.CharField(max_length=80)
    method = models.CharField(max_length=8)
    path = models.CharField(max_length=300)
    status_code = models.PositiveSmallIntegerField(default=IN_PROGRESS)
    response_body = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "key"], name="sync_idempotency_unique")]


class SyncConflict(models.Model):
    class Status(models.TextChoices):
        OPEN = "open", "Open"
        RESOLVED = "resolved", "Resolved"

    class Resolution(models.TextChoices):
        KEEP_SERVER = "keep_server", "Kept the server version"
        USE_MINE = "use_mine", "Re-applied the device version"

    entity = models.CharField(max_length=40)
    entity_id = models.CharField(max_length=64, db_index=True)
    label = models.CharField(max_length=240, blank=True, default="")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="sync_conflicts")
    device_id = models.CharField(max_length=64, blank=True, default="")
    org_unit = models.ForeignKey("organization.OrgUnit", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    client_payload = models.JSONField(default=dict)
    server_snapshot = models.JSONField(default=dict)
    base_version = models.PositiveIntegerField(null=True, blank=True)
    server_version = models.PositiveIntegerField(null=True, blank=True)
    reason = models.CharField(max_length=300)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN, db_index=True)
    resolution = models.CharField(max_length=12, choices=Resolution.choices, blank=True, default="")
    resolved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT,
                                    related_name="+")
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["-created_at"]
