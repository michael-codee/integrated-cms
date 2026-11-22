"""Monthly membership dues: recorded as income entries that follow the finance approval rules."""
import datetime
from decimal import Decimal

import pytest
from django.db import connection, transaction
from django.utils import timezone

from apps.configuration.models import FinanceCategory, SystemSetting
from apps.finance.models import Account, Transaction, add_months
from apps.members.models import Member

from conftest import make_user

from .test_finance import DB_ERRORS, approve, submit

pytestmark = pytest.mark.django_db


@pytest.fixture
def dues(units, people):
    koidu, bo = units["BR-KONO-001"], units["BR-BO-001"]
    return {
        "cash": Account.objects.create(org_unit=koidu, name="Cash box"),
        "bo_cash": Account.objects.create(org_unit=bo, name="Cash box"),
        "category": FinanceCategory.objects.get(code="membership-dues"),
        "tithes": FinanceCategory.objects.get(code="tithes"),
        "ama": Member.objects.create(org_unit=koidu, first_name="Ama", last_name="Kamara", gender="female",
                                     membership_no="RLWM-T-1"),
        "sahr": Member.objects.create(org_unit=koidu, first_name="Sahr", last_name="Fomba", gender="male",
                                      membership_no="RLWM-T-2"),
        "bo_member": Member.objects.create(org_unit=bo, first_name="Fatu", last_name="Sesay", gender="female"),
    }


def this_month(offset=0):
    return add_months(timezone.localdate().replace(day=1), offset)


def pay(api, user, d, who, amount, month=None, months=1, account=None, **extra):
    return api(user).post("/api/finance/transactions/", {
        "kind": "income", "account": str((account or d["cash"]).pk), "category": str(d["category"].pk),
        "amount": str(amount), "transaction_date": str(timezone.localdate()), "member": str(who.pk),
        "dues_month": str(month or this_month()), "dues_months": months, "party": who.full_name, **extra,
    }, format="json")


def test_dues_follow_income_approval(api, people, dues):
    treasurer, pastor = people["treasurer_koidu"], people["pastor_koidu"]
    r = pay(api, treasurer, dues, dues["ama"], "300", month=this_month().replace(day=17), months=3)
    assert r.status_code == 201, r.data
    assert r.data["status"] == "draft"
    assert r.data["dues_month"] == str(this_month())  # normalised to the 1st
    assert r.data["dues_months"] == 3
    tid = r.data["id"]
    r = submit(api, treasurer, tid)
    assert r.status_code == 200 and r.data["status"] == "submitted"
    assert r.data["reference"].startswith("INC-")
    assert r.data["required_steps"][0]["label"] == "Confirmation by Pastor-in-Charge"
    assert approve(api, treasurer, tid).status_code == 403  # segregation of duties still applies
    reg = api(pastor).get("/api/finance/dues/register/", {"org_unit": str(dues["ama"].org_unit_id),
                                                           "year": this_month().year}).data
    ama = next(row for row in reg["results"] if row["member"]["id"] == str(dues["ama"].pk))
    assert Decimal(ama["total_paid"]) == 0 and Decimal(ama["total_pending"]) > 0
    assert approve(api, pastor, tid).data["status"] == "approved"
    reg = api(pastor).get("/api/finance/dues/register/", {"org_unit": str(dues["ama"].org_unit_id),
                                                           "year": this_month().year}).data
    ama = next(row for row in reg["results"] if row["member"]["id"] == str(dues["ama"].pk))
    paid_in_year = [m for m in (this_month(i) for i in range(3)) if m.year == this_month().year]
    assert ama["months_paid"] == len(paid_in_year)
    assert Decimal(ama["paid"][this_month().month - 1]) == Decimal("100.00")
    assert Decimal(ama["total_pending"]) == 0
    assert reg["totals"]["members_paid_by_month"][this_month().month - 1] == 1
    # A receipt is available, as for any approved income.
    assert api(treasurer).get(f"/api/finance/transactions/{tid}/receipt/").status_code == 200


def test_auto_approval_setting_applies_to_dues(api, people, dues):
    s = SystemSetting.get()
    s.require_income_approval = False
    s.save()
    tid = pay(api, people["treasurer_koidu"], dues, dues["ama"], "100").data["id"]
    assert submit(api, people["treasurer_koidu"], tid).data["status"] == "approved"


def test_dues_need_member_and_month(api, people, dues):
    t = people["treasurer_koidu"]
    r = pay(api, t, dues, dues["ama"], "100", member=None)
    assert r.status_code == 400 and r.data["code"] == "dues_member"
    r = pay(api, t, dues, dues["ama"], "100", dues_month=None)
    assert r.status_code == 400 and r.data["code"] == "dues_month"
    assert pay(api, t, dues, dues["ama"], "100", months=13).status_code == 400
    assert pay(api, t, dues, dues["ama"], "100", month=this_month(13)).status_code == 400  # too far ahead
    # Months can only be given on dues entries.
    r = pay(api, t, dues, dues["ama"], "100", category=str(dues["tithes"].pk))
    assert r.status_code == 400 and r.data["code"] == "dues_category"


def test_same_month_cannot_be_paid_twice(api, people, dues):
    t, pastor = people["treasurer_koidu"], people["pastor_koidu"]
    first = pay(api, t, dues, dues["ama"], "200", month=this_month(-1), months=2).data["id"]
    # Two drafts for the same month can exist (e.g. one saved offline) ...
    second = pay(api, t, dues, dues["ama"], "100", month=this_month())
    assert second.status_code == 201
    submit(api, t, first)
    # ... but only the first one submitted goes through.
    r = submit(api, t, second.data["id"])
    assert r.status_code == 400 and r.data["code"] == "dues_duplicate"
    assert "already recorded" in r.data["detail"]
    # A new entry for a month already submitted is refused straight away.
    r = pay(api, t, dues, dues["ama"], "100", month=this_month())
    assert r.status_code == 400 and r.data["code"] == "dues_duplicate"
    # Another member, or a month that is not covered, is fine.
    assert pay(api, t, dues, dues["sahr"], "100", month=this_month()).status_code == 201
    assert pay(api, t, dues, dues["ama"], "100", month=this_month(1)).status_code == 201
    # Once the first payment is approved and then reversed, the months are free again.
    approve(api, pastor, first)
    rev = api(t).post(f"/api/finance/transactions/{first}/reverse/", {"reason": "Wrong member"}, format="json")
    assert rev.status_code == 201, rev.data
    approve(api, pastor, rev.data["id"])
    approve(api, people["kono"], rev.data["id"])
    assert Transaction.objects.get(pk=first).status == "reversed"
    r = submit(api, t, second.data["id"])
    assert r.status_code == 200, r.data


def test_rejected_dues_free_the_month(api, people, dues):
    t, pastor = people["treasurer_koidu"], people["pastor_koidu"]
    first = pay(api, t, dues, dues["ama"], "100").data["id"]
    submit(api, t, first)
    r = api(pastor).post(f"/api/finance/transactions/{first}/reject/", {"comment": "Not received"}, format="json")
    assert r.status_code == 200
    second = pay(api, t, dues, dues["ama"], "100").data["id"]
    assert submit(api, t, second).status_code == 200


def test_dues_period_locked_after_submission(api, people, dues):
    t = people["treasurer_koidu"]
    tid = pay(api, t, dues, dues["ama"], "100").data["id"]
    submit(api, t, tid)
    with pytest.raises(DB_ERRORS), transaction.atomic():
        with connection.cursor() as c:
            c.execute("UPDATE finance_transaction SET dues_months = 5 WHERE id = %s", [tid])
    with pytest.raises(DB_ERRORS), transaction.atomic():
        with connection.cursor() as c:
            c.execute("UPDATE finance_transaction SET member_id = %s WHERE id = %s", [dues["sahr"].pk, tid])


def test_register_and_member_search_are_scoped(api, people, dues):
    t = people["treasurer_koidu"]
    found = api(t).get("/api/finance/dues/members/", {"search": "kam"}).data
    assert [m["id"] for m in found] == [str(dues["ama"].pk)]
    assert api(t).get("/api/finance/dues/members/", {"search": "Sesay"}).data == []  # Bo is outside Koidu
    assert api(t).get("/api/finance/dues/register/", {"org_unit": str(dues["bo_member"].org_unit_id)}).status_code == 403
    reg = api(t).get("/api/finance/dues/register/").data
    ids = {row["member"]["id"] for row in reg["results"]}
    assert ids == {str(dues["ama"].pk), str(dues["sahr"].pk)}
    # Treasurers cannot record dues for members outside their unit.
    r = pay(api, t, dues, dues["bo_member"], "100")
    assert r.status_code == 400 and r.data["code"] == "member_scope"
    # Users without finance access get nothing.
    officer = make_user("membership_koidu", "membership_officer", dues["ama"].org_unit)
    assert api(officer).get("/api/finance/dues/register/").status_code == 403
    assert api(officer).get("/api/finance/dues/members/", {"search": "kam"}).status_code == 403


def test_register_spreads_multi_month_payment_across_years(api, people, dues):
    t, pastor = people["treasurer_koidu"], people["pastor_koidu"]
    # Dues paid in advance from November of last year for four months, recorded before this test's dates.
    start = datetime.date(timezone.localdate().year - 1, 11, 1)
    txn = pay(api, t, dues, dues["sahr"], "400", month=start, months=4)
    assert txn.status_code == 201, txn.data
    submit(api, t, txn.data["id"])
    approve(api, pastor, txn.data["id"])
    year = timezone.localdate().year
    reg = api(pastor).get("/api/finance/dues/register/", {"year": year}).data
    sahr = next(row for row in reg["results"] if row["member"]["id"] == str(dues["sahr"].pk))
    assert [Decimal(v) for v in sahr["paid"][:3]] == [Decimal("100.00"), Decimal("100.00"), Decimal("0")]
    prev = api(pastor).get("/api/finance/dues/register/", {"year": year - 1}).data
    sahr = next(row for row in prev["results"] if row["member"]["id"] == str(dues["sahr"].pk))
    assert sahr["months_paid"] == 2
