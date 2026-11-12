"""
Assets & property register.

Assets are never deleted: they leave the register only through an approved
disposal (sale, donation, scrapping, write-off or loss), and move between
units only through an approved transfer. Every change is audited.
"""
import datetime
from decimal import Decimal

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import connection, models
from django.utils import timezone

from apps.core.uploads import RandomName, document_validator, image_validator
from apps.core.models import BaseModel, SyncModel

ASSET_NO_SEQUENCE = "cmis_asset_no_seq"
MONEY = {"max_digits": 16, "decimal_places": 2}


def next_asset_no(prefix="AST"):
    with connection.cursor() as c:
        c.execute(f"SELECT nextval('{ASSET_NO_SEQUENCE}')")
        return f"{prefix}-{c.fetchone()[0]:06d}"


class Asset(SyncModel):
    class Condition(models.TextChoices):
        NEW = "new", "New"
        GOOD = "good", "Good"
        FAIR = "fair", "Fair"
        POOR = "poor", "Poor"
        UNSERVICEABLE = "unserviceable", "Unserviceable"

    class Status(models.TextChoices):
        ACTIVE = "active", "In use"
        MAINTENANCE = "maintenance", "Under maintenance"
        IDLE = "idle", "Not in use / stored"
        DISPOSED = "disposed", "Disposed"
        LOST = "lost", "Lost / stolen"

    class Acquisition(models.TextChoices):
        PURCHASE = "purchase", "Purchase"
        DONATION = "donation", "Donation / gift"
        CONSTRUCTION = "construction", "Construction"
        TRANSFER = "transfer", "Transfer from another body"
        OTHER = "other", "Other"

    asset_no = models.CharField(max_length=20, unique=True, null=True, blank=True)
    name = models.CharField(max_length=200)
    category = models.ForeignKey("configuration.AssetCategory", on_delete=models.PROTECT, related_name="assets")
    org_unit = models.ForeignKey("organization.OrgUnit", on_delete=models.PROTECT, related_name="assets")
    description = models.TextField(blank=True, default="")
    serial_number = models.CharField(max_length=120, blank=True, default="")
    registration_no = models.CharField(max_length=60, blank=True, default="", help_text="Vehicles / motorcycles")
    title_document_no = models.CharField(max_length=120, blank=True, default="",
                                         help_text="Land / building title, survey plan or deed reference")
    size_description = models.CharField(max_length=120, blank=True, default="", help_text="e.g. plot size")
    acquisition_date = models.DateField(null=True, blank=True)
    acquisition_method = models.CharField(max_length=14, choices=Acquisition.choices, default=Acquisition.PURCHASE)
    cost = models.DecimalField(**MONEY, default=Decimal("0"), validators=[MinValueValidator(Decimal("0"))],
                               help_text="Purchase cost or fair value at acquisition")
    currency = models.ForeignKey("configuration.Currency", on_delete=models.PROTECT, default="SLE")
    funding_source = models.CharField(max_length=160, blank=True, default="")
    supplier = models.CharField(max_length=160, blank=True, default="")
    location = models.CharField(max_length=200, blank=True, default="")
    custodian = models.CharField(max_length=160, blank=True, default="", help_text="Person responsible")
    condition = models.CharField(max_length=14, choices=Condition.choices, default=Condition.GOOD, db_index=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.ACTIVE, db_index=True)
    depreciation_rate = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True,
                                            validators=[MinValueValidator(0), MaxValueValidator(100)],
                                            help_text="Straight-line % per year. Blank = category default.")
    warranty_expiry = models.DateField(null=True, blank=True)
    insurance_expiry = models.DateField(null=True, blank=True)
    insurance_details = models.CharField(max_length=200, blank=True, default="")
    photo = models.ImageField(upload_to=RandomName("assets/photos"), null=True, blank=True,
                              validators=[image_validator])
    document = models.FileField(upload_to=RandomName("assets/documents"), null=True, blank=True,
                                validators=[document_validator],
                                help_text="Ownership / purchase document")
    disposed_on = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    is_demo = models.BooleanField(default=False, db_index=True)

    class Meta:
        ordering = ["asset_no"]
        indexes = [models.Index(fields=["org_unit", "status"]), models.Index(fields=["category", "status"])]

    def __str__(self):
        return f"{self.asset_no or 'New'} {self.name}"

    @property
    def effective_rate(self):
        if self.depreciation_rate is not None:
            return self.depreciation_rate
        return self.category.default_depreciation_rate if self.category_id else Decimal("0")

    def book_value(self, as_of=None):
        """Straight-line depreciation from the acquisition date; never below zero."""
        as_of = as_of or timezone.localdate()
        if not self.acquisition_date or not self.effective_rate or as_of < self.acquisition_date:
            return self.cost
        years = Decimal((as_of - self.acquisition_date).days) / Decimal("365.25")
        value = self.cost * (1 - self.effective_rate / 100 * years)
        return max(value, Decimal("0")).quantize(Decimal("0.01"))

    def depreciation_schedule(self, years=None):
        if not self.acquisition_date:
            return []
        rate = self.effective_rate
        horizon = years or (int(100 / rate) + 1 if rate else 1)
        rows, opening = [], self.cost
        for i in range(min(horizon, 60)):
            end = datetime.date(self.acquisition_date.year + i + 1, self.acquisition_date.month, 1)
            charge = min(opening, (self.cost * rate / 100).quantize(Decimal("0.01")))
            rows.append({"year": i + 1, "period_end": end, "opening": opening, "depreciation": charge,
                         "closing": opening - charge})
            opening -= charge
            if opening <= 0:
                break
        return rows


class AssetMovement(BaseModel):
    """Transfer of an asset to another unit (requires approval at the receiving unit)."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        CANCELLED = "cancelled", "Cancelled"

    asset = models.ForeignKey(Asset, on_delete=models.PROTECT, related_name="movements")
    from_unit = models.ForeignKey("organization.OrgUnit", on_delete=models.PROTECT, related_name="+")
    to_unit = models.ForeignKey("organization.OrgUnit", on_delete=models.PROTECT, related_name="+")
    reason = models.TextField()
    new_location = models.CharField(max_length=200, blank=True, default="")
    new_custodian = models.CharField(max_length=160, blank=True, default="")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING, db_index=True)
    decided_by = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    decided_at = models.DateTimeField(null=True, blank=True)
    comment = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-created_at"]
        constraints = [models.UniqueConstraint(fields=["asset"], condition=models.Q(status="pending"),
                                               name="one_pending_movement_per_asset")]


class MaintenanceRecord(BaseModel):
    class Kind(models.TextChoices):
        ROUTINE = "routine", "Routine service"
        REPAIR = "repair", "Repair"
        INSPECTION = "inspection", "Inspection"
        UPGRADE = "upgrade", "Upgrade / renovation"

    asset = models.ForeignKey(Asset, on_delete=models.PROTECT, related_name="maintenance")
    kind = models.CharField(max_length=12, choices=Kind.choices, default=Kind.ROUTINE)
    date = models.DateField(default=timezone.localdate)
    description = models.TextField()
    provider = models.CharField(max_length=160, blank=True, default="")
    cost = models.DecimalField(**MONEY, default=Decimal("0"), validators=[MinValueValidator(Decimal("0"))])
    condition_after = models.CharField(max_length=14, choices=Asset.Condition.choices, blank=True, default="")
    next_due_date = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["-date", "-created_at"]


class AssetDisposal(BaseModel):
    class Method(models.TextChoices):
        SALE = "sale", "Sale"
        DONATION = "donation", "Donation"
        SCRAP = "scrap", "Scrapped"
        WRITE_OFF = "write_off", "Written off"
        LOST = "lost", "Lost / stolen"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending approval"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    asset = models.ForeignKey(Asset, on_delete=models.PROTECT, related_name="disposals")
    method = models.CharField(max_length=10, choices=Method.choices)
    reason = models.TextField()
    proposed_date = models.DateField(default=timezone.localdate)
    proceeds = models.DecimalField(**MONEY, default=Decimal("0"), validators=[MinValueValidator(Decimal("0"))])
    book_value_at_request = models.DecimalField(**MONEY, default=Decimal("0"), editable=False)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING, db_index=True)
    decided_by = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    decided_at = models.DateTimeField(null=True, blank=True)
    comment = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-created_at"]
        constraints = [models.UniqueConstraint(fields=["asset"], condition=models.Q(status="pending"),
                                               name="one_pending_disposal_per_asset")]
