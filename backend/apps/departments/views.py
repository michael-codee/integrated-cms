from django.db.models import Count, Q
from rest_framework import mixins, permissions, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.audit import services as audit
from apps.audit.models import AuditLog
from apps.core.views import ModulePermission, ScopedModelViewSet, ScopedViewMixin
from apps.members.filters import WithinUnitFilter

import django_filters

from .models import Department, DepartmentMember
from .serializers import DepartmentMemberSerializer, DepartmentSerializer


class DepartmentFilter(django_filters.FilterSet):
    org_unit = WithinUnitFilter()

    class Meta:
        model = Department
        fields = ["kind", "is_active"]


class DepartmentViewSet(ScopedModelViewSet):
    module = "departments"
    scope_department_field = "id"
    serializer_class = DepartmentSerializer
    filterset_class = DepartmentFilter
    search_fields = ["name", "leader_name"]
    queryset = Department.objects.select_related("org_unit", "leader")

    def get_queryset(self):
        return super().get_queryset().annotate(
            member_count=Count("memberships", filter=Q(memberships__left_on__isnull=True))).order_by("org_unit__name", "name")

    def _department_of(self, instance_or_data):
        return None if isinstance(instance_or_data, dict) else instance_or_data.pk


class DepartmentMemberViewSet(ScopedViewMixin, mixins.ListModelMixin, mixins.CreateModelMixin,
                              mixins.UpdateModelMixin, viewsets.GenericViewSet):
    module = "departments"
    scope_path_field = "department__org_unit__path"
    scope_department_field = "department_id"
    permission_classes = [permissions.IsAuthenticated, ModulePermission]
    serializer_class = DepartmentMemberSerializer
    filterset_fields = ["department", "role", "member"]
    action_permissions = {"create": "edit", "update": "edit", "partial_update": "edit", "leave": "edit"}

    def get_queryset(self):
        qs = DepartmentMember.objects.select_related("member", "department")
        if self.request.query_params.get("current", "true") != "false":
            qs = qs.filter(left_on__isnull=True)
        return self.scope(qs)

    def perform_create(self, serializer):
        obj = serializer.save(created_by=self.request.user)
        audit.record(AuditLog.Action.CREATE, instance=obj, message=f"{obj.member.full_name} joined {obj.department.name}")

    def perform_update(self, serializer):
        obj = serializer.save(updated_by=self.request.user)
        audit.record(AuditLog.Action.UPDATE, instance=obj)

    @action(detail=True, methods=["post"])
    def leave(self, request, pk=None):
        from django.utils import timezone

        obj = self.get_object()
        obj.left_on = timezone.localdate()
        obj.save(update_fields=["left_on", "updated_at"])
        audit.record(AuditLog.Action.UPDATE, instance=obj, message=f"{obj.member.full_name} left {obj.department.name}")
        return Response(self.get_serializer(obj).data)
