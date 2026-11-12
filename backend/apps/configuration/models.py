"""Ministry-wide configuration: profile, currencies, financial years and the
lookup lists (categories) that leadership can edit without code changes."""
import datetime

from django.core.exceptions import ValidationError
from django.db import models

from apps.core.models import BaseModel, SyncModel


class SystemSetting(BaseModel):
    """Singleton ministry profile & behaviour settings."""

    ministry_name = models.CharField(max_length=200, default="Rivers of Living Water Ministries")
    alternate_name = models.CharField(max_length=200, default="Holy Ghost Bible Church", blank=True)
    short_name = models.CharField(max_length=20, default="RLWM")
    motto = models.CharField(max_length=200, default="Jesus Is Alive", blank=True)
    guiding_scripture = models.CharField(
        max_length=300, blank=True,
        default='"Let all things be done decently and in order." — 1 Corinthians 14:40 (KJV)',
    )
    logo = models.ImageField(upload_to="branding/", null=True, blank=True)
    hq_address = models.TextField(default="Koidu City, Kono District, Eastern Province, Sierra Leone")
    phone = models.CharField(max_length=60, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    website = models.URLField(blank=True, default="")
    default_currency = models.CharField(max_length=3, default="SLE")
    financial_year_start_month = models.PositiveSmallIntegerField(default=1, help_text="1 = January")
    membership_number_prefix = models.CharField(max_length=10, default="RLWM")
    data_retention_years = models.PositiveSmallIntegerField(
        default=10, help_text="Minimum years institutional records are retained before archival review.")
    audit_retention_years = models.PositiveSmallIntegerField(default=10)
    allow_individual_attendance = models.BooleanField(default=True)
    require_income_approval = models.BooleanField(default=True)

    class Meta:
        verbose_name = "System settings"

    def __str__(self):
        return self.ministry_name

    def clean(self):
        if not 1 <= self.financial_year_start_month <= 12:
            raise ValidationError({"financial_year_start_month": "Month must be between 1 and 12."})

    def save(self, *args, **kwargs):
        if not self.pk or not SystemSetting.objects.filter(pk=self.pk).exists():
            if SystemSetting.objects.exists():
                raise ValidationError("System settings already exist; edit the existing record.")
        super().save(*args, **kwargs)

    @classmethod
    def get(cls):
        obj = cls.objects.first()
        if obj is None:
            obj = cls.objects.create()
        return obj


class Currency(models.Model):
    code = models.CharField(max_length=3, primary_key=True)
    name = models.CharField(max_length=60)
    symbol = models.CharField(max_length=8, blank=True, default="")
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["code"]
        verbose_name_plural = "currencies"

    def __str__(self):
        return self.code


class FinancialYear(BaseModel):
    name = models.CharField(max_length=40, unique=True)
    start_date = models.DateField()
    end_date = models.DateField()
    is_closed = models.BooleanField(default=False)

    class Meta:
        ordering = ["-start_date"]
        constraints = [
            models.CheckConstraint(condition=models.Q(end_date__gt=models.F("start_date")), name="fy_end_after_start"),
        ]

    def __str__(self):
        return self.name

    def clean(self):
        overlapping = FinancialYear.objects.filter(start_date__lte=self.end_date, end_date__gte=self.start_date)
        if self.pk:
            overlapping = overlapping.exclude(pk=self.pk)
        if overlapping.exists():
            raise ValidationError("Financial years cannot overlap.")

    @classmethod
    def for_date(cls, date):
        fy = cls.objects.filter(start_date__lte=date, end_date__gte=date).first()
        if fy:
            return fy
        # Create the financial year automatically using the configured start month.
        start_month = SystemSetting.get().financial_year_start_month
        year = date.year if date.month >= start_month else date.year - 1
        start = datetime.date(year, start_month, 1)
        end = datetime.date(year + 1, start_month, 1) - datetime.timedelta(days=1)
        name = f"FY {year}" if start_month == 1 else f"FY {year}/{str(year + 1)[-2:]}"
        return cls.objects.create(name=name, start_date=start, end_date=end)


class LookupModel(SyncModel):
    code = models.SlugField(max_length=60, unique=True)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveSmallIntegerField(default=100)

    class Meta:
        abstract = True
        ordering = ["sort_order", "name"]

    def __str__(self):
        return self.name


class MembershipCategory(LookupModel):
    requirements = models.TextField(blank=True, default="", help_text="Requirements set by church leadership.")

    class Meta(LookupModel.Meta):
        verbose_name_plural = "membership categories"


class FinanceCategory(LookupModel):
    class Kind(models.TextChoices):
        INCOME = "income", "Income"
        EXPENSE = "expense", "Expenditure"

    kind = models.CharField(max_length=10, choices=Kind.choices, db_index=True)
    is_restricted = models.BooleanField(default=False, help_text="Funds may only be used for their stated purpose.")

    class Meta(LookupModel.Meta):
        verbose_name_plural = "finance categories"


class AssetCategory(LookupModel):
    default_depreciation_rate = models.DecimalField(
        max_digits=5, decimal_places=2, default=0, help_text="Straight-line % per year (0 = not depreciated).")
    useful_life_years = models.PositiveSmallIntegerField(null=True, blank=True)

    class Meta(LookupModel.Meta):
        verbose_name_plural = "asset categories"


class ProgramCategory(LookupModel):
    class Meta(LookupModel.Meta):
        verbose_name_plural = "program categories"


class ServiceType(LookupModel):
    pass


class DocumentCategory(LookupModel):
    class Meta(LookupModel.Meta):
        verbose_name_plural = "document categories"
