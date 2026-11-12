import datetime
import uuid

import pytest

from apps.members.models import BaptismRecord, Member, MembershipHistory, MemberTransfer

pytestmark = pytest.mark.django_db


def member_payload(unit, **extra):
    return {"first_name": "Fatmata", "last_name": "Kamara", "gender": "female", "date_of_birth": "1990-04-12",
            "phone": "+232 76 123456", "org_unit": str(unit.pk), "joined_on": "2025-01-05", **extra}


@pytest.fixture
def koidu_member(api, people, units):
    res = api(people["pastor_koidu"]).post("/api/members/", member_payload(units["BR-KONO-001"]), format="json")
    assert res.status_code == 201, res.data
    return Member.objects.get(pk=res.data["id"])


def test_registration_assigns_number_and_history(koidu_member):
    assert koidu_member.membership_no.startswith("RLWM-")
    assert MembershipHistory.objects.filter(member=koidu_member, event="registered").exists()


def test_offline_client_id_is_respected_and_duplicates_rejected(api, people, units):
    client_id = str(uuid.uuid4())
    client = api(people["pastor_koidu"])
    res = client.post("/api/members/", member_payload(units["BR-KONO-001"], id=client_id), format="json")
    assert res.status_code == 201 and res.data["id"] == client_id
    again = client.post("/api/members/", member_payload(units["BR-KONO-001"], id=client_id), format="json")
    assert again.status_code == 400
    assert Member.objects.filter(pk=client_id).count() == 1


def test_pastor_cannot_register_in_another_branch(api, people, units):
    res = api(people["pastor_koidu"]).post("/api/members/", member_payload(units["BR-BO-001"]), format="json")
    assert res.status_code == 403


def test_members_must_belong_to_a_branch(api, people, units):
    res = api(people["admin"]).post("/api/members/", member_payload(units["DT-KONO"]), format="json")
    assert res.status_code == 400


def test_member_visibility_follows_jurisdiction(api, people, units, koidu_member):
    api(people["pastor_bo"]).post("/api/members/", member_payload(units["BR-BO-001"], first_name="Hawa"), format="json")
    def names(user):
        return {m["first_name"] for m in api(user).get("/api/members/").data["results"]}
    assert names(people["go"]) == {"Fatmata", "Hawa"}
    assert names(people["east"]) == {"Fatmata"}
    assert names(people["kono"]) == {"Fatmata"}
    assert names(people["pastor_bo"]) == {"Hawa"}
    assert names(people["pastor_lei"]) == set()
    assert api(people["pastor_bo"]).get(f"/api/members/{koidu_member.pk}/").status_code == 404


def test_update_records_history_and_audit(api, people, koidu_member):
    res = api(people["pastor_koidu"]).patch(f"/api/members/{koidu_member.pk}/", {"phone": "+232 77 000000"},
                                            format="json")
    assert res.status_code == 200
    h = MembershipHistory.objects.filter(member=koidu_member, event="updated").first()
    assert h.changes["phone"] == ["+232 76 123456", "+232 77 000000"]


def test_cannot_move_branch_by_editing(api, people, units, koidu_member):
    res = api(people["admin"]).patch(f"/api/members/{koidu_member.pk}/", {"org_unit": str(units["BR-BO-001"].pk)},
                                     format="json")
    assert res.status_code == 400


def test_transfer_requires_receiving_approval_and_does_not_duplicate(api, people, units, koidu_member):
    count_before = Member.objects.count()
    res = api(people["pastor_koidu"]).post("/api/member-transfers/", {
        "member": str(koidu_member.pk), "to_unit": str(units["BR-BO-001"].pk), "reason": "Relocated to Bo"},
        format="json")
    assert res.status_code == 201, res.data
    assert res.data["status"] == "pending"
    transfer_id = res.data["id"]
    # The sending pastor cannot approve on behalf of Bo
    assert api(people["pastor_koidu"]).post(f"/api/member-transfers/{transfer_id}/decide/", {"approve": True},
                                            format="json").status_code in (403, 404)
    # Bo pastor sees it as incoming and approves
    incoming = api(people["pastor_bo"]).get("/api/member-transfers/?direction=incoming")
    assert [t["id"] for t in incoming.data["results"]] == [transfer_id]
    res = api(people["pastor_bo"]).post(f"/api/member-transfers/{transfer_id}/decide/", {"approve": True},
                                        format="json")
    assert res.status_code == 200 and res.data["status"] == "completed"
    koidu_member.refresh_from_db()
    assert koidu_member.org_unit == units["BR-BO-001"]
    assert Member.objects.count() == count_before
    assert MembershipHistory.objects.filter(member=koidu_member, event="transferred").exists()
    # now visible to Bo, not to Koidu
    assert api(people["pastor_bo"]).get(f"/api/members/{koidu_member.pk}/").status_code == 200
    assert api(people["pastor_koidu"]).get(f"/api/members/{koidu_member.pk}/").status_code == 404


def test_transfer_by_officer_authorised_for_both_branches_completes_immediately(api, people, units, koidu_member):
    res = api(people["admin"]).post("/api/member-transfers/", {
        "member": str(koidu_member.pk), "to_unit": str(units["BR-KONO-002"].pk)}, format="json")
    assert res.status_code == 201 and res.data["status"] == "completed"


def test_only_one_pending_transfer(api, people, units, koidu_member):
    client = api(people["pastor_koidu"])
    payload = {"member": str(koidu_member.pk), "to_unit": str(units["BR-BO-001"].pk)}
    assert client.post("/api/member-transfers/", payload, format="json").status_code == 201
    assert client.post("/api/member-transfers/", payload, format="json").status_code == 400


def test_rejected_transfer_leaves_member_in_place(api, people, units, koidu_member):
    t = api(people["pastor_koidu"]).post("/api/member-transfers/", {
        "member": str(koidu_member.pk), "to_unit": str(units["BR-BO-001"].pk)}, format="json").data
    api(people["pastor_bo"]).post(f"/api/member-transfers/{t['id']}/decide/", {"approve": False, "note": "Unknown"},
                                  format="json")
    koidu_member.refresh_from_db()
    assert koidu_member.org_unit == units["BR-KONO-001"]
    assert MemberTransfer.objects.get(pk=t["id"]).status == "rejected"


def test_baptism_updates_member(api, people, koidu_member):
    res = api(people["pastor_koidu"]).post(f"/api/members/{koidu_member.pk}/baptize/", {
        "date": "2026-03-01", "location": "Meya River", "officiated_by": "Rev. Example"}, format="json")
    assert res.status_code == 201, res.data
    koidu_member.refresh_from_db()
    assert koidu_member.baptism_status == "baptized"
    assert BaptismRecord.objects.filter(member=koidu_member).count() == 1


def test_exit_is_recorded(api, people, koidu_member):
    res = api(people["pastor_koidu"]).post(f"/api/members/{koidu_member.pk}/status/", {
        "status": "withdrawn", "reason": "Relocated abroad"}, format="json")
    assert res.status_code == 200
    koidu_member.refresh_from_db()
    assert koidu_member.status == "withdrawn" and koidu_member.exit_reason == "Relocated abroad"
    assert MembershipHistory.objects.filter(member=koidu_member, event="exited").exists()


def test_photo_requires_consent(api, people, units):
    from django.core.files.uploadedfile import SimpleUploadedFile
    from PIL import Image
    import io

    buf = io.BytesIO()
    Image.new("RGB", (10, 10)).save(buf, "PNG")
    photo = SimpleUploadedFile("p.png", buf.getvalue(), content_type="image/png")
    res = api(people["pastor_koidu"]).post("/api/members/", {**member_payload(units["BR-KONO-001"]), "photo": photo},
                                           format="multipart")
    assert res.status_code == 400 and "photo" in res.data


def test_stats_match_database(api, people, units):
    client = api(people["pastor_koidu"])
    for i, (g, dob) in enumerate([("male", "2015-01-01"), ("female", "1980-01-01"), ("female", None)]):
        client.post("/api/members/", member_payload(units["BR-KONO-001"], first_name=f"P{i}", gender=g,
                                                    date_of_birth=dob), format="json")
    stats = api(people["go"]).get("/api/members/stats/").data
    assert stats["total"] == Member.objects.count() == 3
    assert stats["male"] == 1 and stats["female"] == 2
    groups = {g["label"]: g["count"] for g in stats["by_age_group"]}
    assert groups["0-12"] == 1 and groups["36-59"] == 1 and groups["unknown"] == 1
    assert stats["by_region"][0]["name"] == "Eastern Region" and stats["by_region"][0]["count"] == 3
    assert stats["growth"][-1]["total"] == 3
    # Bo pastor sees zero
    assert api(people["pastor_bo"]).get("/api/members/stats/").data["total"] == 0


@pytest.mark.parametrize("fmt,ctype", [("csv", "text/csv"), ("xlsx", "spreadsheetml"), ("pdf", "application/pdf")])
def test_exports(api, people, koidu_member, fmt, ctype):
    res = api(people["pastor_koidu"]).get(f"/api/members/export/?file_format={fmt}")
    assert res.status_code == 200, getattr(res, "data", None)
    assert ctype in res["Content-Type"]
    assert len(res.content) > 100
    from apps.audit.models import AuditLog

    assert AuditLog.objects.filter(action="export", entity="Membership register").exists()


def test_export_requires_permission(api, people, units):
    # A minister has members.view but not members.export
    from conftest import make_user

    minister = make_user("minister_koidu", "minister", units["BR-KONO-001"])
    assert api(minister).get("/api/members/export/?file_format=csv").status_code == 403


def test_duplicate_check(api, people, koidu_member):
    res = api(people["pastor_koidu"]).get("/api/members/check-duplicates/?first_name=fatmata&last_name=KAMARA"
                                          "&date_of_birth=1990-04-12")
    assert len(res.data["matches"]) == 1
    other = api(people["pastor_bo"]).get("/api/members/check-duplicates/?first_name=fatmata&last_name=KAMARA"
                                         "&date_of_birth=1990-04-12")
    assert other.data["matches"] == [] and other.data["outside_jurisdiction"] == 1


def test_future_dates_rejected(api, people, units):
    future = (datetime.date.today() + datetime.timedelta(days=5)).isoformat()
    res = api(people["pastor_koidu"]).post("/api/members/", member_payload(units["BR-KONO-001"], date_of_birth=future),
                                           format="json")
    assert res.status_code == 400
