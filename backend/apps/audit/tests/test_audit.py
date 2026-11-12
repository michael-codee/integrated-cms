import pytest
from django.db import DatabaseError, transaction

from apps.audit.models import AuditLog

pytestmark = pytest.mark.django_db


def test_changes_are_audited_with_field_diff(api, people, units):
    client = api(people["admin"])
    client.patch(f"/api/org-units/{units['BR-BO-001'].pk}/", {"town": "Bo City"}, format="json")
    entry = AuditLog.objects.filter(action="update", entity="organization.OrgUnit").first()
    assert entry.changes["town"] == ["Bo", "Bo City"]
    assert entry.actor == people["admin"]


def test_audit_log_is_append_only_at_database_level(people):
    entry = AuditLog.objects.create(action="other", entity="test")
    with pytest.raises(PermissionError):
        entry.save()
    with pytest.raises(DatabaseError):
        with transaction.atomic():
            AuditLog.objects.filter(pk=entry.pk).update(message="tampered")
    with pytest.raises(DatabaseError):
        with transaction.atomic():
            AuditLog.objects.filter(pk=entry.pk).delete()


def test_audit_log_visibility_is_scoped(api, people, units):
    api(people["admin"]).patch(f"/api/org-units/{units['BR-BO-001'].pk}/", {"town": "Bo City"}, format="json")
    api(people["admin"]).patch(f"/api/org-units/{units['BR-KONO-001'].pk}/", {"town": "Koidu"}, format="json")
    east = api(people["east"]).get("/api/audit-logs/?entity=organization.OrgUnit")
    labels = {e["entity_label"] for e in east.data["results"]}
    assert any("Kono" in l for l in labels) and not any("Bo Branch" in l for l in labels)
    assert api(people["pastor_bo"]).get("/api/audit-logs/").status_code == 403
