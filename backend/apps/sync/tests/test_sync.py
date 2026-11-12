import uuid

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.members.models import Member
from apps.sync.models import Device, IdempotencyRecord, SyncConflict

pytestmark = pytest.mark.django_db


def jwt(user, device="dev-1"):
    c = APIClient(HTTP_X_CMIS_CLIENT="test", HTTP_X_DEVICE_ID=device)
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return c


def member(unit, **extra):
    return {"first_name": "Amie", "last_name": "Conteh", "gender": "female", "org_unit": str(unit.pk), **extra}


def test_replayed_write_is_applied_once(people, units):
    c = jwt(people["pastor_koidu"])
    key = str(uuid.uuid4())
    first = c.post("/api/members/", member(units["BR-KONO-001"]), format="json", HTTP_IDEMPOTENCY_KEY=key)
    assert first.status_code == 201, first.data
    again = c.post("/api/members/", member(units["BR-KONO-001"]), format="json", HTTP_IDEMPOTENCY_KEY=key)
    assert again.status_code == 201 and again["Idempotent-Replay"] == "true"
    assert again.json()["id"] == first.data["id"]
    assert Member.objects.filter(last_name="Conteh").count() == 1
    # the same key cannot be reused for another request
    other = c.post("/api/attendance/", {}, format="json", HTTP_IDEMPOTENCY_KEY=key)
    assert other.status_code == 422
    # keys are per user
    other_user = jwt(people["admin"]).post("/api/members/", member(units["BR-KONO-001"], first_name="Fatu"),
                                          format="json", HTTP_IDEMPOTENCY_KEY=key)
    assert other_user.status_code == 201


def test_failed_write_is_not_stored(people, units):
    c = jwt(people["pastor_koidu"])
    key = str(uuid.uuid4())
    assert c.post("/api/members/", member(units["BR-BO-001"]), format="json",
                  HTTP_IDEMPOTENCY_KEY=key).status_code == 403
    assert not IdempotencyRecord.objects.filter(key=key).exists()
    assert c.post("/api/members/", member(units["BR-KONO-001"]), format="json",
                  HTTP_IDEMPOTENCY_KEY=key).status_code == 201


def test_stale_edit_becomes_conflict(people, units):
    c = jwt(people["pastor_koidu"])
    m = c.post("/api/members/", member(units["BR-KONO-001"]), format="json").data
    v = m["version"]
    assert c.patch(f"/api/members/{m['id']}/", {"phone": "076000001"}, format="json",
                   HTTP_IF_MATCH=str(v)).status_code == 200
    stale = c.patch(f"/api/members/{m['id']}/", {"phone": "076999999"}, format="json", HTTP_IF_MATCH=str(v))
    assert stale.status_code == 409 and stale.data["code"] == "version_conflict"
    assert stale.data["server"]["phone"] == "076000001"
    assert Member.objects.get(pk=m["id"]).phone == "076000001"
    conflict = SyncConflict.objects.get()
    assert conflict.client_payload["phone"] == "076999999" and conflict.status == "open"
    # only the author (or an overseer of sync) sees and resolves it
    assert jwt(people["pastor_bo"]).get("/api/sync/conflicts/").data["count"] == 0
    assert jwt(people["admin"]).get("/api/sync/conflicts/").data["count"] == 1
    r = c.post(f"/api/sync/conflicts/{conflict.pk}/resolve/", {"resolution": "keep_server"}, format="json")
    assert r.status_code == 200 and r.data["status"] == "resolved"
    assert c.post(f"/api/sync/conflicts/{conflict.pk}/resolve/", {"resolution": "keep_server"},
                  format="json").status_code == 400


def test_pull_feed_is_scoped_incremental_and_has_tombstones(people, units, api):
    koidu = jwt(people["pastor_koidu"])
    a = koidu.post("/api/members/", member(units["BR-KONO-001"]), format="json").data
    jwt(people["pastor_bo"]).post("/api/members/", member(units["BR-BO-001"], first_name="Isata"), format="json")
    page = koidu.get("/api/sync/pull/?entity=members&cursor=0").data
    assert [r["id"] for r in page["results"]] == [a["id"]] and page["more"] is False
    cursor = page["cursor"]
    assert koidu.get(f"/api/sync/pull/?entity=members&cursor={cursor}").data["results"] == []
    koidu.patch(f"/api/members/{a['id']}/", {"phone": "1"}, format="json")
    changed = koidu.get(f"/api/sync/pull/?entity=members&cursor={cursor}").data
    assert len(changed["results"]) == 1 and changed["results"][0]["version"] == a["version"] + 1
    Member.objects.get(pk=a["id"]).soft_delete()
    gone = koidu.get(f"/api/sync/pull/?entity=members&cursor={changed['cursor']}").data
    assert gone["deleted"] == [a["id"]]
    # treasurer cannot see assets: skipped rather than an error
    assert jwt(people["treasurer_koidu"]).get("/api/sync/pull/?entity=assets").data["skipped"] is True
    assert koidu.get("/api/sync/pull/?entity=users").status_code == 400
    assert Device.objects.filter(user=people["pastor_koidu"], device_id="dev-1", last_sync_at__isnull=False).exists()
    status = koidu.get("/api/sync/status/").data
    assert status["devices"][0]["device_id"] == "dev-1"


def test_bulk_created_rows_reach_the_pull_feed(people, units):
    from apps.configuration.models import ServiceType
    from apps.attendance.models import AttendanceRecord
    import datetime

    st = ServiceType.objects.first()
    AttendanceRecord.objects.bulk_create([
        AttendanceRecord(org_unit=units["BR-KONO-001"], service_type=st, date=datetime.date(2024, 1, d), men=1)
        for d in (7, 14)])
    assert not AttendanceRecord.objects.filter(sync_seq=0).exists()
    rows = jwt(people["pastor_koidu"]).get("/api/sync/pull/?entity=attendance&cursor=0").data["results"]
    assert len(rows) == 2
