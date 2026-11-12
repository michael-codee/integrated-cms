from django.db.models import Q
from rest_framework import permissions, serializers, viewsets

from apps.core import scoping
from apps.core.views import ModulePermission, ScopedViewMixin
from apps.organization.models import OrgUnit

from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLog
        fields = ["id", "at", "actor", "actor_name", "action", "entity", "entity_id", "entity_label", "org_unit",
                  "changes", "message", "ip_address", "user_agent", "device_id"]


class AuditLogViewSet(ScopedViewMixin, viewsets.ReadOnlyModelViewSet):
    module = "audit"
    serializer_class = AuditLogSerializer
    permission_classes = [permissions.IsAuthenticated, ModulePermission]
    filterset_fields = ["action", "entity", "entity_id", "actor", "org_unit"]
    search_fields = ["actor_name", "entity_label", "message"]
    ordering_fields = ["at"]

    def get_queryset(self):
        user = self.request.user
        q = scoping.scope_q(user, "audit.view", "org_path")
        if q is None:
            return AuditLog.objects.none()
        hq = OrgUnit.objects.filter(unit_type="headquarters").first()
        if hq and scoping.can(user, "audit.view", hq):
            q |= Q(org_path="")
        qs = AuditLog.objects.filter(q)
        start, end = self.request.query_params.get("from"), self.request.query_params.get("to")
        if start:
            qs = qs.filter(at__date__gte=start)
        if end:
            qs = qs.filter(at__date__lte=end)
        return qs
