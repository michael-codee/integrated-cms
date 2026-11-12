import uuid

from django.conf import settings
from django.db import models


class AuditLog(models.Model):
    """Append-only record of who did what, when, and what changed.

    Updates and deletes are blocked both here and by a database trigger
    (see migration 0002) so that history cannot be silently altered.
    """

    class Action(models.TextChoices):
        CREATE = "create"
        UPDATE = "update"
        DELETE = "delete"
        RESTORE = "restore"
        APPROVE = "approve"
        REJECT = "reject"
        RETURN = "return"
        SUBMIT = "submit"
        CANCEL = "cancel"
        PAY = "pay"
        REVERSE = "reverse"
        TRANSFER = "transfer"
        LOGIN = "login"
        LOGIN_FAILED = "login_failed"
        LOGOUT = "logout"
        PASSWORD_CHANGE = "password_change"
        PASSWORD_RESET = "password_reset"
        EXPORT = "export"
        PRINT = "print"
        STATUS_CHANGE = "status_change"
        SYNC = "sync"
        OTHER = "other"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    at = models.DateTimeField(auto_now_add=True, db_index=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="audit_entries"
    )
    actor_name = models.CharField(max_length=255, blank=True, default="")
    action = models.CharField(max_length=32, choices=Action.choices, db_index=True)
    entity = models.CharField(max_length=100, db_index=True)
    entity_id = models.CharField(max_length=64, blank=True, default="", db_index=True)
    entity_label = models.CharField(max_length=255, blank=True, default="")
    org_unit = models.ForeignKey(
        "organization.OrgUnit", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    org_path = models.CharField(max_length=400, blank=True, default="", db_index=True)
    changes = models.JSONField(default=dict, blank=True)
    message = models.TextField(blank=True, default="")
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=300, blank=True, default="")
    device_id = models.CharField(max_length=64, blank=True, default="")

    class Meta:
        ordering = ["-at"]
        indexes = [models.Index(fields=["entity", "entity_id"])]

    def __str__(self):
        return f"{self.at:%Y-%m-%d %H:%M} {self.actor_name} {self.action} {self.entity}"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise PermissionError("Audit log entries are immutable.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise PermissionError("Audit log entries cannot be deleted.")
