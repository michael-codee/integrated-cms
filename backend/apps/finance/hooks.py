"""Registers finance with the shared seed, dashboard and demo-data hooks."""
import datetime
from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone

from apps.core import demo_hooks, seed_hooks, scoping
from apps.dashboard import sections

# --------------------------------------------------------------------------- seed

DEFAULT_POLICIES = [
    # name, applies_to, min, max, steps[(level, label)]
    ("Income confirmation", "income", 0, None, [("unit", "Confirmation by Pastor-in-Charge")]),
    ("Expenditure — routine", "expense", 0, 5000, [("unit", "Pastor-in-Charge")]),
    ("Expenditure — significant", "expense", 5000, 25000,
     [("unit", "Pastor-in-Charge"), ("district", "District Overseer")]),
    ("Expenditure — major", "expense", 25000, None,
     [("unit", "Pastor-in-Charge"), ("district", "District Overseer"), ("headquarters", "Headquarters")]),
    ("Reversal of an approved entry", "reversal", 0, None,
     [("unit", "Pastor-in-Charge"), ("district", "District Overseer")]),
]


def seed_policies():
    """Initial thresholds (in Leones). They are starting values only and are
    expected to be adjusted by leadership in Settings → Finance approvals."""
    from .models import ApprovalPolicy, ApprovalPolicyStep

    if ApprovalPolicy.objects.exists():
        return
    for i, (name, applies, lo, hi, steps) in enumerate(DEFAULT_POLICIES):
        p = ApprovalPolicy.objects.create(
            name=name, applies_to=applies, min_amount=Decimal(lo), max_amount=Decimal(hi) if hi else None,
            currency_id="SLE", priority=(i + 1) * 10,
            description="Initial configuration — review and adjust to the ministry's financial policy.",
        )
        for order, (level, label) in enumerate(steps, start=1):
            ApprovalPolicyStep.objects.create(policy=p, order=order, level=level, label=label)


seed_hooks.SEED_FUNCTIONS.append(("finance", "apps.finance.hooks.seed_policies"))

# --------------------------------------------------------------------------- dashboard


@sections.section("finance", "finance.view")
def finance_section(user, ctx):
    from apps.configuration.models import FinancialYear

    from .views import finance_summary

    if ctx.date_from or ctx.date_to:
        start = ctx.date_from or datetime.date(1900, 1, 1)
        end = ctx.date_to or timezone.localdate()
        label = None
    else:
        fy = ctx.financial_year or FinancialYear.for_date(timezone.localdate())
        start, end, label = fy.start_date, fy.end_date, fy.name
    data = finance_summary(user, ctx.unit, start, end)
    data["financial_year"] = label
    data["accounts"] = data["accounts"][:12]
    return data


def finance_attention(user, ctx):
    from .models import Budget
    from .services import awaiting_user

    items = []
    awaiting = awaiting_user(user)
    if ctx.unit is not None:
        awaiting = [t for t in awaiting if t.org_unit.path.startswith(ctx.unit.path)]
    if awaiting:
        items.append({"key": "finance_approvals", "label": "Financial entries awaiting your approval",
                      "count": len(awaiting), "link": "/finance/approvals", "severity": "warning"})
    q = scoping.scope_q(user, "budgets.approve")
    if q is not None:
        from .services import budget_approver_unit

        pending = [b for b in Budget.objects.filter(q, status="submitted").select_related("org_unit__parent")[:300]
                   if scoping.can(user, "budgets.approve", budget_approver_unit(b))
                   and user.pk not in {b.created_by_id, b.submitted_by_id}]
        if pending:
            items.append({"key": "budgets", "label": "Budgets awaiting your approval", "count": len(pending),
                          "link": "/finance/budgets?status=submitted", "severity": "info"})
    q = scoping.scope_q(user, "finance.create")
    if q is not None:
        from .models import Transaction

        returned = Transaction.objects.filter(q, status="draft", approvals__decision="returned",
                                              created_by=user).distinct().count()
        if returned:
            items.append({"key": "finance_returned", "label": "Your entries returned for correction",
                          "count": returned, "link": "/finance/transactions?status=draft", "severity": "warning"})
    return items


sections.ATTENTION_PROVIDERS.append(finance_attention)

# --------------------------------------------------------------------------- demo data

DEMO_NOTE = "[DEMO] fictional account"


def generate_demo(rng, members):
    """Fictional income/expenditure for each active branch over the last 12 months."""
    from apps.configuration.models import FinanceCategory, FinancialYear
    from apps.organization.models import OrgUnit

    from .models import Account, Transaction, TransactionApproval, next_reference

    today = timezone.localdate()
    income = {c.code: c for c in FinanceCategory.objects.filter(kind="income")}
    expense = {c.code: c for c in FinanceCategory.objects.filter(kind="expense")}
    by_branch = {}
    for m in members:
        by_branch.setdefault(m.org_unit_id, []).append(m)
    rows = []
    for branch in OrgUnit.objects.filter(unit_type="branch", status="active"):
        size = len(by_branch.get(branch.id, [])) or 50
        cash, _ = Account.objects.get_or_create(org_unit=branch, name="Cash box", defaults={
            "kind": "cash", "notes": DEMO_NOTE, "opening_date": today - datetime.timedelta(days=400)})
        bank, _ = Account.objects.get_or_create(org_unit=branch, name="Bank — main account", defaults={
            "kind": "bank", "institution": "[DEMO] Bank", "notes": DEMO_NOTE,
            "opening_balance": Decimal(rng.randint(5, 40) * 1000),
            "opening_date": today - datetime.timedelta(days=400)})
        day = today - datetime.timedelta(days=365)
        while day <= today:
            if day.weekday() == 6:  # Sunday
                for code, scale in (("sunday-offering", 9), ("tithes", 22), ("thanksgiving-offering", 3)):
                    amt = Decimal(int(size * scale * rng.uniform(0.6, 1.4)))
                    member = rng.choice(by_branch[branch.id]) if code == "tithes" and by_branch.get(branch.id) else None
                    rows.append(Transaction(kind="income", org_unit=branch, account=bank if code == "tithes" else cash,
                                            category=income[code],
                                            amount=amt, currency_id="SLE", transaction_date=day, method="cash",
                                            party="Congregation" if member is None else "",
                                            member=member if code == "tithes" and rng.random() < 0.3 else None,
                                            description="[DEMO] Sunday collection", status="approved", is_demo=True))
            if day.day == 28:
                for code, lo, hi in (("utilities", 300, 900), ("transport", 200, 1200), ("administrative", 150, 700),
                                     ("salaries-allowances", 2500, 6000), ("remittance-to-hq", 800, 3000)):
                    rows.append(Transaction(kind="expense", org_unit=branch, account=bank if code != "transport" else cash,
                                            category=expense[code], amount=Decimal(rng.randint(lo, hi)),
                                            currency_id="SLE", transaction_date=day,
                                            method="bank_transfer" if code != "transport" else "cash",
                                            party="[DEMO] Supplier", description="[DEMO] Monthly expense",
                                            status="approved", is_demo=True))
                if rng.random() < 0.3:
                    rows.append(Transaction(kind="expense", org_unit=branch, account=bank,
                                            category=expense[rng.choice(["building-maintenance", "evangelism",
                                                                         "welfare-benevolence", "equipment"])],
                                            amount=Decimal(rng.randint(1500, 30000)), currency_id="SLE",
                                            transaction_date=day, method="bank_transfer", party="[DEMO] Supplier",
                                            description="[DEMO] Occasional expense", status="approved", is_demo=True))
            day += datetime.timedelta(days=1)
    fys = {}
    for t in rows:
        fy = fys.get(t.transaction_date)
        if fy is None:
            fy = fys[t.transaction_date] = FinancialYear.for_date(t.transaction_date)
        t.financial_year = fy
        t.reference = next_reference("INC" if t.kind == "income" else "EXP")
        t.required_steps = [{"order": 1, "level": "unit", "label": "Pastor-in-Charge"}]
        t.current_step = 0
        t.approved_at = timezone.make_aware(datetime.datetime.combine(t.transaction_date, datetime.time(15)))
    # The latest few entries are left awaiting approval so the workflow can be demonstrated.
    for t in rows[-6:]:
        t.status, t.approved_at = "submitted", None
    Transaction.objects.bulk_create(rows, batch_size=1000)
    log = []
    for t in rows:
        log.append(TransactionApproval(transaction=t, step=0, decision="submitted", comment="[DEMO]"))
        if t.status == "approved":
            log.append(TransactionApproval(transaction=t, step=0, step_label="Pastor-in-Charge", decision="approved",
                                           comment="[DEMO]"))
    TransactionApproval.objects.bulk_create(log, batch_size=1000)
    return len(rows)


demo_hooks.EXTRA_GENERATORS.append(("finance transactions", generate_demo))
demo_hooks.PURGE_SQL.extend([
    "ALTER TABLE finance_transactionapproval DISABLE TRIGGER finance_approval_append_only",
    "ALTER TABLE finance_transaction DISABLE TRIGGER finance_transaction_guard",
    "DELETE FROM finance_transactionapproval WHERE transaction_id IN "
    "(SELECT id FROM finance_transaction WHERE is_demo)",
    "DELETE FROM finance_transaction WHERE is_demo",
    "DELETE FROM finance_account a WHERE a.notes = '[DEMO] fictional account' AND NOT EXISTS "
    "(SELECT 1 FROM finance_transaction t WHERE t.account_id = a.id)",
    "SET CONSTRAINTS ALL IMMEDIATE",
    "ALTER TABLE finance_transaction ENABLE TRIGGER finance_transaction_guard",
    "ALTER TABLE finance_transactionapproval ENABLE TRIGGER finance_approval_append_only",
])
