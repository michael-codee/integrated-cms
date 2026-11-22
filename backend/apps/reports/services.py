import datetime

from django.db import transaction
from django.db.models import Avg, Sum
from django.utils import timezone

from apps.audit import services as audit
from apps.audit.models import AuditLog
from apps.core import scoping
from apps.core.events import publish
from apps.core.exceptions import BusinessRuleError
from apps.organization.models import OrgUnit

from . import periods
from .models import ReportSubmission, ReportTemplate


def due_date(template, period_end):
    return period_end + datetime.timedelta(days=template.due_days)


def reviewer_unit(unit):
    return unit.parent or unit


def _num(value):
    return float(value) if value is not None else 0


def compute_figures(template, unit, start, end):
    """Live figures for ``unit`` and everything below it for the period."""
    from apps.attendance.models import TOTAL as ATTENDANCE_TOTAL
    from apps.attendance.models import AttendanceRecord
    from apps.finance.models import Transaction
    from apps.finance.services import totals
    from apps.members.models import BaptismRecord, Member
    from apps.programs.models import Program

    within = {"org_unit__path__startswith": unit.path}
    members = Member.objects.filter(**within)
    att = AttendanceRecord.objects.filter(**within, date__range=(start, end)).annotate(t=ATTENDANCE_TOTAL)
    sunday = att.filter(service_type__code="sunday-service", program__isnull=True, department__isnull=True)
    att_agg = att.aggregate(total=Sum("t"), first=Sum("first_timers"), converts=Sum("new_converts"))
    fin = totals(Transaction.objects.filter(**within, transaction_date__range=(start, end)))
    held = Program.objects.filter(**within, status="completed", starts_at__date__range=(start, end))
    prog = held.aggregate(s=Sum("salvations"), b=Sum("baptisms"))
    data = {
        "membership": {
            "active_members": members.filter(status="active").count(),
            "new_members": members.filter(joined_on__range=(start, end)).count(),
            "baptisms": BaptismRecord.objects.filter(**within, date__range=(start, end)).count(),
        },
        "attendance": {
            "average_sunday": round(_num(sunday.aggregate(a=Avg("t"))["a"])),
            "sundays_recorded": sunday.count(),
            "total": int(att_agg["total"] or 0),
            "first_timers": int(att_agg["first"] or 0),
            "new_converts": int(att_agg["converts"] or 0),
        },
        "finance": {"income": str(fin["income"]), "expenditure": str(fin["expense"]), "net": str(fin["net"])},
        "programs": {"held": held.count(), "salvations": int(prog["s"] or 0), "baptisms": int(prog["b"] or 0)},
    }
    children = OrgUnit.objects.filter(parent=unit, status="active")
    if children.exists():
        child_reports = ReportSubmission.objects.filter(
            org_unit__in=children, period_start__gte=start, period_end__lte=end,
            status__in=[ReportSubmission.Status.SUBMITTED, ReportSubmission.Status.APPROVED])
        data["sub_units"] = {"expected": children.count(),
                             "reported": child_reports.values("org_unit").distinct().count()}
    return data


def _check_period(template, start, end):
    expected = periods.period_containing(template.frequency, start)
    if (start, end) != expected:
        raise BusinessRuleError(f"A {template.get_frequency_display().lower()} report runs from "
                                f"{expected[0]:%d %b %Y} to {expected[1]:%d %b %Y}.")
    if start > timezone.localdate():
        raise BusinessRuleError("Reports cannot be prepared for a future period.")


@transaction.atomic
def submit(report, user):
    if report.status not in (ReportSubmission.Status.DRAFT, ReportSubmission.Status.RETURNED):
        raise BusinessRuleError("This report has already been submitted.")
    if report.period_end >= timezone.localdate():
        raise BusinessRuleError(f"The period ends on {report.period_end:%d %b %Y}; submit it after that date.")
    missing = [q["label"] for q in report.template.questions if q.get("required") and not
               str(report.answers.get(q["key"], "")).strip()]
    if missing:
        raise BusinessRuleError(f"Please answer: {', '.join(missing)}.")
    report.figures = compute_figures(report.template, report.org_unit, report.period_start, report.period_end)
    report.status = ReportSubmission.Status.SUBMITTED
    report.submitted_at, report.submitted_by, report.updated_by = timezone.now(), user, user
    report.save()
    audit.record(AuditLog.Action.SUBMIT, instance=report)
    publish("report.submitted", org_unit=reviewer_unit(report.org_unit), actor=user,
            title=f"Report to review: {report.org_unit.name}",
            body=f"{report.template.name}, {periods.label(report.template.frequency, report.period_start)}",
            link=f"/reports/{report.pk}", notify_perm="reports.approve")
    return report


def can_review(user, report):
    return (report.status == ReportSubmission.Status.SUBMITTED and user.pk != report.submitted_by_id
            and scoping.can(user, "reports.approve", reviewer_unit(report.org_unit)))


@transaction.atomic
def review(report, user, accept, comment=""):
    if report.status != ReportSubmission.Status.SUBMITTED:
        raise BusinessRuleError("This report is not awaiting review.")
    if user.pk == report.submitted_by_id:
        raise BusinessRuleError("Segregation of duties: you submitted this report.", status_code=403)
    unit = reviewer_unit(report.org_unit)
    if not scoping.can(user, "reports.approve", unit):
        raise BusinessRuleError(f"Reports of {report.org_unit.name} are reviewed at {unit.name}.", status_code=403)
    if not accept and not comment.strip():
        raise BusinessRuleError("Say what needs correcting when returning a report.")
    report.status = ReportSubmission.Status.APPROVED if accept else ReportSubmission.Status.RETURNED
    report.reviewed_at, report.reviewed_by, report.review_comment = timezone.now(), user, comment
    report.updated_by = user
    report.save()
    audit.record(AuditLog.Action.APPROVE if accept else AuditLog.Action.RETURN, instance=report, message=comment)
    publish("report.reviewed", org_unit=report.org_unit, actor=user,
            title=f"Report {'accepted' if accept else 'returned'}: {report.org_unit.name}", body=comment,
            link=f"/reports/{report.pk}", recipients=[report.submitted_by_id, report.created_by_id])
    return report


def compliance(user, template, start, end):
    """Which units in the user's jurisdiction owe this report, and where each stands."""
    q = scoping.scope_q(user, "reports.view", "path")
    if q is None:
        return None
    units = list(OrgUnit.objects.filter(q, unit_type__in=template.unit_types, status="active")
                 .select_related("parent").order_by("path"))
    subs = {s.org_unit_id: s for s in ReportSubmission.objects.filter(
        template=template, period_start=start, org_unit__in=units).select_related("submitted_by")}
    due = due_date(template, end)
    today = timezone.localdate()
    rows, counts = [], {"approved": 0, "submitted": 0, "returned": 0, "draft": 0, "missing": 0}
    for u in units:
        s = subs.get(u.pk)
        state = s.status if s else "missing"
        counts[state] += 1
        rows.append({
            "org_unit": str(u.pk), "org_unit_name": u.name, "unit_type": u.unit_type,
            "parent_name": u.parent.name if u.parent_id else "", "status": state,
            "submission": str(s.pk) if s else None,
            "submitted_at": s.submitted_at if s else None,
            "submitted_late": bool(s and s.submitted_at and timezone.localdate(s.submitted_at) > due),
            "overdue": today > due and state in ("missing", "draft", "returned"),
        })
    expected = len(units)
    on_time = sum(1 for r in rows if r["status"] in ("submitted", "approved") and not r["submitted_late"])
    return {
        "template": {"id": str(template.pk), "name": template.name, "frequency": template.frequency},
        "period": {"start": start, "end": end, "label": periods.label(template.frequency, start), "due": due},
        "expected": expected, "counts": counts,
        "rate": round((counts["submitted"] + counts["approved"]) / expected * 100) if expected else None,
        "on_time_rate": round(on_time / expected * 100) if expected else None,
        "rows": rows,
    }


def check_period(template, start, end):
    _check_period(template, start, end)


def templates_for_unit(unit):
    return [t for t in ReportTemplate.objects.filter(is_active=True) if unit.unit_type in t.unit_types]
