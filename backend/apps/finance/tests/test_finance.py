import datetime
from decimal import Decimal

import pytest
from django.db import IntegrityError, InternalError, ProgrammingError, connection, transaction
from django.utils import timezone

from apps.configuration.models import FinanceCategory, FinancialYear
from apps.finance.models import Account, Transaction
from conftest import make_user

pytestmark = pytest.mark.django_db
DB_ERRORS = (InternalError, ProgrammingError, IntegrityError)


@pytest.fixture
def fin(units, people):
    koidu, bo = units["BR-KONO-001"], units["BR-BO-001"]
    return {
        "cash": Account.objects.create(org_unit=koidu, name="Cash box"),
        "bank": Account.objects.create(org_unit=koidu, name="Bank", kind="bank", opening_balance=Decimal("1000")),
        "bo_cash": Account.objects.create(org_unit=bo, name="Cash box"),
        "tithes": FinanceCategory.objects.get(code="tithes"),
        "utilities": FinanceCategory.objects.get(code="utilities"),
        "construction": FinanceCategory.objects.get(code="construction"),
    }


def record(api, user, account, category, amount, kind=None, **extra):
    kind = kind or category.kind
    r = api(user).post("/api/finance/transactions/", {
        "kind": kind, "account": str(account.pk), "category": str(category.pk), "amount": str(amount),
        "transaction_date": str(timezone.localdate()), "party": "Test party", **extra}, format="json")
    return r


def submit(api, user, txn_id):
    return api(user).post(f"/api/finance/transactions/{txn_id}/submit/", {}, format="json")


def approve(api, user, txn_id, comment=""):
    return api(user).post(f"/api/finance/transactions/{txn_id}/approve/", {"comment": comment}, format="json")


def test_income_flow_with_segregation(api, people, fin):
    treasurer, pastor = people["treasurer_koidu"], people["pastor_koidu"]
    r = record(api, treasurer, fin["cash"], fin["tithes"], "1500.00")
    assert r.status_code == 201, r.data
    tid = r.data["id"]
    assert r.data["status"] == "draft" and r.data["reference"] is None
    r = submit(api, treasurer, tid)
    assert r.status_code == 200 and r.data["status"] == "submitted"
    assert r.data["reference"].startswith("INC-")
    assert approve(api, treasurer, tid).status_code == 403  # cannot approve own entry
    r = approve(api, pastor, tid)
    assert r.status_code == 200 and r.data["status"] == "approved"
    summary = api(pastor).get("/api/finance/summary/").data
    assert Decimal(summary["totals"]["income"]) == Decimal("1500.00")
    receipt = api(treasurer).get(f"/api/finance/transactions/{tid}/receipt/")
    assert receipt.status_code == 200 and receipt["Content-Type"] == "application/pdf"


def test_two_level_expense_requires_district(api, people, fin):
    treasurer, pastor, kono = people["treasurer_koidu"], people["pastor_koidu"], people["kono"]
    tid = record(api, treasurer, fin["bank"], fin["utilities"], "10000").data["id"]
    r = submit(api, treasurer, tid)
    assert len(r.data["required_steps"]) == 2
    assert approve(api, people["pastor_lei"], tid).status_code in (403, 404)  # another branch
    assert approve(api, pastor, tid).data["status"] == "submitted"
    r = approve(api, pastor, tid)
    assert r.status_code == 403  # same person cannot approve the next step
    r = approve(api, kono, tid)
    assert r.status_code == 200 and r.data["status"] == "approved"


def test_major_expense_needs_headquarters(api, people, fin):
    treasurer = people["treasurer_koidu"]
    tid = record(api, treasurer, fin["bank"], fin["construction"], "30000").data["id"]
    assert len(submit(api, treasurer, tid).data["required_steps"]) == 3
    approve(api, people["pastor_koidu"], tid)
    approve(api, people["kono"], tid)
    r = approve(api, people["east"], tid)
    assert r.status_code == 403  # regional overseer is not headquarters
    r = approve(api, people["go"], tid)
    assert r.data["status"] == "approved"


def test_pastor_cannot_approve_own_submission(api, people, fin):
    pastor = people["pastor_koidu"]
    tid = record(api, pastor, fin["cash"], fin["utilities"], "200").data["id"]
    submit(api, pastor, tid)
    assert approve(api, pastor, tid).status_code == 403
    assert approve(api, people["kono"], tid).data["status"] == "approved"


def test_approved_entries_are_immutable(api, people, fin):
    treasurer, pastor = people["treasurer_koidu"], people["pastor_koidu"]
    tid = record(api, treasurer, fin["cash"], fin["tithes"], "100").data["id"]
    submit(api, treasurer, tid)
    approve(api, pastor, tid)
    r = api(treasurer).patch(f"/api/finance/transactions/{tid}/", {"amount": "999"}, format="json")
    assert r.status_code in (400, 409)
    assert api(pastor).delete(f"/api/finance/transactions/{tid}/").status_code in (403, 409)
    # Even direct SQL is refused by the database.
    with pytest.raises(DB_ERRORS), transaction.atomic(), connection.cursor() as c:
        c.execute("UPDATE finance_transaction SET amount = 1 WHERE id = %s", [tid])
    with pytest.raises(DB_ERRORS), transaction.atomic(), connection.cursor() as c:
        c.execute("DELETE FROM finance_transaction WHERE id = %s", [tid])
    with pytest.raises(DB_ERRORS), transaction.atomic(), connection.cursor() as c:
        c.execute("UPDATE finance_transactionapproval SET comment = 'x' WHERE transaction_id = %s", [tid])
    assert Transaction.objects.get(pk=tid).amount == Decimal("100")


def test_reversal_nets_to_zero(api, people, fin):
    treasurer, pastor, kono = people["treasurer_koidu"], people["pastor_koidu"], people["kono"]
    tid = record(api, treasurer, fin["cash"], fin["tithes"], "500").data["id"]
    submit(api, treasurer, tid)
    approve(api, pastor, tid)
    r = api(treasurer).post(f"/api/finance/transactions/{tid}/reverse/", {"reason": "Recorded twice"}, format="json")
    assert r.status_code == 201, r.data
    rid = r.data["id"]
    assert r.data["reference"].startswith("REV-") and r.data["status"] == "submitted"
    assert api(treasurer).post(f"/api/finance/transactions/{tid}/reverse/", {"reason": "again"},
                               format="json").status_code == 400
    approve(api, pastor, rid)
    assert approve(api, kono, rid).data["status"] == "approved"
    assert Transaction.objects.get(pk=tid).status == "reversed"
    totals = api(pastor).get("/api/finance/summary/").data["totals"]
    assert Decimal(totals["income"]) == 0


def test_return_for_correction_and_resubmit(api, people, fin):
    treasurer, pastor = people["treasurer_koidu"], people["pastor_koidu"]
    tid = record(api, treasurer, fin["cash"], fin["tithes"], "100").data["id"]
    submit(api, treasurer, tid)
    r = api(pastor).post(f"/api/finance/transactions/{tid}/reject/", {"comment": ""}, format="json")
    assert r.status_code == 400  # reason required
    r = api(pastor).post(f"/api/finance/transactions/{tid}/reject/",
                         {"comment": "Amount does not match the count sheet", "return_to_draft": True}, format="json")
    assert r.data["status"] == "draft"
    r = api(treasurer).patch(f"/api/finance/transactions/{tid}/", {"amount": "120"}, format="json")
    assert r.status_code == 200, r.data
    ref = submit(api, treasurer, tid).data["reference"]
    assert approve(api, pastor, tid).data["reference"] == ref  # reference kept


def test_validation_rules(api, people, fin, units):
    t = people["treasurer_koidu"]
    assert record(api, t, fin["cash"], fin["tithes"], "100", kind="expense").status_code == 400  # wrong kind
    assert record(api, t, fin["cash"], fin["tithes"], "0").status_code == 400
    assert record(api, t, fin["cash"], fin["tithes"], "-5").status_code == 400
    future = str(timezone.localdate() + datetime.timedelta(days=3))
    assert record(api, t, fin["cash"], fin["tithes"], "10", transaction_date=future).status_code == 400
    r = record(api, t, fin["bo_cash"], fin["tithes"], "10")
    assert r.status_code in (400, 403)  # another branch's account
    fy = FinancialYear.for_date(timezone.localdate())
    fy.is_closed = True
    fy.save()
    assert record(api, t, fin["cash"], fin["tithes"], "10").status_code == 400


def test_jurisdiction_isolation(api, people, fin):
    tid = record(api, people["treasurer_koidu"], fin["cash"], fin["tithes"], "100").data["id"]
    assert api(people["pastor_bo"]).get(f"/api/finance/transactions/{tid}/").status_code == 404
    assert api(people["south"]).get("/api/finance/transactions/").data["count"] == 0
    assert api(people["east"]).get("/api/finance/transactions/").data["count"] == 1
    assert api(people["pastor_bo"]).get("/api/finance/accounts/").data["count"] == 1
    member_officer = make_user("members_only", "membership_officer", fin["cash"].org_unit)
    assert api(member_officer).get("/api/finance/transactions/").status_code == 403
    assert api(member_officer).get("/api/finance/summary/").status_code == 403


def test_awaiting_and_dashboard(api, people, fin):
    t = people["treasurer_koidu"]
    tid = record(api, t, fin["bank"], fin["utilities"], "10000").data["id"]
    submit(api, t, tid)
    assert [x["id"] for x in api(people["pastor_koidu"]).get("/api/finance/transactions/awaiting/").data] == [tid]
    assert api(people["kono"]).get("/api/finance/transactions/awaiting/").data != []  # can do step 1 too
    approve(api, people["pastor_koidu"], tid)
    assert api(people["pastor_koidu"]).get("/api/finance/transactions/awaiting/").data == []
    dash = api(people["kono"]).get("/api/dashboard/").data
    assert "finance" in dash
    keys = [i["key"] for i in dash["attention"]["items"]]
    assert "finance_approvals" in keys


def test_budget_workflow(api, people, fin, units):
    pastor, kono = people["pastor_koidu"], people["kono"]
    fy = FinancialYear.for_date(timezone.localdate())
    r = api(pastor).post("/api/finance/budgets/", {
        "org_unit": str(units["BR-KONO-001"].pk), "financial_year": str(fy.pk), "name": "Operating budget",
        "lines": [{"category": str(fin["tithes"].pk), "amount": "50000"},
                  {"category": str(fin["utilities"].pk), "amount": "6000"}]}, format="json")
    assert r.status_code == 201, r.data
    bid = r.data["id"]
    assert r.data["total_income"] == Decimal("50000") or float(r.data["total_income"]) == 50000
    assert api(pastor).post(f"/api/finance/budgets/{bid}/submit/").status_code == 200
    assert api(pastor).post(f"/api/finance/budgets/{bid}/decide/", {"decision": "approve"},
                            format="json").status_code == 403
    r = api(kono).post(f"/api/finance/budgets/{bid}/decide/", {"decision": "approve"}, format="json")
    assert r.status_code == 200 and r.data["status"] == "approved"
    assert api(pastor).patch(f"/api/finance/budgets/{bid}/", {"name": "x"}, format="json").status_code in (400, 409)
    tid = record(api, people["treasurer_koidu"], fin["cash"], fin["utilities"], "1500").data["id"]
    submit(api, people["treasurer_koidu"], tid)
    approve(api, pastor, tid)
    perf = {row["category_name"]: row for row in api(pastor).get(f"/api/finance/budgets/{bid}/performance/").data}
    assert Decimal(perf["Utility bills"]["actual"]) == Decimal("1500")


def test_reconciliation(api, people, fin):
    t, pastor = people["treasurer_koidu"], people["pastor_koidu"]
    tid = record(api, t, fin["bank"], fin["tithes"], "250").data["id"]
    submit(api, t, tid)
    approve(api, pastor, tid)
    r = api(pastor).post("/api/finance/reconciliations/", {
        "account": str(fin["bank"].pk), "as_of": str(timezone.localdate()), "statement_balance": "1200"},
        format="json")
    assert r.status_code == 201, r.data
    assert Decimal(r.data["book_balance"]) == Decimal("1250") and Decimal(r.data["difference"]) == Decimal("-50")


def test_policy_admin_only(api, people):
    body = {"name": "Big income", "applies_to": "income", "min_amount": "100000", "currency": "SLE",
            "priority": 1, "steps": [{"order": 1, "level": "unit"}, {"order": 2, "level": "district"}]}
    assert api(people["pastor_koidu"]).post("/api/finance/approval-policies/", body, format="json").status_code == 403
    assert api(people["admin"]).post("/api/finance/approval-policies/", body, format="json").status_code == 201
    assert len(api(people["pastor_koidu"]).get("/api/finance/approval-policies/").data) == 6
