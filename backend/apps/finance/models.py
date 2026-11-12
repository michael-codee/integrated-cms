"""
Finance & accounting.

Integrity rules (enforced in services *and* in PostgreSQL):

* Every transaction belongs to an org unit, an account, a category and a
  financial year; amounts are positive decimals in the account's currency.
* Transactions move draft → submitted → approved | rejected. An approved
  transaction is immutable; corrections are made with a reversing entry that
  is itself approved. Database triggers block edits of approved figures and
  any DELETE on finance tables.
* Approval steps come from editable ``ApprovalPolicy`` rows (amount
  thresholds, number of levels, which level of the hierarchy approves) and
  segregation of duties is enforced: the person who recorded or submitted a
  transaction can never approve it, and nobody approves two steps.
"""
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import connection, models
from django.utils import timezone

from apps.core.uploads import RandomName, document_validator, image_validator
from apps.core.models import BaseModel, SoftDeleteModel, SyncModel

FINANCE_REF_SEQUENCE = "cmis_finance_ref_seq"
MONEY = {"max_digits": 16, "decimal_places": 2}


def next_reference(prefix: str) -> str:
    with connection.cursor() as c:
        c.execute(f"SELECT nextval('{FINANCE_REF_SEQUENCE}')")
        n = c.fetchone()[0]
    return f"{prefix}-{timezone.localdate().year}-{n:06d}"


class Account(SoftDeleteModel):
    """A cash box, bank account or mobile-money wallet held by an org unit."""

    class Kind(models.TextChoices):
        CASH = "cash", "Cash"
        BANK = "bank", "Bank account"
        MOBILE_MONEY = "mobile_money", "Mobile money"

    org_unit = models.ForeignKey("organization.OrgUnit", on_delete=models.PROTECT, related_name="finance_accounts")
    name = models.CharField(max_length=120)
    kind = models.CharField(max_length=14, choices=Kind.choices, default=Kind.CASH)
    institution = models.CharField(max_length=120, blank=True, default="", help_text="Bank or provider")
    account_number = models.CharField(max_length=60, blank=True, default="")
    currency = models.ForeignKey("configuration.Currency", on_delete=models.PROTECT, default="SLE")
    opening_balance = models.DecimalField(**MONEY, default=Decimal("0"))
    opening_date = models.DateField(default=timezone.localdate)
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["org_unit__name", "name"]
        constraints = [
            models.UniqueConstraint(fields=["org_unit", "name"], condition=models.Q(is_deleted=False),
                                    name="finance_account_unique_name_per_unit"),
        ]

    def __str__(self):
        return f"{self.name} ({self.org_unit.name})"


class ApprovalPolicy(BaseModel):
    """Which approvals a transaction or budget needs. Editable in Settings.

    The first active policy (by ``priority``) whose kind, unit type and amount
    range match is used. If none matches, the built-in rule is a single
    approval at the transaction's own unit.
    """

    class AppliesTo(models.TextChoices):
        INCOME = "income", "Income"
        EXPENSE = "expense", "Expenditure"
        REVERSAL = "reversal", "Reversal"

    name = models.CharField(max_length=120)
    applies_to = models.CharField(max_length=10, choices=AppliesTo.choices)
    unit_type = models.CharField(max_length=20, blank=True, default="",
                                 help_text="Only for units of this type (blank = any)")
    min_amount = models.DecimalField(**MONEY, default=Decimal("0"))
    max_amount = models.DecimalField(**MONEY, null=True, blank=True, help_text="Blank = no upper limit")
    currency = models.ForeignKey("configuration.Currency", on_delete=models.PROTECT, default="SLE")
    priority = models.PositiveSmallIntegerField(default=100)
    is_active = models.BooleanField(default=True)
    description = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["applies_to", "priority", "min_amount"]
        verbose_name_plural = "approval policies"

    def __str__(self):
        return self.name

    def clean(self):
        if self.max_amount is not None and self.max_amount <= self.min_amount:
            raise ValidationError({"max_amount": "The upper limit must be greater than the lower limit."})


class ApprovalLevel(models.TextChoices):
    """Where in the hierarchy an approver must hold ``<module>.approve``."""

    SAME_UNIT = "unit", "Own unit (e.g. Pastor-in-Charge)"
    DISTRICT = "district", "District"
    REGION = "region", "Region"
    HEADQUARTERS = "headquarters", "Headquarters"


class ApprovalPolicyStep(models.Model):
    policy = models.ForeignKey(ApprovalPolicy, on_delete=models.CASCADE, related_name="steps")
    order = models.PositiveSmallIntegerField()
    level = models.CharField(max_length=14, choices=ApprovalLevel.choices, default=ApprovalLevel.SAME_UNIT)
    label = models.CharField(max_length=120, blank=True, default="")

    class Meta:
        ordering = ["policy", "order"]
        constraints = [models.UniqueConstraint(fields=["policy", "order"], name="policy_step_order_unique")]

    def __str__(self):
        return self.label or self.get_level_display()


class Transaction(SyncModel):
    class Kind(models.TextChoices):
        INCOME = "income", "Income"
        EXPENSE = "expense", "Expenditure"

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SUBMITTED = "submitted", "Awaiting approval"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        REVERSED = "reversed", "Reversed"

    class Method(models.TextChoices):
        CASH = "cash", "Cash"
        BANK_TRANSFER = "bank_transfer", "Bank transfer"
        MOBILE_MONEY = "mobile_money", "Mobile money"
        CHEQUE = "cheque", "Cheque"
        OTHER = "other", "Other"

    reference = models.CharField(max_length=32, unique=True, null=True, blank=True)
    kind = models.CharField(max_length=8, choices=Kind.choices, db_index=True)
    org_unit = models.ForeignKey("organization.OrgUnit", on_delete=models.PROTECT, related_name="transactions")
    account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="transactions")
    category = models.ForeignKey("configuration.FinanceCategory", on_delete=models.PROTECT,
                                 related_name="transactions")
    amount = models.DecimalField(**MONEY, validators=[MinValueValidator(Decimal("0.01"))])
    currency = models.ForeignKey("configuration.Currency", on_delete=models.PROTECT)
    transaction_date = models.DateField(default=timezone.localdate, db_index=True)
    financial_year = models.ForeignKey("configuration.FinancialYear", on_delete=models.PROTECT,
                                       related_name="transactions")
    method = models.CharField(max_length=14, choices=Method.choices, default=Method.CASH)
    party = models.CharField(max_length=200, blank=True, default="", help_text="Received from / paid to")
    member = models.ForeignKey("members.Member", null=True, blank=True, on_delete=models.PROTECT,
                               related_name="contributions", help_text="Contributing member (optional)")
    program_ref = models.CharField(max_length=120, blank=True, default="", help_text="Program / project / event")
    description = models.TextField(blank=True, default="")
    external_ref = models.CharField(max_length=80, blank=True, default="",
                                    help_text="Cheque no., bank or mobile-money reference, invoice no.")
    attachment = models.FileField(upload_to=RandomName("finance/supporting"), null=True, blank=True,
                                  validators=[document_validator])
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT, db_index=True)
    policy = models.ForeignKey(ApprovalPolicy, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    required_steps = models.JSONField(default=list, blank=True,
                                      help_text="Snapshot of the approval steps at submission")
    current_step = models.PositiveSmallIntegerField(default=0)
    submitted_at = models.DateTimeField(null=True, blank=True)
    submitted_by = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.PROTECT,
                                     related_name="+")
    approved_at = models.DateTimeField(null=True, blank=True)
    reversal_of = models.OneToOneField("self", null=True, blank=True, on_delete=models.PROTECT,
                                       related_name="reversed_by")
    is_demo = models.BooleanField(default=False, db_index=True)

    class Meta:
        ordering = ["-transaction_date", "-created_at"]
        indexes = [
            models.Index(fields=["org_unit", "status", "transaction_date"]),
            models.Index(fields=["kind", "status", "transaction_date"]),
        ]

    def __str__(self):
        return self.reference or f"Draft {self.get_kind_display().lower()}"

    @property
    def signed_amount(self):
        sign = 1 if self.kind == self.Kind.INCOME else -1
        return self.amount * sign

    @property
    def is_locked(self):
        return self.status in (self.Status.APPROVED, self.Status.REVERSED, self.Status.SUBMITTED)


class TransactionApproval(BaseModel):
    class Decision(models.TextChoices):
        SUBMITTED = "submitted", "Submitted"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        RETURNED = "returned", "Returned for correction"

    transaction = models.ForeignKey(Transaction, on_delete=models.PROTECT, related_name="approvals")
    step = models.PositiveSmallIntegerField(default=0)
    step_label = models.CharField(max_length=120, blank=True, default="")
    decision = models.CharField(max_length=10, choices=Decision.choices)
    comment = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["created_at"]


class Budget(SoftDeleteModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SUBMITTED = "submitted", "Awaiting approval"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Returned"

    org_unit = models.ForeignKey("organization.OrgUnit", on_delete=models.PROTECT, related_name="budgets")
    financial_year = models.ForeignKey("configuration.FinancialYear", on_delete=models.PROTECT,
                                       related_name="budgets")
    name = models.CharField(max_length=160)
    currency = models.ForeignKey("configuration.Currency", on_delete=models.PROTECT, default="SLE")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT, db_index=True)
    notes = models.TextField(blank=True, default="")
    submitted_at = models.DateTimeField(null=True, blank=True)
    submitted_by = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.PROTECT,
                                     related_name="+")
    decided_at = models.DateTimeField(null=True, blank=True)
    decided_by = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.PROTECT,
                                   related_name="+")
    decision_comment = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-financial_year__start_date", "org_unit__name"]
        constraints = [
            models.UniqueConstraint(fields=["org_unit", "financial_year", "name"],
                                    condition=models.Q(is_deleted=False), name="budget_unique_per_unit_year"),
        ]

    def __str__(self):
        return f"{self.name} — {self.org_unit.name} ({self.financial_year})"


class BudgetLine(models.Model):
    budget = models.ForeignKey(Budget, on_delete=models.CASCADE, related_name="lines")
    category = models.ForeignKey("configuration.FinanceCategory", on_delete=models.PROTECT, related_name="+")
    amount = models.DecimalField(**MONEY, validators=[MinValueValidator(Decimal("0"))])
    notes = models.CharField(max_length=200, blank=True, default="")

    class Meta:
        ordering = ["category__kind", "category__sort_order"]
        constraints = [models.UniqueConstraint(fields=["budget", "category"], name="budget_line_unique_category")]


class Reconciliation(BaseModel):
    """Bank/cash reconciliation: book balance vs. statement/count at a date."""

    account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="reconciliations")
    as_of = models.DateField()
    statement_balance = models.DecimalField(**MONEY)
    book_balance = models.DecimalField(**MONEY, editable=False)
    difference = models.DecimalField(**MONEY, editable=False)
    notes = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-as_of", "-created_at"]

    @property
    def org_unit(self):
        return self.account.org_unit
