import datetime

import django_filters
from django.db.models import Exists, OuterRef, Q
from django.utils import timezone

from apps.organization.models import OrgUnit

from .models import DiscipleshipClass, DiscipleshipCompletion, Member


def years_ago(n):
    today = timezone.localdate()
    try:
        return today.replace(year=today.year - n)
    except ValueError:  # 29 Feb
        return today.replace(year=today.year - n, day=28)


class WithinUnitFilter(django_filters.UUIDFilter):
    """Restrict to records whose org unit is the given unit or below it."""

    def __init__(self, *args, path_field="org_unit__path", **kwargs):
        self.path_field = path_field
        super().__init__(*args, **kwargs)

    def filter(self, qs, value):
        if not value:
            return qs
        unit = OrgUnit.objects.filter(pk=value).first()
        if unit is None:
            return qs.none()
        return qs.filter(**{f"{self.path_field}__startswith": unit.path})


class MemberFilter(django_filters.FilterSet):
    org_unit = WithinUnitFilter()
    discipleship_badge = django_filters.BooleanFilter(field_name="discipleship_badge_on", lookup_expr="isnull",
                                                      exclude=True)
    joined_from = django_filters.DateFilter(field_name="joined_on", lookup_expr="gte")
    joined_to = django_filters.DateFilter(field_name="joined_on", lookup_expr="lte")
    age_min = django_filters.NumberFilter(method="filter_age_min")
    age_max = django_filters.NumberFilter(method="filter_age_max")
    age_group = django_filters.CharFilter(method="filter_age_group")
    is_demo = django_filters.BooleanFilter()

    class Meta:
        model = Member
        fields = ["status", "gender", "category", "baptism_status", "marital_status"]

    def filter_age_min(self, qs, name, value):
        return qs.filter(date_of_birth__lte=years_ago(int(value)))

    def filter_age_max(self, qs, name, value):
        return qs.filter(date_of_birth__gt=years_ago(int(value) + 1))

    def filter_age_group(self, qs, name, value):
        if value == "unknown":
            return qs.filter(date_of_birth__isnull=True)
        for label, lo, hi in AGE_GROUPS:
            if label == value:
                q = Q(date_of_birth__lte=years_ago(lo))
                if hi is not None:
                    q &= Q(date_of_birth__gt=years_ago(hi + 1))
                return qs.filter(q)
        return qs


AGE_GROUPS = [
    ("0-12", 0, 12),
    ("13-17", 13, 17),
    ("18-35", 18, 35),
    ("36-59", 36, 59),
    ("60+", 60, None),
]


def age_group_of(dob: datetime.date | None):
    if not dob:
        return "unknown"
    today = timezone.localdate()
    age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
    for label, lo, hi in AGE_GROUPS:
        if age >= lo and (hi is None or age <= hi):
            return label
    return "unknown"


def _has_completed(course=None):
    qs = DiscipleshipCompletion.objects.filter(member=OuterRef("pk"))
    return Exists(qs.filter(course=course) if course else qs)


class DiscipleshipRegisterFilter(MemberFilter):
    PROGRESS = [("badge", "Badge of discipleship"), ("in_progress", "In progress"), ("not_started", "Not started")]

    progress = django_filters.ChoiceFilter(choices=PROGRESS, method="filter_progress")
    completed = django_filters.ChoiceFilter(choices=DiscipleshipClass.choices, method="filter_completed")
    missing = django_filters.ChoiceFilter(choices=DiscipleshipClass.choices, method="filter_missing")
    badge_from = django_filters.DateFilter(field_name="discipleship_badge_on", lookup_expr="gte")
    badge_to = django_filters.DateFilter(field_name="discipleship_badge_on", lookup_expr="lte")

    def filter_progress(self, qs, name, value):
        if value == "badge":
            return qs.filter(discipleship_badge_on__isnull=False)
        if value == "in_progress":
            return qs.filter(_has_completed(), discipleship_badge_on__isnull=True)
        if value == "not_started":
            return qs.filter(~_has_completed())
        return qs

    def filter_completed(self, qs, name, value):
        return qs.filter(_has_completed(value))

    def filter_missing(self, qs, name, value):
        return qs.filter(~_has_completed(value))
