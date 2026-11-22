"""Admin-defined structure levels and safe adding/removing of branches."""
import pytest

from apps.organization.models import OrgUnit, OrgUnitHistory, StructureLevel

pytestmark = pytest.mark.django_db


def test_default_levels_are_installed(seeded):
    codes = list(StructureLevel.objects.values_list("code", flat=True))
    assert codes == ["headquarters", "region", "district", "branch", "congregation"]


def test_admin_adds_a_new_level_and_places_units_in_it(api, people, units):
    client = api(people["admin"])
    res = client.post("/api/structure-levels/", {"code": "zone", "name": "Zone", "plural_name": "Zones",
                                                 "rank": 25, "code_prefix": "zn"}, format="json")
    assert res.status_code == 201, res.data
    assert res.data["code_prefix"] == "ZN"
    # A zone sits between district (20) and branch (30)
    res = client.post("/api/org-units/", {"name": "Koidu Zone", "unit_type": "zone",
                                          "parent": str(units["DT-KONO"].pk)}, format="json")
    assert res.status_code == 201, res.data
    assert res.data["code"].startswith("ZN-")
    assert res.data["unit_type_display"] == "Zone"
    zone = res.data["id"]
    res = client.post("/api/org-units/", {"name": "Zone Branch", "unit_type": "branch", "parent": zone}, format="json")
    assert res.status_code == 201, res.data
    # …but a zone cannot be put under a branch
    res = client.post("/api/org-units/", {"name": "Bad Zone", "unit_type": "zone",
                                          "parent": str(units["BR-KONO-001"].pk)}, format="json")
    assert res.status_code == 400


def test_new_level_can_hold_members(api, people, units):
    client = api(people["admin"])
    client.post("/api/structure-levels/", {"code": "outstation", "name": "Outstation", "rank": 50,
                                           "code_prefix": "OS", "holds_members": True}, format="json")
    res = client.post("/api/org-units/", {"name": "Tankoro Outstation", "unit_type": "outstation",
                                          "parent": str(units["BR-KONO-001"].pk)}, format="json")
    assert res.status_code == 201, res.data
    from apps.organization.models import member_level_codes

    assert "outstation" in member_level_codes()


def test_only_admins_change_levels(api, people):
    res = api(people["kono"]).post("/api/structure-levels/", {"code": "zone", "name": "Zone", "rank": 25,
                                                              "code_prefix": "ZN"}, format="json")
    assert res.status_code == 403
    assert api(people["kono"]).get("/api/structure-levels/").status_code == 200


def test_level_rules(api, people):
    client = api(people["admin"])
    hq = StructureLevel.objects.get(code="headquarters")
    region = StructureLevel.objects.get(code="region")
    branch = StructureLevel.objects.get(code="branch")
    # nothing else at the top
    assert client.post("/api/structure-levels/", {"code": "apex", "name": "Apex", "rank": 0,
                                                  "code_prefix": "AP"}, format="json").status_code == 400
    # codes are fixed
    assert client.patch(f"/api/structure-levels/{region.pk}/", {"code": "province"}, format="json").status_code == 400
    # renaming is fine
    res = client.patch(f"/api/structure-levels/{region.pk}/", {"name": "Province", "plural_name": "Provinces"},
                       format="json")
    assert res.status_code == 200 and res.data["name"] == "Province"
    # moving region below district would put existing districts under a lower level
    res = client.patch(f"/api/structure-levels/{region.pk}/", {"rank": 35}, format="json")
    assert res.status_code == 400 and "rank" in res.data
    # system levels cannot be switched off or deleted
    assert client.patch(f"/api/structure-levels/{branch.pk}/", {"is_active": False}, format="json").status_code == 400
    assert client.delete(f"/api/structure-levels/{hq.pk}/").status_code == 400
    # a level in use cannot be deleted, only switched off
    assert client.delete(f"/api/structure-levels/{region.pk}/").status_code == 409
    assert client.patch(f"/api/structure-levels/{region.pk}/", {"is_active": False}, format="json").status_code == 200


def test_inactive_level_refuses_new_units(api, people, units):
    client = api(people["admin"])
    cg = StructureLevel.objects.get(code="congregation")
    client.patch(f"/api/structure-levels/{cg.pk}/", {"is_active": False}, format="json")
    res = client.post("/api/org-units/", {"name": "New Assembly", "unit_type": "congregation",
                                          "parent": str(units["BR-KONO-001"].pk)}, format="json")
    assert res.status_code == 400


def test_unused_level_can_be_deleted(api, people):
    client = api(people["admin"])
    res = client.post("/api/structure-levels/", {"code": "zone", "name": "Zone", "rank": 25, "code_prefix": "ZN"},
                      format="json")
    assert client.delete(f"/api/structure-levels/{res.data['id']}/").status_code == 204
    assert not StructureLevel.objects.filter(code="zone").exists()


def test_branch_added_by_mistake_can_be_removed(api, people, units):
    client = api(people["admin"])
    res = client.post("/api/org-units/", {"name": "Typo Branch", "unit_type": "branch",
                                          "parent": str(units["DT-KONO"].pk)}, format="json")
    unit_id = res.data["id"]
    deps = client.get(f"/api/org-units/{unit_id}/dependencies/").data
    assert deps["removable"] and deps["dependencies"] == []
    assert client.delete(f"/api/org-units/{unit_id}/").status_code == 204
    assert not OrgUnit.objects.filter(pk=unit_id).exists()
    assert OrgUnit.all_objects.get(pk=unit_id).is_deleted  # soft-deleted, never erased
    assert OrgUnitHistory.objects.filter(org_unit_id=unit_id, event="removed").exists()


def test_branch_with_records_cannot_be_removed_only_closed(api, people, units):
    from apps.members.models import Member

    branch = units["BR-KONO-001"]
    Member.objects.create(org_unit=branch, first_name="Ama", last_name="Sesay", gender="female")
    client = api(people["admin"])
    deps = client.get(f"/api/org-units/{branch.pk}/dependencies/").data
    assert not deps["removable"]
    assert any(d["label"] == "Members" and d["count"] == 1 for d in deps["dependencies"])
    res = client.delete(f"/api/org-units/{branch.pk}/")
    assert res.status_code == 409 and res.data["code"] == "unit_in_use"
    assert OrgUnit.objects.filter(pk=branch.pk).exists()
    res = client.post(f"/api/org-units/{branch.pk}/status/", {"status": "inactive", "note": "Merged with Tankoro"},
                      format="json")
    assert res.status_code == 200 and res.data["status"] == "inactive"


def test_district_with_branches_cannot_be_removed(api, people, units):
    res = api(people["admin"]).delete(f"/api/org-units/{units['DT-KONO'].pk}/")
    assert res.status_code == 409


def test_headquarters_cannot_be_removed_or_closed(api, people, units):
    client = api(people["admin"])
    hq = units["HQ-RLWM"]
    assert client.delete(f"/api/org-units/{hq.pk}/").status_code in (400, 409)
    assert client.post(f"/api/org-units/{hq.pk}/status/", {"status": "inactive"}, format="json").status_code == 400


def test_district_overseer_cannot_remove_branches(api, people, units):
    client = api(people["kono"])
    res = client.post("/api/org-units/", {"name": "Overseer Branch", "unit_type": "branch",
                                          "parent": str(units["DT-KONO"].pk)}, format="json")
    assert res.status_code == 201
    assert client.delete(f"/api/org-units/{res.data['id']}/").status_code == 403


def test_dashboard_reports_counts_per_level(api, people):
    res = api(people["admin"]).get("/api/dashboard/")
    assert res.status_code == 200
    levels = res.data["structure"]["levels"]
    assert [lvl["code"] for lvl in levels] == ["region", "district", "branch", "congregation"]
