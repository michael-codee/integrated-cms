import pytest

from apps.accounts.models import RoleAssignment
from apps.organization.models import LeadershipAppointment, LeadershipPosition

pytestmark = pytest.mark.django_db


def test_appointing_pastor_grants_branch_role_and_replace_transfers_it(api, people, units):
    from conftest import make_user

    new_pastor = make_user("new_pastor", "minister", units["BR-KONO-003"])
    pos = LeadershipPosition.objects.get(code="pastor-in-charge")
    client = api(people["kono"])
    res = client.post("/api/appointments/", {"position": str(pos.pk), "org_unit": str(units["BR-KONO-003"].pk),
                                             "user": str(new_pastor.pk), "starts_on": "2026-01-01"}, format="json")
    assert res.status_code == 201, res.data
    ra = RoleAssignment.objects.get(user=new_pastor, role__code="branch_pastor")
    assert ra.org_unit == units["BR-KONO-003"] and ra.is_active
    # A second appointment to the same head office must explicitly replace
    other = make_user("other_pastor", "minister", units["BR-KONO-003"])
    res = client.post("/api/appointments/", {"position": str(pos.pk), "org_unit": str(units["BR-KONO-003"].pk),
                                             "user": str(other.pk)}, format="json")
    assert res.status_code == 400 and res.data["code"] == "position_filled"
    res = client.post("/api/appointments/", {"position": str(pos.pk), "org_unit": str(units["BR-KONO-003"].pk),
                                             "user": str(other.pk), "replace_current": True}, format="json")
    assert res.status_code == 201
    ra.refresh_from_db()
    assert not ra.is_active
    assert LeadershipAppointment.objects.filter(org_unit=units["BR-KONO-003"], position=pos, status="active").count() == 1


def test_position_must_match_unit_type(api, people, units):
    pos = LeadershipPosition.objects.get(code="district-overseer")
    res = api(people["admin"]).post("/api/appointments/", {"position": str(pos.pk), "person_name": "X",
                                                           "org_unit": str(units["BR-BO-001"].pk)}, format="json")
    assert res.status_code == 400


def test_district_overseer_cannot_appoint_outside_district(api, people, units):
    pos = LeadershipPosition.objects.get(code="pastor-in-charge")
    res = api(people["kono"]).post("/api/appointments/", {"position": str(pos.pk), "person_name": "X",
                                                          "org_unit": str(units["BR-BO-001"].pk)}, format="json")
    assert res.status_code == 403


def test_end_appointment_revokes_access(api, people, units):
    from conftest import make_user

    u = make_user("treas", "minister", units["BR-KONO-001"])
    pos = LeadershipPosition.objects.get(code="treasurer")
    res = api(people["admin"]).post("/api/appointments/", {"position": str(pos.pk), "user": str(u.pk),
                                                           "org_unit": str(units["BR-KONO-001"].pk)}, format="json")
    appt_id = res.data["id"]
    assert RoleAssignment.objects.filter(user=u, role__code="treasurer", is_active=True).exists()
    res = api(people["admin"]).post(f"/api/appointments/{appt_id}/end/", {"reason": "Term completed"}, format="json")
    assert res.status_code == 200 and res.data["status"] == "ended"
    assert not RoleAssignment.objects.filter(user=u, role__code="treasurer", is_active=True).exists()
