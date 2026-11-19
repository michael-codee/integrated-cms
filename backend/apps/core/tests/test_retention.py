from datetime import timedelta

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.audit.models import AuditLog
from apps.notifications.models import Notification
from apps.sync.models import IdempotencyRecord


@pytest.mark.django_db
def test_purge_expired_keeps_recent_and_audit(people):
    user = people["admin"]
    old = timezone.now() - timedelta(days=400)
    IdempotencyRecord.objects.create(user=user, key="old", method="POST", path="/x", created_at=old)
    IdempotencyRecord.objects.create(user=user, key="new", method="POST", path="/x")
    Notification.objects.create(recipient=user, event_type="t", title="old read", created_at=old, read_at=old)
    Notification.objects.create(recipient=user, event_type="t", title="old unread", created_at=old)
    audits = AuditLog.objects.count()

    call_command("purge_expired", stdout=open("/dev/null", "w"))

    assert list(IdempotencyRecord.objects.values_list("key", flat=True)) == ["new"]
    assert list(Notification.objects.values_list("title", flat=True)) == ["old unread"]
    assert AuditLog.objects.count() == audits


@pytest.mark.django_db
def test_cron_endpoint_needs_secret(settings, client):
    settings.CRON_SECRET = ""
    assert client.get("/api/cron/housekeeping/").status_code == 404
    settings.CRON_SECRET = "s3cret-value"
    assert client.get("/api/cron/housekeeping/", HTTP_AUTHORIZATION="Bearer wrong").status_code == 404
    r = client.get("/api/cron/housekeeping/", HTTP_AUTHORIZATION="Bearer s3cret-value")
    assert r.status_code == 200 and r.json()["status"] == "ok"
