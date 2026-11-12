import datetime

import pytest
from django.utils import timezone

from apps.notifications.models import Notification
from apps.reports import periods
from apps.reports.models import ReportSubmission, ReportTemplate

pytestmark = pytest.mark.django_db


@pytest.fixture
def tpl(seeded):
    return {t.code: t for t in ReportTemplate.objects.all()}


def last_month():
    return periods.previous_period("monthly", timezone.localdate())


def create(api, user, unit, template, start=None, **answers):
    start = start or last_month()[0]
    return api(user).post("/api/reports/", {"template": str(template.pk), "org_unit": str(unit.pk),
                                            "period_start": str(start), "answers": answers}, format="json")


def test_periods():
    d = datetime.date(2026, 5, 17)
    assert periods.period_containing("monthly", d) == (datetime.date(2026, 5, 1), datetime.date(2026, 5, 31))
    assert periods.period_containing("quarterly", d) == (datetime.date(2026, 4, 1), datetime.date(2026, 6, 30))
    assert periods.previous_period("quarterly", d) == (datetime.date(2026, 1, 1), datetime.date(2026, 3, 31))
    assert periods.previous_period("annual", d) == (datetime.date(2025, 1, 1), datetime.date(2025, 12, 31))
    assert periods.previous_period("monthly", datetime.date(2026, 3, 1)) == (datetime.date(2026, 2, 1), datetime.date(2026, 2, 28))


def test_create_rules(api, people, units, tpl):
    r = create(api, people["pastor_koidu"], units["BR-KONO-001"], tpl["branch-monthly"], highlights="Revival week")
    assert r.status_code == 201, r.data
    assert r.data["period_end"] == str(last_month()[1])
    # mid-month date snaps to the period; duplicates refused
    again = create(api, people["pastor_koidu"], units["BR-KONO-001"], tpl["branch-monthly"], start=last_month()[0] + datetime.timedelta(days=9))
    assert again.status_code == 400
    # wrong template for the unit type, future periods, other branches
    assert create(api, people["pastor_koidu"], units["BR-KONO-001"], tpl["district-monthly"]).status_code == 400
    future = timezone.localdate() + datetime.timedelta(days=40)
    assert create(api, people["pastor_koidu"], units["BR-KONO-001"], tpl["branch-monthly"], start=future).status_code == 400
    assert create(api, people["pastor_koidu"], units["BR-BO-001"], tpl["branch-monthly"]).status_code == 403


def test_submit_freezes_figures_and_review_at_parent(api, people, units, tpl, django_capture_on_commit_callbacks):
    rid = create(api, people["pastor_koidu"], units["BR-KONO-001"], tpl["branch-monthly"]).data["id"]
    c = api(people["pastor_koidu"])
    # required question unanswered
    assert c.post(f"/api/reports/{rid}/submit/").status_code == 400
    c.patch(f"/api/reports/{rid}/", {"answers": {"highlights": "Good month"}}, format="json")
    with django_capture_on_commit_callbacks(execute=True):
        r = c.post(f"/api/reports/{rid}/submit/")
    assert r.status_code == 200 and r.data["status"] == "submitted"
    assert "membership" in r.data["figures"] and "finance" in r.data["figures"]
    assert Notification.objects.filter(recipient=people["kono"], event_type="report.submitted").exists()
    # locked after submission
    assert c.patch(f"/api/reports/{rid}/", {"answers": {"highlights": "x"}}, format="json").status_code == 400
    assert c.delete(f"/api/reports/{rid}/").status_code in (400, 403)
    # the branch cannot review its own report; another district's overseer cannot see it
    assert c.post(f"/api/reports/{rid}/review/", {"accept": True}, format="json").status_code == 403
    assert api(people["south"]).post(f"/api/reports/{rid}/review/", {"accept": True}, format="json").status_code == 404
    assert [x["id"] for x in api(people["kono"]).get("/api/reports/awaiting/").data] == [rid]
    assert api(people["kono"]).post(f"/api/reports/{rid}/review/", {"accept": False}, format="json").status_code == 400
    r = api(people["kono"]).post(f"/api/reports/{rid}/review/", {"accept": False, "comment": "Add attendance notes"},
                                 format="json")
    assert r.data["status"] == "returned"
    assert c.patch(f"/api/reports/{rid}/", {"answers": {"highlights": "Good month", "outreach": "Market crusade"}},
                   format="json").status_code == 200
    c.post(f"/api/reports/{rid}/submit/")
    r = api(people["kono"]).post(f"/api/reports/{rid}/review/", {"accept": True}, format="json")
    assert r.data["status"] == "approved"
    pdf = c.get(f"/api/reports/{rid}/pdf/")
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"


def test_cannot_submit_before_period_ends(api, people, units, tpl):
    start = periods.period_containing("monthly", timezone.localdate())[0]
    rid = create(api, people["pastor_koidu"], units["BR-KONO-001"], tpl["branch-monthly"], start=start,
                 highlights="x").data["id"]
    assert api(people["pastor_koidu"]).post(f"/api/reports/{rid}/submit/").status_code == 400


def test_compliance_and_due(api, people, units, tpl):
    rid = create(api, people["pastor_koidu"], units["BR-KONO-001"], tpl["branch-monthly"], highlights="x").data["id"]
    api(people["pastor_koidu"]).post(f"/api/reports/{rid}/submit/")
    data = api(people["kono"]).get(f"/api/reports/compliance/?template={tpl['branch-monthly'].pk}").data
    by_unit = {r["org_unit_name"]: r["status"] for r in data["rows"]}
    assert by_unit[units["BR-KONO-001"].name] == "submitted"
    assert by_unit[units["BR-KONO-002"].name] == "missing"
    assert units["BR-BO-001"].name not in by_unit  # outside the district
    assert data["counts"]["submitted"] == 1 and data["rate"] == round(100 / data["expected"])
    assert len(data["periods"]) == 12
    xlsx = api(people["kono"]).get(f"/api/reports/compliance/?template={tpl['branch-monthly'].pk}&file_format=xlsx")
    assert xlsx.status_code == 200
    due = api(people["pastor_lei"]).get("/api/reports/due/").data
    assert {d["template_name"] for d in due} >= {"Monthly branch report"}
    assert all(d["org_unit_name"] == units["BR-KONO-002"].name for d in due)
    assert not [d for d in api(people["pastor_koidu"]).get("/api/reports/due/").data if d["template_name"] == "Monthly branch report"]
    dash = api(people["kono"]).get("/api/dashboard/").data
    assert dash["reports"]["compliance"]


def test_district_report_counts_branch_reports(api, people, units, tpl):
    rid = create(api, people["pastor_koidu"], units["BR-KONO-001"], tpl["branch-monthly"], highlights="x").data["id"]
    api(people["pastor_koidu"]).post(f"/api/reports/{rid}/submit/")
    did = create(api, people["kono"], units["DT-KONO"], tpl["district-monthly"], summary="Steady").data["id"]
    figures = api(people["kono"]).get(f"/api/reports/{did}/figures/").data["figures"]
    assert figures["sub_units"]["reported"] == 1 and figures["sub_units"]["expected"] >= 2


def test_templates_editable_only_with_settings(api, people, tpl):
    t = tpl["branch-monthly"]
    assert api(people["pastor_koidu"]).get("/api/report-templates/").status_code == 200
    assert api(people["pastor_koidu"]).patch(f"/api/report-templates/{t.pk}/", {"due_days": 5},
                                             format="json").status_code == 403
    r = api(people["admin"]).patch(f"/api/report-templates/{t.pk}/", {"questions": [{"key": "a"}]}, format="json")
    assert r.status_code == 400
    assert api(people["admin"]).patch(f"/api/report-templates/{t.pk}/", {"due_days": 7}, format="json").data["due_days"] == 7
    assert ReportSubmission.objects.count() == 0
