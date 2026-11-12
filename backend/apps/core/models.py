"""
Abstract base models shared by every CMIS module.

* ``BaseModel``      – UUID primary key + who/when columns.
* ``SoftDeleteModel``– institutional records are never hard-deleted.
* ``SyncModel``      – offline-capable records: optimistic ``version``, global
                        ``sync_seq`` cursor for the pull feed, device metadata.
"""
import uuid

from django.conf import settings
from django.db import connection, models
from django.db.models import F
from django.db.models.expressions import RawSQL
from django.utils import timezone

SYNC_SEQUENCE = "cmis_sync_seq"


def next_sync_seq() -> int:
    with connection.cursor() as cursor:
        cursor.execute(f"SELECT nextval('{SYNC_SEQUENCE}')")
        return cursor.fetchone()[0]


class BaseModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(default=timezone.now, editable=False, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )

    class Meta:
        abstract = True


class SoftDeleteQuerySet(models.QuerySet):
    def delete(self):  # pragma: no cover - guarded API
        raise PermissionError("Bulk hard deletion is disabled. Use soft_delete() on each record.")

    def alive(self):
        return self.filter(is_deleted=False)

    def deleted(self):
        return self.filter(is_deleted=True)


class SoftDeleteManager(models.Manager.from_queryset(SoftDeleteQuerySet)):
    def get_queryset(self):
        return super().get_queryset().filter(is_deleted=False)


class SoftDeleteModel(BaseModel):
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )

    objects = SoftDeleteManager()
    all_objects = models.Manager.from_queryset(SoftDeleteQuerySet)()

    class Meta:
        abstract = True

    def soft_delete(self, user=None):
        self.is_deleted = True
        self.deleted_at = timezone.now()
        self.deleted_by = user
        self.updated_by = user
        self.save()

    def delete(self, *args, **kwargs):
        raise PermissionError(f"{type(self).__name__} records cannot be hard-deleted; use soft_delete().")


class SyncQuerySet(SoftDeleteQuerySet):
    def update(self, **kwargs):
        # Any bulk update still advances the sync cursor and version so
        # offline clients pick the change up and stale edits are detected.
        kwargs.setdefault("sync_seq", RawSQL(f"nextval('{SYNC_SEQUENCE}')", []))
        kwargs.setdefault("version", F("version") + 1)
        return super().update(**kwargs)


class SyncManager(models.Manager.from_queryset(SyncQuerySet)):
    def get_queryset(self):
        return super().get_queryset().filter(is_deleted=False)


class SyncModel(SoftDeleteModel):
    version = models.PositiveIntegerField(default=1)
    sync_seq = models.BigIntegerField(default=0, db_index=True, editable=False)
    device_id = models.CharField(max_length=64, blank=True, default="")
    client_created_at = models.DateTimeField(null=True, blank=True)
    client_updated_at = models.DateTimeField(null=True, blank=True)

    objects = SyncManager()
    all_objects = models.Manager.from_queryset(SyncQuerySet)()

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if not self._state.adding:
            self.version = (self.version or 0) + 1
        self.sync_seq = next_sync_seq()
        super().save(*args, **kwargs)
