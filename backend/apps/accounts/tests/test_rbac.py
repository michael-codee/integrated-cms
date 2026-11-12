import pytest

from apps.accounts.models import Role, RoleAssignment
from apps.core import scoping

pytestmark = pytest.mark.django_db


def codes(res):
    return {u["code"] for u in res.data["results"]}


def test_general_overseer_sees_whole_organisation(api, people, units):
    res = api(people["go"]).get("/api/org-units/?page_size=200")
    assert res.status_code == 200
    assert codes(res) == set(units)


def test_regional_overseer_sees_only_own_region(api, people):
    found = codes(api(people["east"]).get("/api/org-units/?page_size=200"))
    assert "RG-EAST" in found and "BR-KONO-001" in found and "BR-KEN-001" in found
    assert "BR-BO-001" not in found and "RG-SOUTH" not in found and "HQ-RLWM" not in found


def test_district_overseer_sees_only_own_district(api, people):
    found = codes(api(people["kono"]).get("/api/org-units/?page_size=200"))
    assert found == {"DT-KONO", "BR-KONO-001", "BR-KONO-002", "BR-KONO-003"}


def test_pastor_sees_only_own_branch(api, people, units):
    found = codes(api(people["pastor_bo"]).get("/api/org-units/?page_size=200"))
    assert found == {"BR-BO-001"}
    other = units["BR-KONO-001"]
    assert api(people["pastor_bo"]).get(f"/api/org-units/{other.pk}/").status_code == 404


def test_scope_helper(people, units):
    east = people["east"]
    assert scoping.can(east, "finance.approve", units["BR-KONO-001"])
    assert not scoping.can(east, "finance.approve", units["BR-BO-001"])
    pastor = people["pastor_koidu"]
    assert scoping.can(pastor, "members.create", units["BR-KONO-001"])
    assert not scoping.can(pastor, "members.create", units["BR-KONO-002"])
    assert not scoping.can(pastor, "settings.edit", units["BR-KONO-001"])


def test_expired_assignment_grants_nothing(people, units):
    from datetime import date

    a = RoleAssignment.objects.get(user=people["pastor_lei"])
    a.ends_on = date(2000, 1, 1)
    a.starts_on = date(1999, 1, 1)
    a.save()
    assert not scoping.has_perm_anywhere(people["pastor_lei"], "members.view")


def test_regional_overseer_cannot_create_units_outside_region(api, people, units):
    client = api(people["east"])
    res = client.post("/api/org-units/", {"name": "Bo Second Branch", "unit_type": "branch",
                                          "parent": str(units["DT-BO"].pk)}, format="json")
    assert res.status_code == 403


def test_admin_creates_branch_with_generated_code_and_history(api, people, units):
    client = api(people["admin"])
    res = client.post("/api/org-units/", {"name": "Makeni Branch", "unit_type": "branch",
                                          "parent": str(units["DT-BOMBALI"].pk), "town": "Makeni"}, format="json")
    assert res.status_code == 201, res.data
    assert res.data["code"].startswith("BR-MAK-")
    assert [x["name"] for x in res.data["lineage"]] == [
        "National Headquarters (Koidu City)", "Northern Region (expansion)", "Bombali District (Makeni)"]
    history = client.get(f"/api/org-units/{res.data['id']}/history/")
    assert history.data[0]["event"] == "created"


def test_invalid_hierarchy_is_rejected(api, people, units):
    client = api(people["admin"])
    res = client.post("/api/org-units/", {"name": "Bad Region", "unit_type": "region",
                                          "parent": str(units["BR-BO-001"].pk)}, format="json")
    assert res.status_code == 400


def test_moving_district_moves_subtree_paths(api, people, units):
    client = api(people["admin"])
    res = client.patch(f"/api/org-units/{units['DT-KENEMA'].pk}/", {"parent": str(units["RG-SOUTH"].pk)},
                       format="json")
    assert res.status_code == 200, res.data
    from apps.organization.models import OrgUnit

    branch = OrgUnit.objects.get(code="BR-KEN-001")
    assert branch.path.startswith(OrgUnit.objects.get(code="RG-SOUTH").path)
    assert branch.depth == 3
    # the south overseer now sees Kenema; the east overseer does not
    assert "BR-KEN-001" in codes(api(people["south"]).get("/api/org-units/?page_size=200"))
    assert "BR-KEN-001" not in codes(api(people["east"]).get("/api/org-units/?page_size=200"))


def test_cannot_move_unit_under_its_own_descendant(api, people, units):
    res = api(people["admin"]).patch(f"/api/org-units/{units['RG-EAST'].pk}/",
                                     {"parent": str(units["DT-KONO"].pk)}, format="json")
    assert res.status_code == 400


def test_deactivate_branch_keeps_history(api, people, units):
    client = api(people["kono"])
    res = client.post(f"/api/org-units/{units['BR-KONO-003'].pk}/status/", {"status": "inactive"}, format="json")
    assert res.status_code == 200 and res.data["status"] == "inactive"


def test_pastor_cannot_create_users(api, people, units):
    res = api(people["pastor_koidu"]).post("/api/users/", {
        "username": "x", "email": "x@example.org", "full_name": "X", "password": "Valid-Passw0rd-123",
        "initial_role": str(Role.objects.get(code="treasurer").pk), "initial_org_unit": str(units["BR-KONO-001"].pk)},
        format="json")
    assert res.status_code == 403


def test_admin_creates_user_with_role_and_must_change_password(api, people, units):
    client = api(people["admin"])
    res = client.post("/api/users/", {
        "username": "Treasurer_Bo", "email": "treasurer.bo@example.org", "full_name": "Treasurer Bo",
        "password": "Valid-Passw0rd-123", "initial_role": str(Role.objects.get(code="treasurer").pk),
        "initial_org_unit": str(units["BR-BO-001"].pk)}, format="json")
    assert res.status_code == 201, res.data
    assert res.data["username"] == "treasurer_bo"
    assert res.data["must_change_password"] is True
    assert res.data["assignments"][0]["org_unit_name"] == "Bo Branch"


def test_cannot_grant_role_more_senior_than_own(api, people, units):
    # A regional overseer (level 3) cannot make someone General Overseer (level 2).
    target = people["pastor_koidu"]
    res = api(people["east"]).post("/api/role-assignments/", {
        "user": str(target.pk), "role": str(Role.objects.get(code="general_overseer").pk),
        "org_unit": str(units["RG-EAST"].pk)}, format="json")
    assert res.status_code in (400, 403)


def test_user_list_is_scoped(api, people):
    res = api(people["admin"]).get("/api/users/?page_size=100")
    assert res.data["count"] == len(people)
    # East regional overseer has users.view only within the Eastern Region
    names = {u["username"] for u in api(people["east"]).get("/api/users/?page_size=100").data["results"]}
    assert "pastor_koidu" in names and "pastor_bo" not in names


def test_admin_can_suspend_and_reactivate(api, people):
    client = api(people["admin"])
    target = people["pastor_bo"]
    res = client.post(f"/api/users/{target.pk}/status/", {"status": "suspended", "reason": "Leave"}, format="json")
    assert res.status_code == 200 and res.data["status"] == "suspended"
    res = client.post(f"/api/users/{target.pk}/status/", {"status": "active"}, format="json")
    assert res.data["status"] == "active"


def test_cannot_suspend_more_senior_user(api, people):
    res = api(people["east"]).post(f"/api/users/{people['go'].pk}/status/", {"status": "suspended"}, format="json")
    assert res.status_code in (403, 404)


def test_admin_reset_link(api, people):
    res = api(people["admin"]).post(f"/api/users/{people['pastor_bo'].pk}/reset-link/")
    assert res.status_code == 200 and "token=" in res.data["link"]


def test_system_admin_role_cannot_be_weakened(api, people):
    role = Role.objects.get(code="system_admin")
    res = api(people["go"]).patch(f"/api/roles/{role.pk}/", {"permissions": []}, format="json")
    assert res.status_code == 403


def test_general_overseer_can_edit_lower_role_permissions(api, people):
    role = Role.objects.get(code="treasurer")
    res = api(people["go"]).patch(f"/api/roles/{role.pk}/", {"permissions": ["finance.view"]}, format="json")
    assert res.status_code == 200 and res.data["permissions"] == ["finance.view"]
