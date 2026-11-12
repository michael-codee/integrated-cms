import datetime
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.assets.models import Asset
from apps.configuration.models import AssetCategory

pytestmark = pytest.mark.django_db


@pytest.fixture
def cats(seeded):
    return {c.code: c for c in AssetCategory.objects.all()}


def register(api, user, unit, cat, **extra):
    body = {"name": "Generator 15kVA", "category": str(cat.pk), "org_unit": str(unit.pk), "cost": "20000",
            "acquisition_date": str(timezone.localdate() - datetime.timedelta(days=730)), **extra}
    return api(user).post("/api/assets/", body, format="json")


def test_register_and_depreciation(api, people, units, cats):
    r = register(api, people["pastor_koidu"], units["BR-KONO-001"], cats["generators"])
    assert r.status_code == 201, r.data
    assert r.data["asset_no"].startswith("AST-")
    a = Asset.objects.get(pk=r.data["id"])
    # 20% straight line over ~2 years -> about 60% of cost remains
    assert Decimal("11900") < a.book_value() < Decimal("12100")
    sched = api(people["pastor_koidu"]).get(f"/api/assets/{a.pk}/depreciation/").data["schedule"]
    assert len(sched) == 5 and sched[-1]["closing"] == 0
    land = register(api, people["pastor_koidu"], units["BR-KONO-001"], cats["land-property"], name="Church plot",
                    cost="50000").data
    assert Decimal(land["book_value"]) == Decimal("50000")  # land is not depreciated


def test_jurisdiction(api, people, units, cats):
    register(api, people["pastor_koidu"], units["BR-KONO-001"], cats["generators"])
    assert register(api, people["pastor_koidu"], units["BR-BO-001"], cats["generators"]).status_code == 403
    assert api(people["pastor_bo"]).get("/api/assets/").data["count"] == 0
    assert api(people["kono"]).get("/api/assets/").data["count"] == 1
    assert api(people["treasurer_koidu"]).get("/api/assets/").status_code == 403


def test_cannot_delete_or_move_directly(api, people, units, cats):
    aid = register(api, people["pastor_koidu"], units["BR-KONO-001"], cats["generators"]).data["id"]
    c = api(people["pastor_koidu"])
    assert c.delete(f"/api/assets/{aid}/").status_code in (403, 409)
    r = c.patch(f"/api/assets/{aid}/", {"org_unit": str(units["BR-KONO-002"].pk)}, format="json")
    assert r.status_code in (400, 403)
    assert c.patch(f"/api/assets/{aid}/", {"status": "disposed"}, format="json").status_code == 400
    assert c.patch(f"/api/assets/{aid}/", {"location": "Store room"}, format="json").status_code == 200


def test_transfer_requires_receiving_approval(api, people, units, cats):
    aid = register(api, people["pastor_koidu"], units["BR-KONO-001"], cats["generators"]).data["id"]
    r = api(people["pastor_koidu"]).post("/api/asset-movements/", {
        "asset": aid, "to_unit": str(units["BR-KONO-002"].pk), "reason": "Needed for crusade"}, format="json")
    assert r.status_code == 201, r.data
    mid = r.data["id"]
    assert api(people["pastor_koidu"]).post(f"/api/asset-movements/{mid}/decide/", {"approve": True},
                                            format="json").status_code in (403, 404)
    assert api(people["pastor_bo"]).post(f"/api/asset-movements/{mid}/decide/", {"approve": True},
                                         format="json").status_code in (403, 404)
    incoming = api(people["pastor_lei"]).get("/api/asset-movements/?direction=incoming").data
    assert incoming["count"] == 1 and incoming["results"][0]["can_decide"] is True
    r = api(people["pastor_lei"]).post(f"/api/asset-movements/{mid}/decide/", {"approve": True}, format="json")
    assert r.status_code == 200 and r.data["status"] == "approved"
    assert Asset.objects.get(pk=aid).org_unit == units["BR-KONO-002"]


def test_maintenance_updates_condition(api, people, units, cats):
    aid = register(api, people["pastor_koidu"], units["BR-KONO-001"], cats["generators"], condition="poor").data["id"]
    today = timezone.localdate()
    r = api(people["pastor_koidu"]).post("/api/asset-maintenance/", {
        "asset": aid, "kind": "repair", "date": str(today), "description": "Replaced alternator", "cost": "1500",
        "condition_after": "good", "next_due_date": str(today + datetime.timedelta(days=90))}, format="json")
    assert r.status_code == 201, r.data
    assert Asset.objects.get(pk=aid).condition == "good"
    r = api(people["pastor_koidu"]).post("/api/asset-maintenance/", {
        "asset": aid, "kind": "repair", "date": str(today + datetime.timedelta(days=2)), "description": "x"},
        format="json")
    assert r.status_code == 400


def test_disposal_approved_above_unit(api, people, units, cats):
    aid = register(api, people["pastor_koidu"], units["BR-KONO-001"], cats["it-equipment"], name="Old laptop").data["id"]
    r = api(people["pastor_koidu"]).post("/api/asset-disposals/", {
        "asset": aid, "method": "scrap", "reason": "Beyond repair"}, format="json")
    assert r.status_code == 201, r.data
    did = r.data["id"]
    # The branch pastor cannot approve disposal of their own branch's asset; the district does.
    assert api(people["pastor_koidu"]).post(f"/api/asset-disposals/{did}/decide/", {"approve": True},
                                            format="json").status_code == 403
    r = api(people["kono"]).post(f"/api/asset-disposals/{did}/decide/", {"approve": True}, format="json")
    assert r.status_code == 200, r.data
    a = Asset.objects.get(pk=aid)
    assert a.status == "disposed" and a.disposed_on is not None
    assert api(people["pastor_koidu"]).patch(f"/api/assets/{aid}/", {"location": "x"},
                                             format="json").status_code == 409
    summary = api(people["kono"]).get("/api/assets/summary/").data
    assert summary["count"] == 0 and summary["disposed"] == 1


def test_dashboard_and_export(api, people, units, cats):
    register(api, people["pastor_koidu"], units["BR-KONO-001"], cats["generators"])
    data = api(people["kono"]).get("/api/dashboard/").data
    assert data["assets"]["count"] == 1
    r = api(people["kono"]).get("/api/assets/export/?file_format=xlsx")
    assert r.status_code == 200
