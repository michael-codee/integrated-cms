import datetime
import decimal
import uuid

from django.db import models

from .middleware import get_current_request
from .models import AuditLog

SKIP_FIELDS = {"updated_at", "sync_seq", "version", "password"}


def _json_value(value):
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (decimal.Decimal, uuid.UUID)):
        return str(value)
    if isinstance(value, (datetime.date, datetime.datetime, datetime.time)):
        return value.isoformat()
    if isinstance(value, models.Model):
        return str(value.pk)
    if hasattr(value, "name"):  # FieldFile
        return value.name or None
    return str(value)


def snapshot(instance) -> dict:
    """Serialisable dict of a model instance's concrete fields."""
    data = {}
    for field in instance._meta.concrete_fields:
        if field.name in SKIP_FIELDS:
            continue
        data[field.name] = _json_value(getattr(instance, field.attname))
    return data


def diff(before: dict, after: dict) -> dict:
    keys = set(before) | set(after)
    return {k: [before.get(k), after.get(k)] for k in sorted(keys) if before.get(k) != after.get(k)}


def _client_ip(request):
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def record(action, *, instance=None, entity=None, entity_id=None, actor=None, changes=None,
           org_unit=None, message="", label=None):
    request = get_current_request()
    if actor is None and request is not None and getattr(request, "user", None) is not None:
        if request.user.is_authenticated:
            actor = request.user
    if instance is not None:
        entity = entity or instance._meta.label
        entity_id = entity_id or str(instance.pk)
        label = label if label is not None else str(instance)[:255]
        if org_unit is None:
            if instance._meta.label == "organization.OrgUnit":
                org_unit = instance
            else:
                org_unit = getattr(instance, "org_unit", None)
    entry = AuditLog(
        action=action,
        entity=entity or "",
        entity_id=str(entity_id or ""),
        entity_label=(label or "")[:255],
        actor=actor,
        actor_name=(getattr(actor, "full_name", "") or getattr(actor, "username", "") or "")[:255] if actor else "",
        org_unit=org_unit,
        org_path=getattr(org_unit, "path", "") or "",
        changes=changes or {},
        message=message,
    )
    if request is not None:
        entry.ip_address = _client_ip(request)
        entry.user_agent = request.META.get("HTTP_USER_AGENT", "")[:300]
        entry.device_id = request.META.get("HTTP_X_DEVICE_ID", "")[:64]
    entry.save()
    return entry
