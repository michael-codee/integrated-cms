import datetime

import django_filters
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core import scoping
from apps.core.exports import Column, ExportMixin
from apps.core.views import ScopedModelViewSet
from apps.members.filters import WithinUnitFilter
from apps.organization.models import OrgUnit

from .models import AttendanceRecord
from .serializers import AttendanceSerializer
from .stats import attendance_stats


class AttendanceFilter(django_filters.FilterSet):
    org_unit = WithinUnitFilter()
    date_from = django_filters.DateFilter(field_name="date", lookup_expr="gte")
    date_to = django_filters.DateFilter(field_name="date", lookup_expr="lte")

    class Meta:
        model = AttendanceRecord
        fields = ["service_type", "program", "department", "date"]


class AttendanceViewSet(ExportMixin, ScopedModelViewSet):
    module = "attendance"
    scope_department_field = "department_id"
    serializer_class = AttendanceSerializer
    filterset_class = AttendanceFilter
    ordering_fields = ["date"]
    queryset = AttendanceRecord.objects.select_related("org_unit", "service_type", "program", "department",
                                                       "created_by").prefetch_related("entries")
    action_permissions = {"export": None}
    export_title = "Attendance records"
    export_columns = [
        Column("date", "Date", 11), Column("org_unit.name", "Unit", 22), Column("service_type.name", "Service", 18),
        Column("men", "Men", 7, numeric=True), Column("women", "Women", 7, numeric=True),
        Column("children", "Children", 8, numeric=True), Column("youth", "Youth", 7, numeric=True),
        Column("young_adults", "Young adults", 8, numeric=True),
        Column("male", "Male", 7, numeric=True), Column("female", "Female", 7, numeric=True),
        Column("total", "Total", 8, numeric=True), Column("visitors", "Visitors", 8, numeric=True),
        Column("first_timers", "First timers", 9, numeric=True), Column("new_converts", "Converts", 8, numeric=True),
    ]

    def _department_of(self, instance_or_data):
        if isinstance(instance_or_data, dict):
            d = instance_or_data.get("department")
            return getattr(d, "pk", d)
        return instance_or_data.department_id


class AttendanceStatsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        if not scoping.has_perm_anywhere(request.user, "attendance.view"):
            raise PermissionDenied("You do not have access to attendance.")
        unit = None
        if request.query_params.get("org_unit"):
            unit = OrgUnit.objects.filter(pk=request.query_params["org_unit"]).first()
            if unit is None or not scoping.can(request.user, "attendance.view", unit):
                raise PermissionDenied("That unit is outside your jurisdiction.")
        try:
            start = request.query_params.get("from")
            end = request.query_params.get("to")
            start = datetime.date.fromisoformat(start) if start else None
            end = datetime.date.fromisoformat(end) if end else None
        except ValueError as exc:
            raise ValidationError({"detail": "Dates must be YYYY-MM-DD."}) from exc
        return Response(attendance_stats(request.user, unit, start, end))
