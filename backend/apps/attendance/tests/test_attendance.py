import datetime

import pytest
from django.utils import timezone

from apps.attendance.models import AttendanceEntry
from apps.configuration.models import ServiceType, SystemSetting
from apps.members.models import Member

pytestmark = pytest.mark.django_db


@pytest.fixture
def sunday(seeded):
    return ServiceType.objects.first()


def rec(unit, service, days_ago=0, **extra):
    return {"org_unit": str(unit.pk), "service_type": str(service.pk),
            "date": str(timezone.localdate() - datetime.timedelta(days=days_ago)), **extra}


def test_record_and_uniqueness(api, people, units, sunday):
    c = api(people["pastor_koidu"])
    r = c.post("/api/attendance/", rec(units["BR-KONO-001"], sunday, men=30, women=45, boys=10, girls=12,
                                       visitors=5), format="json")
    assert r.status_code == 201, r.data
    assert r.data["total"] == 97
    dup = c.post("/api/attendance/", rec(units["BR-KONO-001"], sunday, men=1), format="json")
    assert dup.status_code == 400
    assert c.post("/api/attendance/", rec(units["BR-KONO-001"], sunday, days_ago=-1, men=1),
                  format="json").status_code == 400
    assert c.post("/api/attendance/", rec(units["BR-KONO-001"], sunday, days_ago=1), format="json").status_code == 400
    assert c.post("/api/attendance/", rec(units["BR-KONO-001"], sunday, days_ago=2, men=2, visitors=5),
                  format="json").status_code == 400
    assert c.post("/api/attendance/", rec(units["BR-BO-001"], sunday, men=3), format="json").status_code == 403


def test_offline_client_id_is_idempotent(api, people, units, sunday):
    import uuid

    cid = str(uuid.uuid4())
    c = api(people["pastor_koidu"])
    assert c.post("/api/attendance/", rec(units["BR-KONO-001"], sunday, id=cid, men=4),
                  format="json").status_code == 201
    again = c.post("/api/attendance/", rec(units["BR-KONO-001"], sunday, days_ago=7, id=cid, men=4), format="json")
    assert again.status_code == 400


def test_individual_register_derives_counts(api, people, units, sunday):
    unit = units["BR-KONO-001"]
    today = timezone.localdate()
    adult_m = Member.objects.create(first_name="A", last_name="One", gender="male", org_unit=unit,
                                    date_of_birth=today.replace(year=today.year - 40))
    adult_f = Member.objects.create(first_name="B", last_name="Two", gender="female", org_unit=unit)
    child = Member.objects.create(first_name="C", last_name="Three", gender="female", org_unit=unit,
                                  date_of_birth=today.replace(year=today.year - 8))
    elsewhere = Member.objects.create(first_name="D", last_name="Four", gender="male", org_unit=units["BR-BO-001"])
    s = SystemSetting.get()
    s.allow_individual_attendance = True
    s.save()
    c = api(people["pastor_koidu"])
    bad = c.post("/api/attendance/", rec(unit, sunday, present_members=[str(elsewhere.pk)]), format="json")
    assert bad.status_code == 400
    r = c.post("/api/attendance/", rec(unit, sunday, present_members=[str(adult_m.pk), str(adult_f.pk),
                                                                      str(child.pk)], men=2), format="json")
    assert r.status_code == 201, r.data
    assert (r.data["men"], r.data["women"], r.data["girls"], r.data["total"]) == (3, 1, 1, 5)
    assert r.data["is_individual"] is True
    assert AttendanceEntry.objects.filter(record_id=r.data["id"]).count() == 3
    s.allow_individual_attendance = False
    s.save()
    assert c.post("/api/attendance/", rec(unit, sunday, days_ago=7, present_members=[str(adult_m.pk)]),
                  format="json").status_code == 400


def test_stats_and_jurisdiction(api, people, units, sunday):
    for code, user in (("BR-KONO-001", "pastor_koidu"), ("BR-KONO-002", "pastor_lei"), ("BR-BO-001", "pastor_bo")):
        api(people[user]).post("/api/attendance/", rec(units[code], sunday, men=10, women=10, first_timers=2),
                               format="json")
    kono = api(people["kono"]).get("/api/attendance/stats/").data
    assert kono["total_attendance"] == 40
    assert api(people["admin"]).get("/api/attendance/stats/").data["total_attendance"] == 60
    assert api(people["pastor_bo"]).get(f"/api/attendance/stats/?org_unit={units['DT-KONO'].pk}").status_code == 403
    assert api(people["pastor_bo"]).get("/api/attendance/").data["count"] == 1
    assert api(people["treasurer_koidu"]).get("/api/attendance/stats/").status_code == 403
