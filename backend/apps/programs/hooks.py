"""Dashboard sections, attention items and demo data for programs, attendance and departments."""
import datetime
import random

from django.utils import timezone

from apps.core import demo_hooks, scoping
from apps.dashboard import sections


@sections.section("programs", "programs.view")
def programs_section(user, ctx):
    from .models import Program
    from .serializers import ProgramSerializer

    q = scoping.scope_q(user, "programs.view", "org_unit__path", "department_id")
    qs = Program.objects.filter(q).select_related("org_unit", "category", "department")
    qs = ctx.within(qs)
    now = timezone.now()
    upcoming = qs.filter(ends_at__gte=now).exclude(status="cancelled").order_by("starts_at")[:6]
    year = qs.filter(starts_at__year=now.year)
    completed = year.filter(status="completed")
    from django.db.models import Sum

    return {
        "upcoming": [{"id": str(p.id), "title": p.title, "starts_at": p.starts_at, "org_unit_name": p.org_unit.name,
                      "category_name": p.category.name, "status": p.status, "venue": p.venue} for p in upcoming],
        "this_year": year.count(), "completed": completed.count(),
        "salvations": completed.aggregate(s=Sum("salvations"))["s"] or 0,
        "baptisms": completed.aggregate(s=Sum("baptisms"))["s"] or 0,
    }


@sections.section("attendance", "attendance.view")
def attendance_section(user, ctx):
    from apps.attendance.stats import attendance_stats

    data = attendance_stats(user, ctx.unit, ctx.date_from, ctx.date_to)
    data["by_branch"] = data["by_branch"][:12]
    return data


def programs_attention(user, ctx):
    from .models import Program
    from .services import approver_unit

    items = []
    q = scoping.scope_q(user, "programs.approve")
    if q is not None:
        pending = [p for p in Program.objects.filter(q, status="pending_approval").select_related("org_unit__parent")[:200]
                   if p.created_by_id != user.pk and scoping.can(user, "programs.approve", approver_unit(p))]
        if pending:
            items.append({"key": "programs", "label": "Programs awaiting your approval", "count": len(pending),
                          "link": "/programs?status=pending_approval", "severity": "info"})
    q = scoping.scope_q(user, "programs.edit", "org_unit__path", "department_id")
    if q is not None:
        overdue = Program.objects.filter(q, status__in=["planned", "approved"],
                                         ends_at__lt=timezone.now() - datetime.timedelta(days=3)).count()
        if overdue:
            items.append({"key": "program_reports", "label": "Past programs without an outcome report",
                          "count": overdue, "link": "/programs?status=planned&status=approved&past=1",
                          "severity": "warning"})
    return items


sections.ATTENTION_PROVIDERS.append(programs_attention)


DEPARTMENTS = [("Youth Ministry", "youth"), ("Women's Fellowship", "women"), ("Men's Fellowship", "men"),
               ("Sunday School", "children"), ("Choir", "worship"), ("Evangelism Team", "evangelism")]


def _demo_counts(rng, total):
    """A plausible split of ``total`` by ministry category and by gender."""
    men, women, youth, young = (int(total * rng.uniform(*r)) for r in ((.2, .26), (.3, .36), (.1, .15), (.1, .14)))
    children = total - men - women - youth - young
    male = men + int((children + youth + young) * rng.uniform(.42, .5))
    return {"men": men, "women": women, "children": children, "youth": youth, "young_adults": young,
            "male": male, "female": total - male}


def generate_demo(rng: random.Random, members):
    from apps.attendance.models import AttendanceRecord
    from apps.configuration.models import ProgramCategory, ServiceType
    from apps.departments.models import Department, DepartmentMember
    from apps.organization.models import OrgUnit

    from .models import Program

    today = timezone.localdate()
    sunday = ServiceType.objects.get(code="sunday-service")
    tuesday = ServiceType.objects.get(code="tuesday-bible-study")
    friday = ServiceType.objects.get(code="friday-prayer-deliverance")
    special = ServiceType.objects.get(code="special-program")
    cats = {c.code: c for c in ProgramCategory.objects.all()}
    by_branch = {}
    for m in members:
        by_branch.setdefault(m.org_unit_id, []).append(m)
    n = 0
    tz = timezone.get_current_timezone()
    for branch in OrgUnit.objects.filter(unit_type="branch", status="active"):
        roster = by_branch.get(branch.id, [])
        size = len([m for m in roster if m.status == "active"]) or 50
        for name, kind in DEPARTMENTS:
            d, _ = Department.objects.get_or_create(org_unit=branch, name=name, defaults={
                "kind": kind, "leader_name": "[DEMO] Leader", "meeting_schedule": "Saturdays 4pm"})
            pool = [m for m in roster if (kind != "men" or m.gender == "male") and (kind != "women" or m.gender == "female")]
            for m in rng.sample(pool, min(len(pool), rng.randint(6, 18))):
                DepartmentMember.objects.get_or_create(department=d, member=m, left_on=None)
        rows = []
        day = today - datetime.timedelta(days=(today.weekday() + 1) % 7)  # last Sunday
        for w in range(26):
            d = day - datetime.timedelta(weeks=w)
            total = int(size * rng.uniform(0.55, 0.85))
            rows.append(AttendanceRecord(org_unit=branch, service_type=sunday, date=d, **_demo_counts(rng, total),
                                         visitors=rng.randint(0, 8), first_timers=rng.randint(0, 5),
                                         new_converts=rng.randint(0, 3), notes="[DEMO]", is_demo=True))
            for service, back in ((tuesday, 5), (friday, 2)):
                mid = int(total * rng.uniform(0.3, 0.45))
                rows.append(AttendanceRecord(org_unit=branch, service_type=service, date=d - datetime.timedelta(days=back),
                                             **_demo_counts(rng, mid), notes="[DEMO]", is_demo=True))
        AttendanceRecord.objects.bulk_create(rows)
        n += len(rows)
        for code, title, offset, days in (("revival", "Easter Revival", -120, 3), ("crusade", "Open-Air Crusade", -45, 2),
                                          ("youth-program", "Youth Rally", -10, 1), ("conference", "Branch Thanksgiving", 20, 1),
                                          ("evangelism", "Market Outreach", 6, 1)):
            start = timezone.make_aware(datetime.datetime.combine(today + datetime.timedelta(days=offset + rng.randint(-3, 3)),
                                                                  datetime.time(16)), tz)
            past = start < timezone.now()
            p = Program.objects.create(
                title=f"{title} — {branch.town or branch.name}", category=cats[code], org_unit=branch,
                venue="Church premises", starts_at=start, ends_at=start + datetime.timedelta(days=days - 1, hours=3),
                coordinator="[DEMO] Coordinator", expected_attendance=int(size * 1.2),
                status="completed" if past else "planned", salvations=rng.randint(2, 30) if past else None,
                report_summary="[DEMO] Program held as planned." if past else "", description="[DEMO] fictional program")
            if past:
                AttendanceRecord.objects.create(org_unit=branch, service_type=special, program=p, date=start.date(),
                                                **_demo_counts(rng, int(size * 1.4)),
                                                visitors=rng.randint(10, 60), notes="[DEMO]", is_demo=True)
    return n


demo_hooks.EXTRA_GENERATORS.append(("attendance, programs and departments", generate_demo))
demo_hooks.PURGE_SQL[:0] = [
    "DELETE FROM attendance_attendanceentry WHERE record_id IN (SELECT id FROM attendance_attendancerecord WHERE is_demo)",
    "DELETE FROM attendance_attendancerecord WHERE is_demo",
    "DELETE FROM programs_program WHERE description = '[DEMO] fictional program'",
    "DELETE FROM departments_departmentmember WHERE department_id IN "
    "(SELECT id FROM departments_department WHERE leader_name = '[DEMO] Leader')",
    "DELETE FROM departments_department WHERE leader_name = '[DEMO] Leader'",
]
