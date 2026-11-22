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
    r = c.post("/api/attendance/", rec(units["BR-KONO-001"], sunday, men=30, women=45, children=22, youth=12,
                                       young_adults=8, male=50, female=67, visitors=5), format="json")
    assert r.status_code == 201, r.data
    assert r.data["total"] == 117
    dup = c.post("/api/attendance/", rec(units["BR-KONO-001"], sunday, men=1, male=1), format="json")
    assert dup.status_code == 400
    assert c.post("/api/attendance/", rec(units["BR-KONO-001"], sunday, days_ago=-1, men=1, male=1),
                  format="json").status_code == 400
    assert c.post("/api/attendance/", rec(units["BR-KONO-001"], sunday, days_ago=1), format="json").status_code == 400
    assert c.post("/api/attendance/", rec(units["BR-KONO-001"], sunday, days_ago=2, men=2, male=2, visitors=5),
                  format="json").status_code == 400
    assert c.post("/api/attendance/", rec(units["BR-BO-001"], sunday, men=3, male=3), format="json").status_code == 403


def test_offline_client_id_is_idempotent(api, people, units, sunday):
    import uuid

    cid = str(uuid.uuid4())
    c = api(people["pastor_koidu"])
    assert c.post("/api/attendance/", rec(units["BR-KONO-001"], sunday, id=cid, men=4, male=4),
                  format="json").status_code == 201
    again = c.post("/api/attendance/", rec(units["BR-KONO-001"], sunday, days_ago=7, id=cid, men=4, male=4), format="json")
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
                                                                      str(child.pk)], men=2, male=2), format="json")
    assert r.status_code == 201, r.data
    assert (r.data["men"], r.data["women"], r.data["children"], r.data["total"]) == (3, 1, 1, 5)
    assert (r.data["male"], r.data["female"]) == (3, 2)
    assert r.data["is_individual"] is True
    assert AttendanceEntry.objects.filter(record_id=r.data["id"]).count() == 3
    s.allow_individual_attendance = False
    s.save()
    assert c.post("/api/attendance/", rec(unit, sunday, days_ago=7, present_members=[str(adult_m.pk)]),
                  format="json").status_code == 400


def test_stats_and_jurisdiction(api, people, units, sunday):
    for code, user in (("BR-KONO-001", "pastor_koidu"), ("BR-KONO-002", "pastor_lei"), ("BR-BO-001", "pastor_bo")):
        api(people[user]).post("/api/attendance/", rec(units[code], sunday, men=10, women=10, female=10, male=10, first_timers=2),
                               format="json")
    kono = api(people["kono"]).get("/api/attendance/stats/").data
    assert kono["total_attendance"] == 40
    assert api(people["admin"]).get("/api/attendance/stats/").data["total_attendance"] == 60
    assert api(people["pastor_bo"]).get(f"/api/attendance/stats/?org_unit={units['DT-KONO'].pk}").status_code == 403
    assert api(people["pastor_bo"]).get("/api/attendance/").data["count"] == 1
    assert api(people["treasurer_koidu"]).get("/api/attendance/stats/").status_code == 403


def test_ministry_and_gender_must_agree(api, people, units, sunday):
    c = api(people["pastor_koidu"])
    unit = units["BR-KONO-001"]
    bad = c.post("/api/attendance/", rec(unit, sunday, men=10, youth=5, male=10, female=4), format="json")
    assert bad.status_code == 400
    assert "male" in bad.data
    ok = c.post("/api/attendance/", rec(unit, sunday, men=10, youth=5, male=10, female=5), format="json")
    assert ok.status_code == 201, ok.data
    # A partial correction that breaks the agreement is refused; one that keeps it is accepted.
    url = f"/api/attendance/{ok.data['id']}/"
    broken = c.patch(url, {"youth": 7}, format="json")
    assert broken.status_code == 400 and "male" in broken.data, broken.data
    r = c.patch(url, {"youth": 7, "female": 7, "version": ok.data["version"]}, format="json")
    assert r.status_code == 200, r.data
    assert r.data["total"] == 17


def test_register_uses_ministry_department_then_age(api, people, units, sunday):
    from apps.departments.models import Department, DepartmentMember

    unit = units["BR-KONO-001"]
    today = timezone.localdate()
    years = lambda n: today.replace(year=today.year - n)  # noqa: E731
    youth_by_dept = Member.objects.create(first_name="Y", last_name="Dept", gender="female", org_unit=unit,
                                          date_of_birth=years(40))
    DepartmentMember.objects.create(member=youth_by_dept, department=Department.objects.create(
        org_unit=unit, name="Youth Fellowship", kind="youth"))
    teen = Member.objects.create(first_name="T", last_name="Teen", gender="male", org_unit=unit,
                                 date_of_birth=years(17))
    young = Member.objects.create(first_name="Y", last_name="Adult", gender="male", org_unit=unit,
                                  date_of_birth=years(30))
    s = SystemSetting.get()
    s.allow_individual_attendance = True
    s.save()
    r = api(people["pastor_koidu"]).post("/api/attendance/", rec(unit, sunday, present_members=[
        str(youth_by_dept.pk), str(teen.pk), str(young.pk)]), format="json")
    assert r.status_code == 201, r.data
    assert (r.data["youth"], r.data["young_adults"], r.data["male"], r.data["female"]) == (2, 1, 2, 1)


def test_weekly_services_seeded_and_analysed(api, people, units, seeded):
    services = {s.code: s for s in ServiceType.objects.filter(code__in=[
        "sunday-service", "tuesday-bible-study", "friday-prayer-deliverance"])}
    assert services["sunday-service"].name == "Sunday Divine Service"
    assert services["tuesday-bible-study"].name == "Tuesday Bible Studies"
    assert services["friday-prayer-deliverance"].name == "Friday Prayer and Deliverance Service"
    c = api(people["pastor_koidu"])
    unit = units["BR-KONO-001"]
    assert c.post("/api/attendance/", rec(unit, services["tuesday-bible-study"], days_ago=3, women=6, youth=4,
                                          male=3, female=7), format="json").status_code == 201
    assert c.post("/api/attendance/", rec(unit, services["friday-prayer-deliverance"], days_ago=2, men=5,
                                          children=3, male=6, female=2), format="json").status_code == 201
    stats = c.get("/api/attendance/stats/").data
    by_key = {s["key"]: s for s in stats["by_weekly_service"]}
    assert by_key["tuesday"]["gatherings"] == 1
    assert by_key["tuesday"]["ministry"]["youth"] == 4
    assert by_key["tuesday"]["gender"] == {"male": 3, "female": 7}
    assert by_key["friday"]["ministry"]["children"] == 3
    assert sum(w["tuesday"] + w["friday"] for w in stats["weekly"]) == 18
