"""Printable report (PDF) with the ministry letterhead."""
import io

from django.utils import timezone

from apps.core.exports import _ministry

from . import periods

LABELS = {
    "membership": ("Membership", {"active_members": "Active members", "new_members": "New members",
                                  "baptisms": "Baptisms"}),
    "attendance": ("Attendance", {"average_sunday": "Average Sunday attendance", "sundays_recorded": "Sundays recorded",
                                  "total": "Total attendance", "first_timers": "First-time guests",
                                  "new_converts": "New converts"}),
    "finance": ("Finance (approved entries)", {"income": "Income", "expenditure": "Expenditure", "net": "Surplus / deficit"}),
    "programs": ("Programs", {"held": "Programs held", "salvations": "Decisions for Christ", "baptisms": "Baptisms at programs"}),
    "sub_units": ("Reporting units below", {"expected": "Units expected to report", "reported": "Units that reported"}),
}


def render_report(report, figures, printed_by):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    from xml.sax.saxutils import escape

    setting, logo = _ministry()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=14 * mm,
                            bottomMargin=16 * mm, title=str(report), author=setting.ministry_name)
    styles = getSampleStyleSheet()
    royal, gold = colors.HexColor("#1D3FA6"), colors.HexColor("#D68002")
    h1 = ParagraphStyle("h1", parent=styles["Title"], fontSize=15, textColor=royal, alignment=0, spaceAfter=0)
    sub = ParagraphStyle("sub", parent=styles["Normal"], fontSize=8, textColor=gold)
    h2 = ParagraphStyle("h2", parent=styles["Heading3"], textColor=royal, spaceBefore=8, spaceAfter=4)
    body = ParagraphStyle("b", parent=styles["Normal"], fontSize=9.5, leading=13)
    small = ParagraphStyle("s", parent=styles["Normal"], fontSize=8, textColor=colors.HexColor("#475569"))
    story = []
    head = Table([[Image(logo, 18 * mm, 18 * mm) if logo else "",
                   [Paragraph(escape(setting.ministry_name), h1), Paragraph(escape(setting.alternate_name.upper()), sub)]]],
                 colWidths=[22 * mm, None])
    head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    story += [head, Spacer(1, 6)]
    story.append(Paragraph(f"<b>{escape(report.template.name)}</b> — {escape(report.org_unit.name)}", body))
    story.append(Paragraph(f"Period: {periods.label(report.template.frequency, report.period_start)} "
                           f"({report.period_start:%d %b %Y} to {report.period_end:%d %b %Y}) · "
                           f"Status: {report.get_status_display()}" +
                           ("" if report.status in ("submitted", "approved") else " · figures are provisional"), small))
    for key, (title, names) in LABELS.items():
        section = figures.get(key)
        if not section:
            continue
        story.append(Paragraph(title, h2))
        rows = [[names.get(k, k), f"{float(v):,.2f}" if key == "finance" else f"{v:,}" if isinstance(v, int) else str(v)]
                for k, v in section.items()]
        t = Table(rows, colWidths=[110 * mm, None])
        t.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 9), ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                               ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#E2E8F0"))]))
        story.append(t)
    for q in report.template.questions:
        answer = str(report.answers.get(q["key"], "")).strip()
        story.append(Paragraph(escape(q["label"]), h2))
        story.append(Paragraph(escape(answer).replace("\n", "<br/>") if answer else "<i>No answer.</i>", body))
    story.append(Spacer(1, 10))
    sign = [
        f"Submitted by: {report.submitted_by.full_name if report.submitted_by_id else '—'}"
        f"{' on ' + timezone.localtime(report.submitted_at).strftime('%d %b %Y') if report.submitted_at else ''}",
        f"Reviewed by: {report.reviewed_by.full_name if report.reviewed_by_id else '—'}"
        f"{' on ' + timezone.localtime(report.reviewed_at).strftime('%d %b %Y') if report.reviewed_at else ''}",
    ]
    if report.review_comment:
        sign.append(f"Reviewer's comment: {report.review_comment}")
    for line in sign:
        story.append(Paragraph(escape(line), small))
    story.append(Paragraph(f"Printed {timezone.localtime():%d %b %Y %H:%M} by {escape(printed_by.full_name)}. "
                           "“Let all things be done decently and in order.” — 1 Corinthians 14:40", small))
    doc.build(story)
    return buf.getvalue()
