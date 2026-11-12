import datetime

import pytest
from django.utils import timezone

from apps.core.events import publish
from apps.members.models import Member
from apps.notifications.models import Announcement, Notification

pytestmark = pytest.mark.django_db


def test_events_notify_permission_holders_in_scope(people, units, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        publish("x.happened", org_unit=units["BR-KONO-001"], actor=people["pastor_koidu"], title="Something",
                body="", link="/x", notify_perm="finance.approve")
    got = set(Notification.objects.values_list("recipient__username", flat=True))
    # ancestors with the permission are notified; the actor and other branches are not
    assert {"kono_overseer", "east_overseer", "general_overseer", "sysadmin"} <= got
    assert "pastor_koidu" not in got and "pastor_bo" not in got and "south_overseer" not in got


def test_inbox_is_private_and_mark_read(api, people, units, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        publish("x", org_unit=units["BR-KONO-001"], actor=None, title="Hi", body="", link="",
                recipients=[people["pastor_koidu"].pk])
    c = api(people["pastor_koidu"])
    s = c.get("/api/notifications/summary/").data
    assert s["unread"] == 1
    nid = s["latest"][0]["id"]
    assert api(people["pastor_bo"]).get("/api/notifications/").data["count"] == 0
    api(people["pastor_bo"]).post(f"/api/notifications/{nid}/read/")
    assert c.get("/api/notifications/summary/").data["unread"] == 1
    c.post(f"/api/notifications/{nid}/read/")
    assert c.get("/api/notifications/summary/").data["unread"] == 0


def ann(unit, **extra):
    return {"org_unit": str(unit.pk), "title": "Fasting week", "body": "All branches fast Monday to Wednesday.",
            "publish_at": timezone.now().isoformat(), **extra}


def test_announcement_audience(api, people, units):
    r = api(people["kono"]).post("/api/announcements/", ann(units["DT-KONO"]), format="json")
    assert r.status_code == 201, r.data
    api(people["pastor_bo"]).post("/api/announcements/", ann(units["BR-BO-001"], title="Bo only"), format="json")
    api(people["go"]).post("/api/announcements/", ann(units["HQ-RLWM"], title="Future",
                                                     publish_at=(timezone.now() + datetime.timedelta(days=3)).isoformat()),
                           format="json")
    seen = lambda u: {a["title"] for a in api(people[u]).get("/api/announcements/").data["results"]}  # noqa: E731
    assert seen("pastor_koidu") == {"Fasting week"}
    assert seen("pastor_bo") == {"Bo only"}
    assert seen("east") == {"Fasting week"}
    assert seen("go") >= {"Fasting week", "Bo only"} and "Future" not in seen("go")
    # a branch pastor cannot address the district, nor edit the district's announcement
    assert api(people["pastor_koidu"]).post("/api/announcements/", ann(units["DT-KONO"]),
                                            format="json").status_code == 403
    assert api(people["pastor_koidu"]).patch(f"/api/announcements/{r.data['id']}/", {"title": "x"},
                                             format="json").status_code in (403, 404)


def test_urgent_announcement_notifies(api, people, units, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        api(people["kono"]).post("/api/announcements/", ann(units["DT-KONO"], priority="urgent"), format="json")
    assert Notification.objects.filter(recipient=people["pastor_koidu"], event_type="announcement.published").exists()
    assert not Notification.objects.filter(recipient=people["pastor_bo"]).exists()
    assert Announcement.objects.count() == 1


def test_department_membership(api, people, units):
    unit = units["BR-KONO-001"]
    c = api(people["pastor_koidu"])
    d = c.post("/api/departments/", {"org_unit": str(unit.pk), "name": "Youth", "kind": "youth"}, format="json")
    assert d.status_code == 201, d.data
    did = d.data["id"]
    assert c.post("/api/departments/", {"org_unit": str(unit.pk), "name": "Youth"}, format="json").status_code == 400
    m = Member.objects.create(first_name="A", last_name="B", gender="male", org_unit=unit)
    other = Member.objects.create(first_name="C", last_name="D", gender="male", org_unit=units["BR-BO-001"])
    r = c.post("/api/department-members/", {"department": did, "member": str(m.pk)}, format="json")
    assert r.status_code == 201, r.data
    assert c.post("/api/department-members/", {"department": did, "member": str(other.pk)},
                  format="json").status_code == 400
    assert c.get(f"/api/departments/{did}/").data["member_count"] == 1
    c.post(f"/api/department-members/{r.data['id']}/leave/")
    assert c.get(f"/api/departments/{did}/").data["member_count"] == 0
    # can rejoin after leaving
    assert c.post("/api/department-members/", {"department": did, "member": str(m.pk)},
                  format="json").status_code == 201
    assert api(people["pastor_bo"]).get(f"/api/departments/{did}/").status_code == 404
