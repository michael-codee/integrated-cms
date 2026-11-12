"""Official receipt (PDF) for an approved income entry."""
import io

from django.utils import timezone

from apps.core.exports import _ministry


def render_receipt(txn, printed_by):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A5, landscape
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    setting, logo = _ministry()
    buf = io.BytesIO()
    page = landscape(A5)
    doc = SimpleDocTemplate(buf, pagesize=page, leftMargin=12 * mm, rightMargin=12 * mm, topMargin=10 * mm,
                            bottomMargin=10 * mm, title=f"Receipt {txn.reference}", author=setting.ministry_name)
    styles = getSampleStyleSheet()
    royal, gold = colors.HexColor("#1D3FA6"), colors.HexColor("#D68002")
    h1 = ParagraphStyle("h1", parent=styles["Title"], fontSize=14, textColor=royal, alignment=0, spaceAfter=0)
    h2 = ParagraphStyle("h2", parent=styles["Normal"], fontSize=8, textColor=gold)
    small = ParagraphStyle("s", parent=styles["Normal"], fontSize=7.5, leading=9)
    body = ParagraphStyle("b", parent=styles["Normal"], fontSize=9.5, leading=13)
    head = Table([[Image(logo, 16 * mm, 16 * mm) if logo else "",
                   [Paragraph(setting.ministry_name, h1), Paragraph(setting.alternate_name.upper(), h2),
                    Paragraph(f"{txn.org_unit.name} · {setting.hq_address}", small)],
                   Paragraph(f"<para align='right'><b>OFFICIAL RECEIPT</b><br/>{txn.reference}</para>", body)]],
                 colWidths=[20 * mm, None, 45 * mm])
    head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    rows = [
        ["Received from", txn.party or (txn.member.full_name if txn.member_id else "—")],
        ["Membership No.", txn.member.membership_no if txn.member_id else "—"],
        ["Being", f"{txn.category.name}{' — ' + txn.description if txn.description else ''}"],
        ["Amount", f"{txn.currency_id} {txn.amount:,.2f}"],
        ["Payment method", txn.get_method_display() + (f" ({txn.external_ref})" if txn.external_ref else "")],
        ["Date", txn.transaction_date.strftime("%d %B %Y")],
        ["Account", txn.account.name],
    ]
    t = Table([[Paragraph(f"<b>{a}</b>", body), Paragraph(str(b), body)] for a, b in rows],
              colWidths=[38 * mm, doc.width - 38 * mm])
    t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#CBD5E1")),
                           ("BACKGROUND", (0, 3), (-1, 3), colors.HexColor("#EEF3FF"))]))
    approver = txn.approvals.filter(decision="approved").order_by("-created_at").first()
    sig = Table([[Paragraph(f"Recorded by<br/><b>{txn.created_by.full_name if txn.created_by_id else '—'}</b>", small),
                  Paragraph(f"Approved by<br/><b>{approver.created_by.full_name if approver else '—'}</b>", small),
                  Paragraph(f"Printed {timezone.localtime().strftime('%d %b %Y %H:%M')}<br/>by {printed_by.full_name}",
                            small)]], colWidths=[doc.width / 3] * 3)
    story = [head, Spacer(1, 3), Table([[""]], colWidths=[doc.width], rowHeights=[1.2],
                                       style=[("BACKGROUND", (0, 0), (-1, -1), gold)]), Spacer(1, 8), t,
             Spacer(1, 14), sig, Spacer(1, 6),
             Paragraph("<i>“God loveth a cheerful giver.” — 2 Corinthians 9:7</i>", small)]
    if txn.status == "reversed":
        story.insert(0, Paragraph("<font color='#B91C1C'><b>REVERSED — NOT VALID</b></font>", body))
    doc.build(story)
    return buf.getvalue()
