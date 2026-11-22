import django_filters

from apps.members.filters import WithinUnitFilter

from .models import Budget, Transaction


class TransactionFilter(django_filters.FilterSet):
    org_unit = WithinUnitFilter()
    unit_exact = django_filters.UUIDFilter(field_name="org_unit")
    date_from = django_filters.DateFilter(field_name="transaction_date", lookup_expr="gte")
    date_to = django_filters.DateFilter(field_name="transaction_date", lookup_expr="lte")
    min_amount = django_filters.NumberFilter(field_name="amount", lookup_expr="gte")
    max_amount = django_filters.NumberFilter(field_name="amount", lookup_expr="lte")
    status = django_filters.MultipleChoiceFilter(choices=Transaction.Status.choices)
    is_reversal = django_filters.BooleanFilter(field_name="reversal_of", lookup_expr="isnull", exclude=True)
    is_dues = django_filters.BooleanFilter(field_name="dues_month", lookup_expr="isnull", exclude=True)

    class Meta:
        model = Transaction
        fields = ["kind", "status", "account", "category", "financial_year", "member", "method"]


class BudgetFilter(django_filters.FilterSet):
    org_unit = WithinUnitFilter()

    class Meta:
        model = Budget
        fields = ["financial_year", "status"]
