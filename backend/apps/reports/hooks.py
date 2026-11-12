"""Seed templates, dashboard section and attention items for reporting."""
from django.utils import timezone

from apps.core import scoping, seed_hooks
from apps.dashboard import sections

BRANCH_QUESTIONS = [
    {"key": "highlights", "label": "Highlights and testimonies", "required": True},
    {"key": "outreach", "label": "Evangelism, outreach and follow-up"},
    {"key": "ministries", "label": "Ministries and departments"},
    {"key": "challenges", "label": "Challenges and needs"},
    {"key": "prayer", "label": "Prayer requests"},
    {"key": "plans", "label": "Plans for the next period"},
]
OVERSIGHT_QUESTIONS = [
    {"key": "summary", "label": "Summary of the units under your oversight", "required": True},
    {"key": "visits", "label": "Pastoral visits and supervision"},
    {"key": "challenges", "label": "Challenges and support needed"},
    {"key": "recommendations", "label": "Recommendations to leadership"},
    {"key": "plans", "label": "Plans for the next period"},
]

DEFAULT_TEMPLATES = [
    {"code": "branch-monthly", "name": "Monthly branch report", "frequency": "monthly",
     "unit_types": ["branch", "congregation"], "due_days": 10, "questions": BRANCH_QUESTIONS,
     "description": "Each branch reports to its district by the 10th of the following month."},
    {"code": "district-monthly", "name": "Monthly district report", "frequency": "monthly",
     "unit_types": ["district"], "due_days": 15, "questions": OVERSIGHT_QUESTIONS,
     "description": "Each district consolidates its branches and reports to the region."},
    {"code": "region-quarterly", "name": "Quarterly regional report", "frequency": "quarterly",
     "unit_types": ["region"], "due_days": 20, "questions": OVERSIGHT_QUESTIONS,
     "description": "Each region reports to National Headquarters every quarter."},
    {"code": "annual", "name": "Annual report", "frequency": "annual", "unit_types": ["branch", "district", "region"],
     "due_days": 31, "questions": [
         {"key": "review", "label": "Review of the year", "required": True},
         {"key": "growth", "label": "Church growth and discipleship"},
         {"key": "property", "label": "Property and projects"},
         {"key": "vision", "label": "Vision and goals for the coming year"}],
     "description": "Year-end report from every branch, district and region."},
]


def seed_templates():
    from .models import ReportTemplate

    for spec in DEFAULT_TEMPLATES:
        ReportTemplate.objects.get_or_create(code=spec["code"], defaults=spec)


seed_hooks.SEED_FUNCTIONS.append(("reports", "apps.reports.hooks.seed_templates"))


@sections.section("reports", "reports.view")
def reports_section(user, ctx):
    from . import periods, services
    from .models import ReportTemplate

    today = timezone.localdate()
    out = []
    for t in ReportTemplate.objects.filter(is_active=True, frequency__in=["monthly", "quarterly"]):
        start, end = periods.previous_period(t.frequency, today)
        data = services.compliance(user, t, start, end)
        if not data or not data["expected"]:
            continue
        if ctx.unit is not None:
            data["rows"] = [r for r in data["rows"] if r["org_unit"] in _subtree_ids(ctx.unit)]
            data["expected"] = len(data["rows"])
            if not data["expected"]:
                continue
            done = sum(1 for r in data["rows"] if r["status"] in ("submitted", "approved"))
            data["rate"] = round(done / data["expected"] * 100)
        out.append({"template": data["template"], "period": data["period"], "expected": data["expected"],
                    "rate": data["rate"], "on_time_rate": data["on_time_rate"],
                    "overdue": [r for r in data["rows"] if r["overdue"]][:10],
                    "overdue_count": sum(1 for r in data["rows"] if r["overdue"])})
    return {"compliance": out}


def _subtree_ids(unit):
    from apps.organization.models import OrgUnit

    return {str(pk) for pk in OrgUnit.objects.filter(path__startswith=unit.path).values_list("pk", flat=True)}


def reports_attention(user, ctx):
    from .views import due_reports
    from .models import ReportSubmission
    from . import services

    items = []
    due = due_reports(user) if scoping.has_perm_anywhere(user, "reports.create") else []
    if due:
        overdue = sum(1 for d in due if d["overdue"])
        items.append({"key": "reports_due", "label": "Reports your unit owes" + (" (overdue)" if overdue else ""),
                      "count": len(due), "link": "/reports?tab=mine", "severity": "warning" if overdue else "info"})
    q = scoping.scope_q(user, "reports.approve")
    if q is not None:
        pending = [r for r in ReportSubmission.objects.filter(q, status="submitted").select_related("org_unit__parent")[:300]
                   if services.can_review(user, r)]
        if pending:
            items.append({"key": "reports_review", "label": "Reports awaiting your review", "count": len(pending),
                          "link": "/reports?tab=review", "severity": "info"})
    return items


sections.ATTENTION_PROVIDERS.append(reports_attention)
