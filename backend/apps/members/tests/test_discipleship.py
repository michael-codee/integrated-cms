import datetime
import uuid

import pytest

from apps.members.models import DiscipleshipCompletion, Member, MembershipHistory

pytestmark = pytest.mark.django_db

CLASSES = ["foundation", "discipleship", "spiritual_growth"]


@pytest.fixture
def member(api, people, units):
    res = api(people["pastor_koidu"]).post("/api/members/", {
        "first_name": "Sahr", "last_name": "Komba", "gender": "male", "date_of_birth": "1988-02-03",
        "org_unit": str(units["BR-KONO-001"].pk)}, format="json")
    assert res.status_code == 201, res.data
    return Member.objects.get(pk=res.data["id"])


def complete(client, member, course, on="2026-03-01", **extra):
    return client.post(f"/api/members/{member.pk}/discipleship/",
                       {"course": course, "completed_on": on, **extra}, format="json")


def test_badge_awarded_only_after_all_three_classes(api, people, member):
    client = api(people["pastor_koidu"])
    assert complete(client, member, "foundation", "2026-01-10").status_code == 201
    assert complete(client, member, "discipleship", "2026-04-02").status_code == 201
    member.refresh_from_db()
    assert member.discipleship_badge_on is None
    res = complete(client, member, "spiritual_growth", "2026-08-20", facilitator="Rev. Sesay")
    assert res.status_code == 201, res.data
    assert res.data["course_name"] == "Spiritual Growth Class"
    member.refresh_from_db()
    assert member.discipleship_badge_on == datetime.date(2026, 8, 20)
    events = set(MembershipHistory.objects.filter(member=member).values_list("event", flat=True))
    assert {"class_completed", "badge_awarded"} <= events
    detail = client.get(f"/api/members/{member.pk}/").data
    assert detail["discipleship_badge_on"] == "2026-08-20"


def test_badge_date_is_the_last_class_even_if_taken_out_of_order(api, people, member):
    client = api(people["pastor_koidu"])
    complete(client, member, "spiritual_growth", "2026-02-01")
    complete(client, member, "foundation", "2026-05-01")
    complete(client, member, "discipleship", "2026-03-01")
    member.refresh_from_db()
    assert member.discipleship_badge_on == datetime.date(2026, 5, 1)


def test_each_class_is_recorded_once(api, people, member):
    client = api(people["pastor_koidu"])
    assert complete(client, member, "foundation").status_code == 201
    again = complete(client, member, "foundation", "2026-03-05")
    assert again.status_code == 400
    assert DiscipleshipCompletion.objects.filter(member=member).count() == 1


def test_rejects_future_dates_and_unknown_classes(api, people, member):
    client = api(people["pastor_koidu"])
    future = (datetime.date.today() + datetime.timedelta(days=3)).isoformat()
    assert complete(client, member, "foundation", future).status_code == 400
    assert complete(client, member, "bible_school").status_code == 400


def test_offline_client_id_is_kept(api, people, member):
    rid = str(uuid.uuid4())
    res = complete(api(people["pastor_koidu"]), member, "foundation", id=rid)
    assert res.status_code == 201 and res.data["id"] == rid


def test_other_branch_cannot_record_or_see(api, people, member):
    assert complete(api(people["pastor_bo"]), member, "foundation").status_code == 404
    complete(api(people["pastor_koidu"]), member, "foundation")
    assert api(people["pastor_bo"]).get("/api/discipleship-completions/").data["count"] == 0
    assert api(people["kono"]).get("/api/discipleship-completions/").data["count"] == 1


def test_removing_a_class_revokes_the_badge(api, people, member):
    client = api(people["pastor_koidu"])
    ids = [complete(client, member, c).data["id"] for c in CLASSES]
    member.refresh_from_db()
    assert member.discipleship_badge_on
    res = client.post(f"/api/discipleship-completions/{ids[1]}/remove/", {"reason": "Entered in error"},
                      format="json")
    assert res.status_code == 204
    member.refresh_from_db()
    assert member.discipleship_badge_on is None
    assert MembershipHistory.objects.filter(member=member, event="badge_revoked").exists()
    # It can be recorded again afterwards.
    assert complete(client, member, "discipleship", "2026-06-01").status_code == 201
    member.refresh_from_db()
    assert member.discipleship_badge_on == datetime.date(2026, 6, 1)


def test_register_lists_progress_and_filters(api, people, units, member):
    client = api(people["pastor_koidu"])
    other = Member.objects.get(pk=client.post("/api/members/", {
        "first_name": "Isata", "last_name": "Conteh", "gender": "female",
        "org_unit": str(units["BR-KONO-001"].pk)}, format="json").data["id"])
    for c in CLASSES:
        complete(client, member, c)
    complete(client, other, "foundation")

    rows = {r["full_name"]: r for r in client.get("/api/discipleship-register/").data["results"]}
    assert rows["Sahr Komba"]["classes_completed"] == 3 and rows["Sahr Komba"]["discipleship_badge_on"]
    assert rows["Isata Conteh"]["classes_completed"] == 1 and rows["Isata Conteh"]["foundation_on"] == "2026-03-01"
    assert rows["Isata Conteh"]["discipleship_on"] is None

    def names(**params):
        return {r["full_name"] for r in client.get("/api/discipleship-register/", params).data["results"]}
    assert names(progress="badge") == {"Sahr Komba"}
    assert names(progress="in_progress") == {"Isata Conteh"}
    assert names(missing="discipleship") == {"Isata Conteh"}
    assert names(completed="foundation") == {"Sahr Komba", "Isata Conteh"}
    assert {m["full_name"] for m in client.get("/api/members/", {"discipleship_badge": "true"}).data["results"]} \
        == {"Sahr Komba"}

    summary = client.get("/api/discipleship-register/summary/").data
    assert summary["badges"] == 1 and summary["started"] == 2
    assert {c["value"]: c["count"] for c in summary["by_class"]}["foundation"] == 2
    assert api(people["pastor_bo"]).get("/api/discipleship-register/").data["count"] == 0


def test_register_export(api, people, member):
    client = api(people["pastor_koidu"])
    for c in CLASSES:
        complete(client, member, c)
    res = client.get("/api/discipleship-register/export/", {"file_format": "csv"})
    assert res.status_code == 200
    body = res.content.decode()
    assert "Spiritual Growth Class" in body and "Awarded 2026-03-01" in body
