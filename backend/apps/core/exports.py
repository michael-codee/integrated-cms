"""
Report/export rendering shared by every module: CSV, Excel (openpyxl) and
PDF (ReportLab). Every export carries the ministry name and logo, title,
reporting period, organisational unit, date generated and who prepared it.
Exports are permission-checked, rate limited and audit logged by
``ExportMixin``.
"""
import csv
import io
from dataclasses import dataclass, field
from pathlib import Path

from django.conf import settings
from django.http import HttpResponse
from django.utils import timezone
from django.utils.text import slugify
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.throttling import UserRateThrottle

from apps.audit import services as audit
from apps.audit.models import AuditLog

from . import scoping

LOGO_PATH = Path(__file__).resolve().parent / "static" / "branding" / "logo.png"
MAX_EXPORT_ROWS = 20000


@dataclass
class Column:
    key: str
    header: str
    width: int = 18
    numeric: bool = False
    getter: object = None  # callable(row) -> value

    def value(self, row):
        if self.getter:
            return self.getter(row)
        value = row
        for part in self.key.split("."):
            value = value.get(part) if isinstance(value, dict) else getattr(value, part, None)
            if callable(value):
                value = value()
        return value


@dataclass
class ExportMeta:
    title: str
    org_unit: str = "All units in your jurisdiction"
    period: str = ""
    prepared_by: str = ""
    reviewed_by: str = ""
    status: str = ""
    summary: list = field(default_factory=list)  # [(label, value)]


def _ministry():
    from apps.configuration.models import SystemSetting

    s = SystemSetting.get()
    logo = None
    if s.logo:
        try:
            logo = s.logo.path
        except (NotImplementedError, ValueError):
            logo = None
    return s, logo or (str(LOGO_PATH) if LOGO_PATH.exists() else None)


def _fmt(value):
    if value is None:
        return ""
    if hasattr(value, "isoformat") and not isinstance(value, str):
        return value.strftime("%d %b %Y") if not hasattr(value, "hour") else value.strftime("%d %b %Y %H:%M")
    return value


def render_csv(columns, rows, meta):
    buf = io.StringIO()
    writer = csv.writer(buf)
    setting, _ = _ministry()
    writer.writerow([setting.ministry_name, meta.title])
    writer.writerow(["Unit", meta.org_unit, "Period", meta.period, "Generated", timezone.localtime().strftime("%d %b %Y %H:%M"),
                     "Prepared by", meta.prepared_by])
    writer.writerow([])
    writer.writerow([c.header for c in columns])
    for row in rows:
        writer.writerow([_fmt(c.value(row)) for c in columns])
    return buf.getvalue().encode("utf-8-sig"), "text/csv", "csv"


def render_xlsx(columns, rows, meta):
    from openpyxl import Workbook
    from openpyxl.drawing.image import Image as XLImage
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    setting, logo = _ministry()
    wb = Workbook()
    ws = wb.active
    ws.title = meta.title[:31] or "Report"
    royal = PatternFill("solid", fgColor="1D3FA6")
    start_col = 2 if logo else 1
    if logo:
        try:
            img = XLImage(logo)
            img.width = img.height = 60
            ws.add_image(img, "A1")
            ws.column_dimensions["A"].width = 10
        except Exception:  # pragma: no cover - corrupt logo file
            start_col = 1
    ws.cell(row=1, column=start_col, value=setting.ministry_name).font = Font(bold=True, size=14, color="1D3FA6")
    ws.cell(row=2, column=start_col, value=setting.alternate_name).font = Font(italic=True, color="B15A06")
    ws.cell(row=3, column=start_col, value=meta.title).font = Font(bold=True, size=12)
    info = [("Organisational unit", meta.org_unit), ("Reporting period", meta.period or "—"),
            ("Date generated", timezone.localtime().strftime("%d %b %Y %H:%M")), ("Prepared by", meta.prepared_by)]
    if meta.reviewed_by:
        info.append(("Reviewed by", meta.reviewed_by))
    if meta.status:
        info.append(("Approval status", meta.status))
    r = 5
    for label, value in info + list(meta.summary):
        ws.cell(row=r, column=start_col, value=label).font = Font(bold=True)
        ws.cell(row=r, column=start_col + 1, value=value)
        r += 1
    r += 1
    header_row = r
    for i, c in enumerate(columns, start=1):
        cell = ws.cell(row=r, column=i, value=c.header)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = royal
        cell.alignment = Alignment(vertical="center", wrap_text=True)
        ws.column_dimensions[get_column_letter(i)].width = max(c.width, ws.column_dimensions[get_column_letter(i)].width or 0)
    for row in rows:
        r += 1
        for i, c in enumerate(columns, start=1):
            value = c.value(row)
            if c.numeric and value not in (None, ""):
                try:
                    value = float(value)
                except (TypeError, ValueError):
                    pass
            cell = ws.cell(row=r, column=i, value=value if not hasattr(value, "tzinfo") or value.tzinfo is None
                           else timezone.localtime(value).replace(tzinfo=None))
            if c.numeric:
                cell.number_format = "#,##0.00"
    ws.freeze_panes = ws.cell(row=header_row + 1, column=1)
    ws.auto_filter.ref = f"A{header_row}:{get_column_letter(len(columns))}{max(r, header_row)}"
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"


def render_pdf(columns, rows, meta):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    setting, logo = _ministry()
    buf = io.BytesIO()
    pagesize = landscape(A4) if len(columns) > 6 else A4
    doc = SimpleDocTemplate(buf, pagesize=pagesize, leftMargin=12 * mm, rightMargin=12 * mm, topMargin=12 * mm,
                            bottomMargin=14 * mm, title=meta.title, author=setting.ministry_name)
    styles = getSampleStyleSheet()
    royal = colors.HexColor("#1D3FA6")
    gold = colors.HexColor("#D68002")
    h1 = ParagraphStyle("h1", parent=styles["Title"], fontSize=15, textColor=royal, alignment=0, spaceAfter=0)
    h2 = ParagraphStyle("h2", parent=styles["Normal"], fontSize=9, textColor=gold, spaceAfter=2)
    h3 = ParagraphStyle("h3", parent=styles["Heading2"], fontSize=12, spaceBefore=4, spaceAfter=4)
    small = ParagraphStyle("small", parent=styles["Normal"], fontSize=7.5, leading=9)
    cell = ParagraphStyle("cell", parent=styles["Normal"], fontSize=7.5, leading=9)

    header_text = [Paragraph(setting.ministry_name, h1), Paragraph(setting.alternate_name.upper(), h2),
                   Paragraph(setting.hq_address, small)]
    head = Table([[Image(logo, 18 * mm, 18 * mm) if logo else "", header_text]], colWidths=[22 * mm, None])
    head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    story = [head, Spacer(1, 4), Table([[""]], colWidths=[doc.width], rowHeights=[1.2],
                                       style=[("BACKGROUND", (0, 0), (-1, -1), gold)]), Spacer(1, 6),
             Paragraph(meta.title, h3)]
    info = [["Organisational unit", meta.org_unit, "Reporting period", meta.period or "—"],
            ["Date generated", timezone.localtime().strftime("%d %b %Y %H:%M"), "Prepared by", meta.prepared_by]]
    if meta.reviewed_by or meta.status:
        info.append(["Reviewed by", meta.reviewed_by or "—", "Approval status", meta.status or "—"])
    t = Table(info, colWidths=[30 * mm, doc.width / 2 - 30 * mm, 30 * mm, doc.width / 2 - 30 * mm])
    t.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 8), ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                           ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    story += [t, Spacer(1, 6)]
    if meta.summary:
        cells = [[Paragraph(f"<b>{label}</b><br/>{value}", cell) for label, value in meta.summary[i:i + 4]]
                 for i in range(0, len(meta.summary), 4)]
        for row in cells:
            row += [""] * (4 - len(row))
        st = Table(cells, colWidths=[doc.width / 4] * 4)
        st.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#BCCDFD")),
                                ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#DBE5FF")),
                                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#EEF3FF"))]))
        story += [st, Spacer(1, 8)]
    data = [[Paragraph(f"<b>{c.header}</b>", ParagraphStyle("th", parent=cell, textColor=colors.white)) for c in columns]]
    for row in rows:
        data.append([Paragraph(str(_fmt(c.value(row)) if not c.numeric else _num(c.value(row))), cell)
                     for c in columns])
    total_width = sum(c.width for c in columns) or 1
    table = Table(data, colWidths=[doc.width * c.width / total_width for c in columns], repeatRows=1)
    style = [("BACKGROUND", (0, 0), (-1, 0), royal), ("VALIGN", (0, 0), (-1, -1), "TOP"),
             ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#CBD5E1")),
             ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")])]
    for i, c in enumerate(columns):
        if c.numeric:
            style.append(("ALIGN", (i, 1), (i, -1), "RIGHT"))
    table.setStyle(TableStyle(style))
    story.append(table)
    if not rows:
        story.append(Paragraph("No records for the selected filters.", small))

    def footer(canvas, doc_):
        canvas.saveState()
        canvas.setFont("Helvetica-Oblique", 7)
        canvas.setFillColor(colors.HexColor("#64748B"))
        canvas.drawString(12 * mm, 7 * mm, f'{setting.short_name} CMIS · "Let all things be done decently and in order." 1 Cor 14:40')
        canvas.drawRightString(pagesize[0] - 12 * mm, 7 * mm, f"Page {doc_.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue(), "application/pdf", "pdf"


def _num(value):
    try:
        return f"{float(value):,.2f}"
    except (TypeError, ValueError):
        return value if value is not None else ""


RENDERERS = {"csv": render_csv, "xlsx": render_xlsx, "pdf": render_pdf}


def export_response(fmt, columns, rows, meta):
    if fmt not in RENDERERS:
        raise ValidationError({"file_format": "Choose csv, xlsx or pdf."})
    content, content_type, ext = RENDERERS[fmt](columns, rows, meta)
    response = HttpResponse(content, content_type=content_type)
    stamp = timezone.localtime().strftime("%Y%m%d-%H%M")
    response["Content-Disposition"] = f'attachment; filename="{slugify(meta.title)}-{stamp}.{ext}"'
    response["Access-Control-Expose-Headers"] = "Content-Disposition"
    return response


class ExportThrottle(UserRateThrottle):
    scope = "export"


class ExportMixin:
    """Adds ``GET …/export/?file_format=csv|xlsx|pdf`` to a scoped viewset.

    The rows are the same filtered, jurisdiction-scoped queryset the list
    endpoint returns — so an export can never contain more than the user may see.
    Requires ``<module>.export`` (or ``.print`` for PDF), is rate limited and audited.
    """

    export_columns: list = []
    export_title = "Export"

    def get_export_meta(self, queryset):
        unit_id = self.request.query_params.get("org_unit") or self.request.query_params.get("within")
        unit_name = "All units in your jurisdiction"
        if unit_id:
            from apps.organization.models import OrgUnit

            unit = OrgUnit.objects.filter(pk=unit_id).first()
            unit_name = unit.name if unit else unit_name
        start, end = self.request.query_params.get("from"), self.request.query_params.get("to")
        period = f"{start or '…'} to {end or '…'}" if (start or end) else "All dates"
        return ExportMeta(title=self.export_title, org_unit=unit_name, period=period,
                          prepared_by=self.request.user.full_name, summary=self.get_export_summary(queryset))

    def get_export_summary(self, queryset):
        return [("Records", f"{queryset.count():,}")]

    @action(detail=False, methods=["get"], throttle_classes=[ExportThrottle])
    def export(self, request):
        fmt = request.query_params.get("file_format", "xlsx")
        perm = f"{self.module}.{'print' if fmt == 'pdf' else 'export'}"
        if not scoping.has_perm_anywhere(request.user, perm):
            raise PermissionDenied(f"You do not have '{perm}' permission.")
        queryset = self.filter_queryset(self.scope(self.get_queryset(), perm))
        count = queryset.count()
        if count > MAX_EXPORT_ROWS:
            raise ValidationError(f"Too many rows ({count:,}). Narrow the filters (limit {MAX_EXPORT_ROWS:,}).")
        meta = self.get_export_meta(queryset)
        audit.record(AuditLog.Action.EXPORT, entity=self.export_title, message=f"{fmt.upper()} · {count} rows",
                     changes={"filters": dict(request.query_params)})
        return export_response(fmt, self.export_columns, list(queryset), meta)
