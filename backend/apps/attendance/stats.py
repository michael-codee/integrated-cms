"""Attendance analytics within the user's jurisdiction."""
import datetime

from django.db.models import Avg, Count, F, Sum
from django.db.models.functions import TruncWeek
from django.utils import timezone

from apps.core import scoping
from apps.organization.models import OrgUnit

from .models import AttendanceRecord

TOTAL = F("men") + F("women") + F("boys") + F("girls")


def attendance_stats(user, unit=None, start=None, end=None):
    end = end or timezone.localdate()
    start = start or end - datetime.timedelta(weeks=12)
    qs = scoping.filter_queryset(AttendanceRecord.objects.all(), user, "attendance.view", "org_unit__path",
                                 "department_id")
    if unit is not None:
        qs = qs.filter(org_unit__path__startswith=unit.path)
    qs = qs.filter(date__gte=start, date__lte=end).annotate(t=TOTAL)
    sunday = qs.filter(service_type__code="sunday-service", program__isnull=True, department__isnull=True)
    agg = qs.aggregate(gatherings=Count("id"), people=Sum("t"), first_timers=Sum("first_timers"),
                       converts=Sum("new_converts"), visitors=Sum("visitors"))
    weekly = [
        {"week": r["w"].isoformat(), "sunday": r["s"] or 0}
        for r in sunday.annotate(w=TruncWeek("date")).values("w").annotate(s=Sum("t")).order_by("w")
    ]
    by_type = list(qs.values("service_type__name").annotate(average=Avg("t"), gatherings=Count("id"))
                   .order_by("-average"))
    # Average Sunday attendance per branch, against active membership.
    from apps.members.models import Member

    by_branch = []
    sundays = {r["org_unit"]: r for r in sunday.values("org_unit").annotate(avg=Avg("t"), n=Count("id"))}
    if sundays:
        members = dict(Member.objects.filter(org_unit_id__in=sundays.keys(), status="active")
                       .values_list("org_unit").annotate(c=Count("id")).values_list("org_unit", "c"))
        names = dict(OrgUnit.objects.filter(pk__in=sundays.keys()).values_list("id", "name"))
        for uid, r in sundays.items():
            m = members.get(uid, 0)
            by_branch.append({"id": str(uid), "name": names.get(uid, "?"), "average": round(r["avg"] or 0),
                              "sundays": r["n"], "members": m,
                              "ratio": round((r["avg"] or 0) / m * 100) if m else None})
        by_branch.sort(key=lambda r: -r["average"])
    composition = sunday.aggregate(men=Sum("men"), women=Sum("women"), boys=Sum("boys"), girls=Sum("girls"))
    avg_sunday = sunday.aggregate(a=Avg("t"))["a"]
    return {
        "period": {"from": start, "to": end},
        "average_sunday": round(avg_sunday) if avg_sunday else 0,
        "gatherings": agg["gatherings"], "total_attendance": agg["people"] or 0,
        "first_timers": agg["first_timers"] or 0, "new_converts": agg["converts"] or 0, "visitors": agg["visitors"] or 0,
        "weekly": weekly,
        "by_service_type": [{"name": r["service_type__name"], "average": round(r["average"] or 0),
                             "gatherings": r["gatherings"]} for r in by_type],
        "by_branch": by_branch,
        "composition": [{"label": k.title(), "count": v or 0} for k, v in composition.items()],
    }
