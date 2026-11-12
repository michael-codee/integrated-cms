import datetime

from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core import scoping
from apps.organization.models import OrgUnit

from .sections import SECTIONS, Context


def _date(value, name):
    if not value:
        return None
    try:
        return datetime.date.fromisoformat(value)
    except ValueError:
        raise ValidationError({name: "Use YYYY-MM-DD."})


class DashboardView(APIView):
    """Role-adaptive executive dashboard. Every figure comes from live queries
    restricted to the caller's jurisdiction (and the optional filters)."""

    def get(self, request):
        if not scoping.has_perm_anywhere(request.user, "dashboard.view"):
            return Response({"detail": "You do not have access to the dashboard."}, status=403)
        p = request.query_params
        unit = None
        if p.get("org_unit"):
            unit = OrgUnit.objects.filter(pk=p["org_unit"]).first()
            if unit is None or not (scoping.can(request.user, "dashboard.view", unit)
                                    or scoping.can(request.user, "org.view", unit)):
                return Response({"detail": "That unit is outside your jurisdiction."}, status=403)
        fy = None
        if p.get("financial_year"):
            from apps.configuration.models import FinancialYear

            fy = FinancialYear.objects.filter(pk=p["financial_year"]).first()
        ctx = Context(unit=unit, date_from=_date(p.get("from"), "from"), date_to=_date(p.get("to"), "to"),
                      financial_year=fy, department=p.get("department") or None)
        if fy and not ctx.date_from:
            ctx.date_from, ctx.date_to = fy.start_date, fy.end_date
        wanted = set(filter(None, (p.get("sections") or "").split(",")))
        data = {"generated_at": datetime.datetime.now().isoformat(), "scope": self._scope(request.user, unit)}
        for key, perm, fn in SECTIONS:
            if wanted and key not in wanted:
                continue
            if scoping.has_perm_anywhere(request.user, perm):
                data[key] = fn(request.user, ctx)
        return Response(data)

    def _scope(self, user, unit):
        roots = scoping.root_scope_units(user, "dashboard.view")
        return {
            "filtered_unit": {"id": str(unit.id), "name": unit.name, "unit_type": unit.unit_type} if unit else None,
            "jurisdiction": [{"id": str(u.id), "name": u.name, "unit_type": u.unit_type} for u in roots],
        }
