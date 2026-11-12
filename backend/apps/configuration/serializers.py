from rest_framework import serializers

from apps.core.files import SignedFilesMixin
from .models import (AssetCategory, Currency, DocumentCategory, FinanceCategory, FinancialYear, MembershipCategory,
                     ProgramCategory, ServiceType, SystemSetting)


class SystemSettingSerializer(SignedFilesMixin, serializers.ModelSerializer):
    class Meta:
        model = SystemSetting
        exclude = ["created_by", "updated_by"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_logo(self, value):
        if value and value.size > 2 * 1024 * 1024:
            raise serializers.ValidationError("Logo must be smaller than 2 MB.")
        return value

    def validate_financial_year_start_month(self, value):
        if not 1 <= value <= 12:
            raise serializers.ValidationError("Month must be between 1 and 12.")
        return value

    def validate_default_currency(self, value):
        if not Currency.objects.filter(code=value, is_active=True).exists():
            raise serializers.ValidationError("Unknown or inactive currency.")
        return value


class PublicSettingSerializer(SignedFilesMixin, serializers.ModelSerializer):
    class Meta:
        model = SystemSetting
        fields = ["ministry_name", "alternate_name", "short_name", "motto", "guiding_scripture", "logo",
                  "default_currency", "allow_individual_attendance"]


class CurrencySerializer(serializers.ModelSerializer):
    class Meta:
        model = Currency
        fields = ["code", "name", "symbol", "is_active"]


class FinancialYearSerializer(serializers.ModelSerializer):
    class Meta:
        model = FinancialYear
        fields = ["id", "name", "start_date", "end_date", "is_closed"]

    def validate(self, attrs):
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start and end and end <= start:
            raise serializers.ValidationError({"end_date": "End date must be after the start date."})
        qs = FinancialYear.objects.filter(start_date__lte=end, end_date__gte=start)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Financial years cannot overlap.")
        return attrs


def lookup_serializer(model_cls, extra=()):
    class _S(serializers.ModelSerializer):
        class Meta:
            model = model_cls
            fields = ["id", "code", "name", "description", "is_active", "sort_order", *extra]

    _S.__name__ = f"{model_cls.__name__}Serializer"
    return _S


LOOKUPS = {
    "membership-categories": (MembershipCategory, ("requirements",)),
    "finance-categories": (FinanceCategory, ("kind", "is_restricted")),
    "asset-categories": (AssetCategory, ("default_depreciation_rate", "useful_life_years")),
    "program-categories": (ProgramCategory, ()),
    "service-types": (ServiceType, ()),
    "document-categories": (DocumentCategory, ()),
}
