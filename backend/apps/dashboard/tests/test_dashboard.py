import pytest

from apps.members.models import Member

pytestmark = pytest.mark.django_db


@pytest.fixture
def members(api, people, units):
    for code, n, user in [("BR-KONO-001", 3, "pastor_koidu"), ("BR-BO-001", 2, "pastor_bo")]:
        for i in range(n):
            api(people[user]).post("/api/members/", {"first_name": f"M{i}", "last_name": code, "gender": "male",
                                                     "org_unit": str(units[code].pk)}, format="json")


def test_general_overseer_dashboard_matches_database(api, people, members):
    data = api(people["go"]).get("/api/dashboard/").data
    assert data["membership"]["total"] == Member.objects.count() == 5
    assert data["structure"]["branches"] == 7
    branches = {b["code"]: b["members"] for b in data["structure"]["branch_list"]}
    assert branches["BR-KONO-001"] == 3 and branches["BR-BO-001"] == 2


def test_regional_dashboard_is_limited_to_region(api, people, members):
    data = api(people["east"]).get("/api/dashboard/").data
    assert data["membership"]["total"] == 3
    assert {b["code"] for b in data["structure"]["branch_list"]} == {"BR-KONO-001", "BR-KONO-002", "BR-KONO-003",
                                                                    "BR-KEN-001"}


def test_dashboard_filter_by_unit(api, people, units, members):
    data = api(people["go"]).get(f"/api/dashboard/?org_unit={units['RG-SOUTH'].pk}").data
    assert data["membership"]["total"] == 2


def test_cannot_filter_dashboard_outside_jurisdiction(api, people, units, members):
    res = api(people["pastor_koidu"]).get(f"/api/dashboard/?org_unit={units['BR-BO-001'].pk}")
    assert res.status_code == 403


def test_attention_lists_pending_transfers(api, people, units, members):
    m = Member.objects.filter(org_unit=units["BR-KONO-001"]).first()
    api(people["pastor_koidu"]).post("/api/member-transfers/", {"member": str(m.pk),
                                                                "to_unit": str(units["BR-BO-001"].pk)}, format="json")
    items = api(people["pastor_bo"]).get("/api/dashboard/").data["attention"]["items"]
    assert items[0]["key"] == "transfers" and items[0]["count"] == 1
