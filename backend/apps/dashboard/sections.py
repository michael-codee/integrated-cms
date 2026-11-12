"""
Dashboard sections. Each section is a function ``(user, ctx) -> dict`` that
computes figures from live, jurisdiction-scoped database queries. Modules
register sections here; a section is included only when the user holds its
permission.
"""
import datetime
from dataclasses import dataclass, field

from django.db.models import Count, Q

from apps.core import scoping
from apps.organization.models import OrgUnit


@dataclass
class Context:
    unit: OrgUnit | None = None  # filter: only this unit and below
    date_from: datetime.date | None = None
    date_to: datetime.date | None = None
    financial_year: object = None
    department: str | None = None
    extra: dict = field(default_factory=dict)

    def within(self, qs, path_field="org_unit__path"):
        if self.unit is not None:
            qs = qs.filter(**{f"{path_field}__startswith": self.unit.path})
        return qs


SECTIONS = []


def section(key, perm):
    def decorator(fn):
        SECTIONS.append((key, perm, fn))
        return fn

    return decorator


@section("structure", "org.view")
def structure_section(user, ctx: Context):
    units = ctx.within(scoping.filter_queryset(OrgUnit.objects.all(), user, "org.view", "path"), "path")
    counts = units.aggregate(
        regions=Count("id", filter=Q(unit_type="region", status="active")),
        districts=Count("id", filter=Q(unit_type="district", status="active")),
        branches=Count("id", filter=Q(unit_type="branch", status="active")),
        congregations=Count("id", filter=Q(unit_type="congregation", status="active")),
        inactive_branches=Count("id", filter=Q(unit_type="branch", status="inactive")),
        planned=Count("id", filter=Q(status="planned")),
    )
    from apps.members.models import Member

    member_q = scoping.scope_q(user, "members.view")
    counts_by_unit = {}
    if member_q is not None:
        counts_by_unit = dict(Member.objects.filter(member_q, status="active").values_list("org_unit")
                              .annotate(n=Count("id")).values_list("org_unit", "n"))
    branches = [
        {"id": str(u.id), "name": u.name, "code": u.code, "status": u.status, "town": u.town,
         "latitude": float(u.latitude) if u.latitude is not None else None,
         "longitude": float(u.longitude) if u.longitude is not None else None,
         "members": counts_by_unit.get(u.id, 0)}
        for u in units.filter(unit_type__in=["branch", "congregation"]).order_by("name")
    ]
    return {**counts, "branch_list": branches}


@section("membership", "members.view")
def membership_section(user, ctx: Context):
    from apps.members.stats import scoped_member_stats

    return scoped_member_stats(user, ctx.unit)


@section("attention", "dashboard.view")
def attention_section(user, ctx: Context):
    """Matters requiring this user's action (each module adds its own items)."""
    items = []
    from apps.members.models import MemberTransfer

    q = scoping.scope_q(user, "members.approve", "to_unit__path")
    if q is not None:
        n = ctx.within(MemberTransfer.objects.filter(q, status="pending"), "to_unit__path").count()
        if n:
            items.append({"key": "transfers", "label": "Member transfers awaiting your approval", "count": n,
                          "link": "/members/transfers?direction=incoming", "severity": "info"})
    for provider in ATTENTION_PROVIDERS:
        items.extend(provider(user, ctx))
    return {"items": items}


ATTENTION_PROVIDERS = []  # later modules append callables (user, ctx) -> list[dict]
