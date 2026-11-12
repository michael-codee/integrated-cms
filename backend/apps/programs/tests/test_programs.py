import datetime

import pytest
from django.utils import timezone

from apps.accounts.models import RoleAssignment
from apps.configuration.models import ProgramCategory
from apps.departments.models import Department
from apps.notifications.models import Notification
from apps.programs.models import Program
from conftest import make_user

pytestmark = pytest.mark.django_db


def payload(unit, days=7, **extra):
    start = timezone.now() + datetime.timedelta(days=days)
    return {"title": "Kono district crusade", "category": str(ProgramCategory.objects.first().pk),
            "org_unit": str(unit.pk), "starts_at": start.isoformat(),
            "ends_at": (start + datetime.timedelta(hours=3)).isoformat(), **extra}


def test_create_and_validation(api, people, units):
    c = api(people["pastor_koidu"])
    r = c.post("/api/programs/", payload(units["BR-KONO-001"]), format="json")
    assert r.status_code == 201, r.data
    assert r.data["status"] == "planned"
    bad = payload(units["BR-KONO-001"])
    bad["ends_at"] = (timezone.now() - datetime.timedelta(days=30)).isoformat()
    assert c.post("/api/programs/", bad, format="json").status_code == 400
    assert c.post("/api/programs/", payload(units["BR-BO-001"]), format="json").status_code == 403
    # status is read-only on write
    r = c.post("/api/programs/", payload(units["BR-KONO-001"], status="approved"), format="json")
    assert r.data["status"] == "planned"


def test_submit_and_approval_at_parent_unit(api, people, units, django_capture_on_commit_callbacks):
    pid = api(people["pastor_koidu"]).post("/api/programs/", payload(units["BR-KONO-001"]), format="json").data["id"]
    with django_capture_on_commit_callbacks(execute=True):
        r = api(people["pastor_koidu"]).post(f"/api/programs/{pid}/submit/")
    assert r.status_code == 200 and r.data["status"] == "pending_approval"
    # district overseer is notified
    assert Notification.objects.filter(recipient=people["kono"], event_type="program.submitted").exists()
    assert not Notification.objects.filter(recipient=people["pastor_koidu"], event_type="program.submitted").exists()
    # the branch pastor cannot approve their own branch's program; another branch pastor cannot see it
    assert api(people["pastor_koidu"]).post(f"/api/programs/{pid}/decide/", {"approve": True},
                                            format="json").status_code == 403
    assert api(people["pastor_bo"]).post(f"/api/programs/{pid}/decide/", {"approve": True},
                                         format="json").status_code == 404
    # returning needs a reason
    assert api(people["kono"]).post(f"/api/programs/{pid}/decide/", {"approve": False},
                                    format="json").status_code == 400
    with django_capture_on_commit_callbacks(execute=True):
        r = api(people["kono"]).post(f"/api/programs/{pid}/decide/", {"approve": True, "comment": "Go ahead"},
                                     format="json")
    assert r.status_code == 200 and r.data["status"] == "approved"
    assert Notification.objects.filter(recipient=people["pastor_koidu"], event_type="program.decided").exists()


def test_creator_cannot_approve(api, people, units):
    pid = api(people["kono"]).post("/api/programs/", payload(units["BR-KONO-001"]), format="json").data["id"]
    api(people["kono"]).post(f"/api/programs/{pid}/submit/")
    assert api(people["kono"]).post(f"/api/programs/{pid}/decide/", {"approve": True},
                                    format="json").status_code == 403
    assert api(people["east"]).post(f"/api/programs/{pid}/decide/", {"approve": True},
                                    format="json").status_code == 200


def test_status_rules(api, people, units):
    c = api(people["pastor_koidu"])
    future = c.post("/api/programs/", payload(units["BR-KONO-001"]), format="json").data["id"]
    assert c.post(f"/api/programs/{future}/status/", {"status": "completed"}, format="json").status_code == 400
    assert c.post(f"/api/programs/{future}/status/", {"status": "cancelled"}, format="json").status_code == 400
    r = c.post(f"/api/programs/{future}/status/", {"status": "cancelled", "comment": "Rains"}, format="json")
    assert r.status_code == 200 and r.data["status"] == "cancelled"
    assert c.patch(f"/api/programs/{future}/", {"title": "x"}, format="json").status_code == 400
    past = c.post("/api/programs/", payload(units["BR-KONO-001"], days=-2), format="json").data["id"]
    r = c.post(f"/api/programs/{past}/status/", {"status": "completed"}, format="json")
    assert r.status_code == 200
    r = c.patch(f"/api/programs/{past}/", {"report_summary": "Good turnout", "salvations": 14}, format="json")
    assert r.status_code == 200 and r.data["salvations"] == 14


def test_public_programs_visible_everywhere_but_editable_only_by_organiser(api, people, units):
    pid = api(people["go"]).post("/api/programs/", payload(units["HQ-RLWM"], is_public=True,
                                                           title="National convention"), format="json").data["id"]
    api(people["pastor_koidu"]).post("/api/programs/", payload(units["BR-KONO-001"]), format="json")
    bo = api(people["pastor_bo"]).get("/api/programs/").data
    assert [p["id"] for p in bo] == [pid]
    assert api(people["pastor_bo"]).patch(f"/api/programs/{pid}/", {"title": "x"}, format="json").status_code == 403


def test_department_leader_sees_only_own_department(api, people, units):
    unit = units["BR-KONO-001"]
    youth = Department.objects.create(org_unit=unit, name="Youth", kind="youth")
    choir = Department.objects.create(org_unit=unit, name="Choir", kind="worship")
    leader = make_user("youth_lead", "youth_coordinator", unit)
    RoleAssignment.objects.filter(user=leader).update(department_id=youth.pk)
    c = api(people["pastor_koidu"])
    c.post("/api/programs/", payload(unit, department=str(youth.pk), title="Youth rally"), format="json")
    c.post("/api/programs/", payload(unit, department=str(choir.pk), title="Choir night"), format="json")
    c.post("/api/programs/", payload(unit, title="Sunday thanksgiving"), format="json")
    titles = {p["title"] for p in api(leader).get("/api/programs/").data}
    assert titles == {"Youth rally"}
    lc = api(leader)
    assert lc.post("/api/programs/", payload(unit, department=str(youth.pk)), format="json").status_code == 201
    assert lc.post("/api/programs/", payload(unit, department=str(choir.pk)), format="json").status_code == 403
    assert lc.post("/api/programs/", payload(unit), format="json").status_code == 403
    # department of another unit is rejected
    other = Department.objects.create(org_unit=units["BR-KONO-002"], name="Youth", kind="youth")
    assert c.post("/api/programs/", payload(unit, department=str(other.pk)), format="json").status_code == 400
    # departments list is restricted the same way
    assert [d["name"] for d in api(leader).get("/api/departments/").data["results"]] == ["Youth"]
    assert Program.objects.count() == 4
