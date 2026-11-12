"""Membership analytics computed from live records (never hard-coded)."""
import datetime
import uuid
from collections import defaultdict

from django.db.models import Case, CharField, Count, Q, Value, When
from django.db.models.functions import TruncMonth
from django.utils import timezone

from apps.organization.models import OrgUnit

from .filters import AGE_GROUPS, years_ago
from .models import BaptismRecord, Member, MemberTransfer


def month_starts(n=12, end=None):
    end = end or timezone.localdate()
    y, m = end.year, end.month
    months = []
    for _ in range(n):
        months.append(datetime.date(y, m, 1))
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return list(reversed(months))


def age_group_case():
    whens = [When(date_of_birth__isnull=True, then=Value("unknown"))]
    for label, lo, hi in AGE_GROUPS:
        q = Q(date_of_birth__lte=years_ago(lo))
        if hi is not None:
            q &= Q(date_of_birth__gt=years_ago(hi + 1))
        whens.append(When(q, then=Value(label)))
    return Case(*whens, default=Value("unknown"), output_field=CharField())


def rollup_by_level(counts_by_unit: dict, level: str):
    """Aggregate per-branch counts up to regions or districts using unit paths."""
    if not counts_by_unit:
        return []
    units = {u.id: u for u in OrgUnit.objects.filter(id__in=counts_by_unit.keys())}
    totals = defaultdict(int)
    for unit_id, n in counts_by_unit.items():
        unit = units.get(unit_id)
        if not unit:
            continue
        for seg in unit.path.strip("/").split("/"):
            totals[uuid.UUID(seg)] += n
    level_units = OrgUnit.objects.filter(id__in=totals.keys(), unit_type=level)
    return sorted(
        [{"id": str(u.id), "name": u.name, "code": u.code, "count": totals[u.id]} for u in level_units],
        key=lambda r: -r["count"],
    )


def membership_stats(qs, transfers_qs=None, baptisms_qs=None, months=12):
    today = timezone.localdate()
    year_start = today.replace(month=1, day=1)
    month_start = today.replace(day=1)
    agg = qs.aggregate(
        total=Count("id"),
        active=Count("id", filter=Q(status="active")),
        inactive=Count("id", filter=Q(status="inactive")),
        deceased=Count("id", filter=Q(status="deceased")),
        withdrawn=Count("id", filter=Q(status="withdrawn")),
        baptized=Count("id", filter=Q(baptism_status="baptized", status="active")),
        new_this_month=Count("id", filter=Q(joined_on__gte=month_start)),
        new_this_year=Count("id", filter=Q(joined_on__gte=year_start)),
        male=Count("id", filter=Q(gender="male", status="active")),
        female=Count("id", filter=Q(gender="female", status="active")),
    )
    active = qs.filter(status="active")
    by_age = {r["g"]: r["n"] for r in active.annotate(g=age_group_case()).values("g").annotate(n=Count("id"))}
    by_category = list(active.values("category__name").annotate(n=Count("id")).order_by("-n"))
    per_unit = {r["org_unit"]: r["n"] for r in active.values("org_unit").annotate(n=Count("id"))}

    months_list = month_starts(months)
    first = months_list[0]
    joined = {r["m"].date() if hasattr(r["m"], "date") else r["m"]: r["n"] for r in
              qs.filter(joined_on__gte=first).annotate(m=TruncMonth("joined_on")).values("m").annotate(n=Count("id"))}
    base_before = qs.filter(joined_on__lt=first).exclude(exit_date__lt=first).count()
    exits = {r["m"].date() if hasattr(r["m"], "date") else r["m"]: r["n"] for r in
             qs.filter(exit_date__gte=first).annotate(m=TruncMonth("exit_date")).values("m").annotate(n=Count("id"))}
    growth = []
    running = base_before
    for m in months_list:
        new = joined.get(m, 0)
        running += new - exits.get(m, 0)
        growth.append({"month": m.isoformat(), "new": new, "exits": exits.get(m, 0), "total": running})

    baptisms_by_month = {}
    if baptisms_qs is not None:
        baptisms_by_month = {r["m"].date() if hasattr(r["m"], "date") else r["m"]: r["n"] for r in
                             baptisms_qs.filter(date__gte=first).annotate(m=TruncMonth("date")).values("m")
                             .annotate(n=Count("id"))}
    transfers_year = 0
    if transfers_qs is not None:
        transfers_year = transfers_qs.filter(status="completed", decided_at__date__gte=year_start).count()

    prev_total = growth[-2]["total"] if len(growth) > 1 else 0
    growth_rate = round(((growth[-1]["total"] - prev_total) / prev_total) * 100, 2) if prev_total else None
    year_ago_total = growth[0]["total"] if growth else 0
    annual_growth_rate = (round(((growth[-1]["total"] - year_ago_total) / year_ago_total) * 100, 2)
                          if year_ago_total else None)

    unit_names = {u.id: u for u in OrgUnit.objects.filter(id__in=per_unit.keys())}
    by_branch = sorted(
        [{"id": str(k), "name": unit_names[k].name, "code": unit_names[k].code, "count": v}
         for k, v in per_unit.items() if k in unit_names],
        key=lambda r: -r["count"],
    )
    return {
        **agg,
        "transfers_this_year": transfers_year,
        "growth_rate_month": growth_rate,
        "growth_rate_year": annual_growth_rate,
        "by_gender": [{"label": "Male", "count": agg["male"]}, {"label": "Female", "count": agg["female"]}],
        "by_age_group": [{"label": label, "count": by_age.get(label, 0)} for label, _, _ in AGE_GROUPS]
        + [{"label": "unknown", "count": by_age.get("unknown", 0)}],
        "by_category": [{"label": r["category__name"] or "Uncategorised", "count": r["n"]} for r in by_category],
        "by_branch": by_branch,
        "by_district": rollup_by_level(per_unit, "district"),
        "by_region": rollup_by_level(per_unit, "region"),
        "growth": growth,
        "baptisms_by_month": [{"month": m.isoformat(), "count": baptisms_by_month.get(m, 0)} for m in months_list],
    }


def scoped_member_stats(user, unit=None):
    from apps.core import scoping

    qs = scoping.filter_queryset(Member.objects.all(), user, "members.view")
    tq = scoping.filter_queryset(MemberTransfer.objects.all(), user, "members.view")
    bq = scoping.filter_queryset(BaptismRecord.objects.all(), user, "members.view")
    if unit is not None:
        qs = qs.filter(org_unit__path__startswith=unit.path)
        tq = tq.filter(Q(org_unit__path__startswith=unit.path) | Q(to_unit__path__startswith=unit.path))
        bq = bq.filter(org_unit__path__startswith=unit.path)
    return membership_stats(qs, tq, bq)
