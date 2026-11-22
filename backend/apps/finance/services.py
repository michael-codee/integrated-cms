"""Finance business rules: recording, approval workflow, reversal, balances.

Views and the offline sync layer both go through these functions, so the
same rules apply however a transaction arrives.
"""
import datetime
from decimal import Decimal

from django.db import transaction as db_transaction
from django.db.models import Case, DecimalField, F, Q, Sum, Value, When
from django.db.models.functions import Coalesce
from django.utils import timezone

from apps.audit import services as audit
from apps.audit.models import AuditLog
from apps.configuration.models import FinancialYear, SystemSetting
from apps.core import scoping
from apps.core.events import publish
from apps.core.exceptions import BusinessRuleError
from apps.organization.models import StructureLevel

from .models import (DUES_CATEGORY_CODE, MAX_DUES_MONTHS, ApprovalLevel, ApprovalPolicy, Budget, Transaction,
                     TransactionApproval, add_months, month_range, next_reference)

ZERO = Decimal("0")
POSTED = [Transaction.Status.APPROVED, Transaction.Status.REVERSED]

# ---------------------------------------------------------------- reporting helpers


def net_amount_expr():
    """Signed contribution of a posted row: reversal entries count negative.

    An approved original keeps counting in its own period after it is reversed;
    the reversing entry counts negative in the period it is posted. Totals net
    to zero without rewriting closed periods.
    """
    return Case(When(reversal_of__isnull=False, then=-F("amount")), default=F("amount"),
                output_field=DecimalField(max_digits=18, decimal_places=2))


def posted(qs):
    return qs.filter(status__in=POSTED)


def totals(qs):
    agg = posted(qs).aggregate(
        income=Coalesce(Sum(net_amount_expr(), filter=Q(kind="income")), Value(ZERO)),
        expense=Coalesce(Sum(net_amount_expr(), filter=Q(kind="expense")), Value(ZERO)),
    )
    agg["net"] = agg["income"] - agg["expense"]
    return agg


def account_balance(account, as_of=None):
    qs = posted(account.transactions.all())
    qs = qs.filter(transaction_date__gte=account.opening_date)
    if as_of:
        qs = qs.filter(transaction_date__lte=as_of)
    t = totals(qs)
    return account.opening_balance + t["income"] - t["expense"]


# ---------------------------------------------------------------- validation


def check_open_year(date):
    fy = FinancialYear.for_date(date)
    if fy.is_closed:
        raise BusinessRuleError(f"{fy.name} is closed. Entries cannot be added or changed in a closed financial year.",
                                code="financial_year_closed")
    return fy


def validate_entry(txn: Transaction, user):
    if txn.account.org_unit_id != txn.org_unit_id:
        raise BusinessRuleError("The account must belong to the same unit as the transaction.", code="account_unit")
    if not txn.account.is_active:
        raise BusinessRuleError("This account is closed.", code="account_inactive")
    if txn.category.kind != txn.kind:
        raise BusinessRuleError(f"'{txn.category.name}' is not an {txn.get_kind_display().lower()} category.",
                                code="category_kind")
    if not txn.category.is_active:
        raise BusinessRuleError("This category is no longer in use.", code="category_inactive")
    if txn.currency_id != txn.account.currency_id:
        raise BusinessRuleError("The currency must match the account's currency.", code="currency")
    if txn.amount is None or txn.amount <= 0:
        raise BusinessRuleError("The amount must be greater than zero.", code="amount")
    if txn.transaction_date > timezone.localdate():
        raise BusinessRuleError("Transactions cannot be dated in the future.", code="future_date")
    if txn.member_id and not (txn.member.org_unit.path.startswith(txn.org_unit.path)
                              or scoping.can(user, "members.view", txn.member.org_unit)):
        raise BusinessRuleError("That member is outside your jurisdiction.", code="member_scope")
    validate_dues(txn)
    txn.financial_year = check_open_year(txn.transaction_date)


def _month_label(month):
    return month.strftime("%B %Y")


def validate_dues(txn: Transaction):
    """Rules for monthly membership dues entries.

    Dues are ordinary income entries in the Membership dues category, so they
    follow the income approval policy like any other receipt. On top of that
    each one names the member and the months it pays for, and a month cannot
    be paid twice while an earlier payment for it is awaiting approval or
    approved.
    """
    if txn.reversal_of_id:
        return  # a reversing entry cancels the original's months; it covers none itself
    is_dues = txn.category.code == DUES_CATEGORY_CODE
    if not is_dues:
        if txn.dues_month or txn.dues_months:
            raise BusinessRuleError("Only membership dues entries can name the months paid for.", code="dues_category")
        return
    if not txn.member_id:
        raise BusinessRuleError("Choose the member who is paying dues.", code="dues_member")
    if not txn.dues_month:
        raise BusinessRuleError("Choose the first month this payment covers.", code="dues_month")
    txn.dues_month = txn.dues_month.replace(day=1)
    txn.dues_months = txn.dues_months or 1
    if not 1 <= txn.dues_months <= MAX_DUES_MONTHS:
        raise BusinessRuleError(f"Dues can be paid for 1 to {MAX_DUES_MONTHS} months at a time.", code="dues_months")
    this_month = timezone.localdate().replace(day=1)
    last = add_months(txn.dues_month, txn.dues_months - 1)
    if last > add_months(this_month, MAX_DUES_MONTHS):
        raise BusinessRuleError(f"Dues can be paid at most {MAX_DUES_MONTHS} months in advance.", code="dues_advance")
    months = set(month_range(txn.dues_month, txn.dues_months))
    others = Transaction.objects.filter(
        member_id=txn.member_id, category__code=DUES_CATEGORY_CODE, reversal_of__isnull=True,
        status__in=[Transaction.Status.SUBMITTED, Transaction.Status.APPROVED],
        dues_month__lte=last, dues_month__gte=add_months(txn.dues_month, -MAX_DUES_MONTHS),
    ).exclude(pk=txn.pk)
    for other in others:
        clash = sorted(months.intersection(other.dues_period))
        if clash:
            state = "approved" if other.status == Transaction.Status.APPROVED else "awaiting approval"
            raise BusinessRuleError(
                f"Dues for {_month_label(clash[0])} are already recorded for this member in {other.reference} "
                f"({state}). If that entry is wrong, reverse it first.", code="dues_duplicate")


def dues_register(members, year):
    """Months paid per member for a calendar year.

    Only approved dues count as paid; entries awaiting approval are shown as
    pending. A payment for several months is spread evenly across them. A
    reversed payment no longer counts.
    """
    start = datetime.date(year, 1, 1)
    end = datetime.date(year, 12, 1)
    member_ids = [m.pk for m in members]
    rows = {m.pk: {"paid": [ZERO] * 12, "pending": [ZERO] * 12, "entries": []} for m in members}
    qs = Transaction.objects.filter(
        member_id__in=member_ids, category__code=DUES_CATEGORY_CODE, reversal_of__isnull=True,
        status__in=[Transaction.Status.SUBMITTED, Transaction.Status.APPROVED],
        dues_month__lte=end, dues_month__gte=add_months(start, -MAX_DUES_MONTHS),
    ).only("id", "reference", "member_id", "amount", "currency_id", "status", "dues_month", "dues_months")
    for t in qs:
        period = t.dues_period
        share = (t.amount / len(period)).quantize(Decimal("0.01"))
        key = "paid" if t.status == Transaction.Status.APPROVED else "pending"
        counted = False
        for month in period:
            if month.year == year:
                rows[t.member_id][key][month.month - 1] += share
                counted = True
        if counted:
            rows[t.member_id]["entries"].append({
                "id": str(t.id), "reference": t.reference, "status": t.status, "amount": t.amount,
                "currency": t.currency_id, "from": t.dues_month, "months": len(period)})
    return rows


# ---------------------------------------------------------------- approval routing


def resolve_policy(applies_to, org_unit, amount, currency_id):
    candidates = ApprovalPolicy.objects.filter(
        is_active=True, applies_to=applies_to, currency_id=currency_id, min_amount__lte=amount,
    ).filter(Q(max_amount__isnull=True) | Q(max_amount__gt=amount)).filter(
        Q(unit_type="") | Q(unit_type=org_unit.unit_type)
    ).prefetch_related("steps").order_by("priority", "-min_amount")
    policy = candidates.first()
    if policy is None or not policy.steps.exists():
        return policy, [{"order": 1, "level": ApprovalLevel.SAME_UNIT, "label": "Approval"}]
    steps = [{"order": s.order, "level": s.level, "label": s.label or s.get_level_display()}
             for s in policy.steps.all()]
    return policy, steps


def approver_unit(org_unit, level):
    """The unit at which an approver must hold the approve permission."""
    if level == ApprovalLevel.SAME_UNIT:
        return org_unit
    ranks = dict(StructureLevel.objects.filter(code__in=[org_unit.unit_type, level]).values_list("code", "rank"))
    if level in ranks and org_unit.unit_type in ranks and ranks[org_unit.unit_type] <= ranks[level]:
        return org_unit  # the unit itself is at or above that level
    return org_unit.ancestor_of_type(level) or org_unit


def _prior_actors(txn):
    ids = {txn.created_by_id, txn.submitted_by_id}
    ids.update(txn.approvals.filter(decision=TransactionApproval.Decision.APPROVED).values_list("created_by_id",
                                                                                                flat=True))
    ids.discard(None)
    return ids


def can_approve(user, txn, perm="finance.approve"):
    """(allowed, reason) for the current step."""
    if txn.status != Transaction.Status.SUBMITTED:
        return False, "This transaction is not awaiting approval."
    step = txn.required_steps[txn.current_step] if txn.current_step < len(txn.required_steps) else None
    if step is None:
        return False, "No approval step is pending."
    unit = approver_unit(txn.org_unit, step["level"])
    if not scoping.can(user, perm, unit):
        return False, f"This step must be approved at {unit.name} level."
    if user.pk in _prior_actors(txn):
        return False, "Segregation of duties: you recorded, submitted or already approved this transaction."
    return True, ""


def awaiting_user(user, qs=None):
    """Submitted transactions whose *current* step this user may approve."""
    qs = qs if qs is not None else Transaction.objects.all()
    qs = scoping.filter_queryset(qs.filter(status=Transaction.Status.SUBMITTED), user, "finance.approve")
    qs = qs.select_related("org_unit").prefetch_related("approvals")[:1000]
    return [t for t in qs if can_approve(user, t)[0]]


# ---------------------------------------------------------------- workflow


def _log(txn, user, decision, comment="", step=None):
    label = ""
    if step is not None and step < len(txn.required_steps):
        label = txn.required_steps[step]["label"]
    return TransactionApproval.objects.create(transaction=txn, step=step or 0, step_label=label, decision=decision,
                                              comment=comment, created_by=user)


@db_transaction.atomic
def submit(txn: Transaction, user):
    txn = Transaction.objects.select_for_update().get(pk=txn.pk)
    if txn.status != Transaction.Status.DRAFT:
        raise BusinessRuleError("Only drafts can be submitted.", code="not_draft")
    if not scoping.can(user, "finance.submit", txn.org_unit) and not scoping.can(user, "finance.create", txn.org_unit):
        raise BusinessRuleError("You cannot submit transactions for this unit.", code="forbidden", status_code=403)
    if txn.member_id and txn.dues_month:
        # Serialise dues submissions per member so two officers cannot both submit the same month.
        from apps.members.models import Member

        Member.all_objects.select_for_update().filter(pk=txn.member_id).exists()
    validate_entry(txn, user)
    applies = ApprovalPolicy.AppliesTo.REVERSAL if txn.reversal_of_id else txn.kind
    policy, steps = resolve_policy(applies, txn.org_unit, txn.amount, txn.currency_id)
    txn.policy, txn.required_steps, txn.current_step = policy, steps, 0
    txn.status = Transaction.Status.SUBMITTED
    txn.submitted_at, txn.submitted_by, txn.updated_by = timezone.now(), user, user
    if not txn.reference:
        prefix = "REV" if txn.reversal_of_id else ("INC" if txn.kind == Transaction.Kind.INCOME else "EXP")
        txn.reference = next_reference(prefix)
    txn.save()
    _log(txn, user, TransactionApproval.Decision.SUBMITTED)
    audit.record(AuditLog.Action.SUBMIT, instance=txn, message=f"{txn.reference} · {txn.amount} {txn.currency_id}")
    if txn.kind == Transaction.Kind.INCOME and not txn.reversal_of_id and not SystemSetting.get().require_income_approval:
        _finalise(txn, user, auto=True)
    else:
        publish("finance.awaiting_approval", org_unit=txn.org_unit, actor=user,
                title=f"{txn.get_kind_display()} {txn.reference} awaits approval",
                body=f"{txn.amount:,} {txn.currency_id} — {txn.category.name}", link=f"/finance/transactions/{txn.pk}",
                notify_perm="finance.approve")
    return txn


def _finalise(txn, user, auto=False):
    txn.status = Transaction.Status.APPROVED
    txn.approved_at = timezone.now()
    txn.updated_by = user
    txn.save()
    if auto:
        _log(txn, user, TransactionApproval.Decision.APPROVED, "Approved automatically (income approval disabled in settings)")
    if txn.reversal_of_id:
        original = Transaction.objects.select_for_update().get(pk=txn.reversal_of_id)
        original.status = Transaction.Status.REVERSED
        original.updated_by = user
        original.save()
        audit.record(AuditLog.Action.UPDATE, instance=original, message=f"Reversed by {txn.reference}")
    publish("finance.approved", org_unit=txn.org_unit, actor=user, title=f"{txn.reference} approved",
            link=f"/finance/transactions/{txn.pk}", recipients=[txn.created_by_id])


@db_transaction.atomic
def approve(txn: Transaction, user, comment=""):
    txn = Transaction.objects.select_for_update().select_related("org_unit").get(pk=txn.pk)
    ok, reason = can_approve(user, txn)
    if not ok:
        raise BusinessRuleError(reason, code="cannot_approve", status_code=403)
    check_open_year(txn.transaction_date)
    step = txn.current_step
    _log(txn, user, TransactionApproval.Decision.APPROVED, comment, step)
    audit.record(AuditLog.Action.APPROVE, instance=txn,
                 message=f"{txn.reference} step {step + 1}/{len(txn.required_steps)}")
    if step + 1 >= len(txn.required_steps):
        _finalise(txn, user)
    else:
        txn.current_step = step + 1
        txn.updated_by = user
        txn.save()
        publish("finance.awaiting_approval", org_unit=txn.org_unit, actor=user,
                title=f"{txn.reference} awaits {txn.required_steps[step + 1]['label']}",
                link=f"/finance/transactions/{txn.pk}", notify_perm="finance.approve")
    return txn


@db_transaction.atomic
def reject(txn: Transaction, user, comment, return_to_draft=False):
    txn = Transaction.objects.select_for_update().get(pk=txn.pk)
    ok, reason = can_approve(user, txn, "finance.reject")
    if not ok:
        ok2, _ = can_approve(user, txn, "finance.approve")
        if not ok2:
            raise BusinessRuleError(reason, code="cannot_reject", status_code=403)
    if not comment.strip():
        raise BusinessRuleError("Give a reason so the officer can act on it.", code="comment_required")
    decision = TransactionApproval.Decision.RETURNED if return_to_draft else TransactionApproval.Decision.REJECTED
    _log(txn, user, decision, comment, txn.current_step)
    txn.status = Transaction.Status.DRAFT if return_to_draft else Transaction.Status.REJECTED
    txn.current_step = 0
    txn.updated_by = user
    txn.save()
    audit.record(AuditLog.Action.REJECT, instance=txn, message=f"{txn.reference}: {comment}")
    publish("finance.rejected", org_unit=txn.org_unit, actor=user,
            title=f"{txn.reference} {'returned for correction' if return_to_draft else 'rejected'}", body=comment,
            link=f"/finance/transactions/{txn.pk}", recipients=[txn.created_by_id, txn.submitted_by_id])
    return txn


@db_transaction.atomic
def request_reversal(txn: Transaction, user, reason):
    txn = Transaction.objects.select_for_update().get(pk=txn.pk)
    if txn.status != Transaction.Status.APPROVED or txn.reversal_of_id:
        raise BusinessRuleError("Only approved original entries can be reversed.", code="not_reversible")
    if Transaction.objects.filter(reversal_of=txn).exclude(status=Transaction.Status.REJECTED).exists():
        raise BusinessRuleError("A reversal for this transaction already exists.", code="reversal_exists")
    if not scoping.can(user, "finance.create", txn.org_unit):
        raise BusinessRuleError("You cannot record entries for this unit.", code="forbidden", status_code=403)
    if not reason.strip():
        raise BusinessRuleError("A reason is required for a reversal.", code="reason_required")
    rev = Transaction(
        kind=txn.kind, org_unit=txn.org_unit, account=txn.account, category=txn.category, amount=txn.amount,
        currency=txn.currency, transaction_date=timezone.localdate(), method=txn.method, party=txn.party,
        member=txn.member, program_ref=txn.program_ref, external_ref=txn.reference,
        description=f"Reversal of {txn.reference}: {reason}", reversal_of=txn, created_by=user, updated_by=user,
    )
    validate_entry(rev, user)
    # A reversal that was rejected earlier frees the one-to-one slot only if we detach it.
    Transaction.objects.filter(reversal_of=txn, status=Transaction.Status.REJECTED).update(reversal_of=None)
    rev.save()
    audit.record(AuditLog.Action.REVERSE, instance=rev, message=f"Reversal requested for {txn.reference}")
    return submit(rev, user)


# ---------------------------------------------------------------- budgets


def budget_approver_unit(budget: Budget):
    return budget.org_unit.parent or budget.org_unit


@db_transaction.atomic
def submit_budget(budget: Budget, user):
    if budget.status not in (Budget.Status.DRAFT, Budget.Status.REJECTED):
        raise BusinessRuleError("This budget has already been submitted.", code="not_draft")
    if not budget.lines.exists():
        raise BusinessRuleError("Add at least one budget line before submitting.", code="empty_budget")
    if budget.financial_year.is_closed:
        raise BusinessRuleError("The financial year is closed.", code="financial_year_closed")
    budget.status, budget.submitted_at, budget.submitted_by = Budget.Status.SUBMITTED, timezone.now(), user
    budget.save()
    audit.record(AuditLog.Action.SUBMIT, instance=budget)
    publish("budget.submitted", org_unit=budget_approver_unit(budget), actor=user,
            title=f"Budget submitted: {budget.name} ({budget.org_unit.name})", link=f"/finance/budgets/{budget.pk}",
            notify_perm="budgets.approve")
    return budget


@db_transaction.atomic
def decide_budget(budget: Budget, user, approve: bool, comment=""):
    if budget.status != Budget.Status.SUBMITTED:
        raise BusinessRuleError("This budget is not awaiting approval.", code="not_submitted")
    unit = budget_approver_unit(budget)
    if not scoping.can(user, "budgets.approve", unit):
        raise BusinessRuleError(f"Budgets for {budget.org_unit.name} are approved at {unit.name} level.",
                                code="cannot_approve", status_code=403)
    if user.pk in {budget.created_by_id, budget.submitted_by_id}:
        raise BusinessRuleError("Segregation of duties: you prepared or submitted this budget.", code="segregation",
                                status_code=403)
    if not approve and not comment.strip():
        raise BusinessRuleError("Give a reason when returning a budget.", code="comment_required")
    budget.status = Budget.Status.APPROVED if approve else Budget.Status.REJECTED
    budget.decided_at, budget.decided_by, budget.decision_comment = timezone.now(), user, comment
    budget.save()
    audit.record(AuditLog.Action.APPROVE if approve else AuditLog.Action.REJECT, instance=budget, message=comment)
    publish("budget.decided", org_unit=budget.org_unit, actor=user,
            title=f"Budget {'approved' if approve else 'returned'}: {budget.name}", body=comment,
            link=f"/finance/budgets/{budget.pk}", recipients=[budget.created_by_id, budget.submitted_by_id])
    return budget


def budget_vs_actual(budget: Budget):
    fy = budget.financial_year
    actual_qs = posted(Transaction.objects.filter(org_unit=budget.org_unit, transaction_date__gte=fy.start_date,
                                                  transaction_date__lte=fy.end_date))
    actual = dict(actual_qs.values("category").annotate(total=Sum(net_amount_expr())).values_list("category",
                                                                                                  "total"))
    rows = []
    for line in budget.lines.select_related("category"):
        spent = actual.get(line.category_id) or ZERO
        rows.append({
            "category": str(line.category_id), "category_name": line.category.name, "kind": line.category.kind,
            "budget": line.amount, "actual": spent, "variance": spent - line.amount,
            "percent": float(spent / line.amount * 100) if line.amount else None,
        })
    return rows
