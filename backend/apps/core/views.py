"""Base API views that apply jurisdiction scoping, permissions and auditing."""
from rest_framework import permissions, status, viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.audit import services as audit
from apps.audit.models import AuditLog

from . import scoping

DEFAULT_ACTION_MAP = {
    "list": "view",
    "retrieve": "view",
    "create": "create",
    "update": "edit",
    "partial_update": "edit",
    "destroy": "delete",
    "metadata": "view",
}


class ModulePermission(permissions.BasePermission):
    """User must hold ``<module>.<action>`` somewhere. Object scope is enforced
    by the scoped queryset and the per-object checks in ``ScopedModelViewSet``."""

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        perm = view.get_required_permission()
        if perm is None:
            return True
        return scoping.has_perm_anywhere(request.user, perm)


class ScopedViewMixin:
    module: str = None
    action_permissions: dict = {}
    scope_path_field = "org_unit__path"
    scope_department_field = None

    def get_required_action(self):
        mapping = {**DEFAULT_ACTION_MAP, **self.action_permissions}
        return mapping.get(self.action, "view")

    def get_required_permission(self):
        if not self.module:
            return None
        action = self.get_required_action()
        return f"{self.module}.{action}" if action else None

    def scope(self, queryset, perm=None):
        return scoping.filter_queryset(
            queryset,
            self.request.user,
            perm or f"{self.module}.view",
            self.scope_path_field,
            self.scope_department_field,
        )

    def require(self, action, org_unit, department_id=None):
        perm = f"{self.module}.{action}"
        if not scoping.can(self.request.user, perm, org_unit, department_id):
            raise PermissionDenied(f"You do not have '{perm}' permission for {getattr(org_unit, 'name', 'this unit')}.")


class ScopedModelViewSet(ScopedViewMixin, viewsets.ModelViewSet):
    """CRUD viewset with jurisdiction filtering, write checks, soft delete and audit."""

    permission_classes = [permissions.IsAuthenticated, ModulePermission]
    org_unit_field = "org_unit"

    def get_queryset(self):
        return self.scope(super().get_queryset())

    def _unit_of(self, instance_or_data):
        if isinstance(instance_or_data, dict):
            return instance_or_data.get(self.org_unit_field)
        return getattr(instance_or_data, self.org_unit_field, None)

    def _department_of(self, instance_or_data):
        field = self.scope_department_field
        if not field:
            return None
        attr = field.replace("__", "_") if field.endswith("_id") else f"{field}_id"
        if isinstance(instance_or_data, dict):
            value = instance_or_data.get(field)
            return getattr(value, "pk", value)
        return getattr(instance_or_data, attr, None)

    def update(self, request, *args, **kwargs):
        conflict = self.check_version(request)
        if conflict is not None:
            return conflict
        return super().update(request, *args, **kwargs)

    def check_version(self, request):
        """Optimistic concurrency: an ``If-Match: <version>`` header that no longer
        matches the stored version means someone else changed the record since
        the client last saw it. Nothing is overwritten; the conflict is recorded
        for the Sync Centre and the server copy is returned."""
        header = request.META.get("HTTP_IF_MATCH", "").strip().strip('"').removeprefix("W/").strip('"')
        if not header:
            return None
        instance = self.get_object()
        current = getattr(instance, "version", None)
        if current is None:
            return None
        try:
            base = int(header)
        except ValueError as exc:
            raise ValidationError({"detail": "If-Match must be the record version number."}) from exc
        if base == current:
            return None
        from apps.sync.services import record_conflict

        server = self.get_serializer(instance).data
        conflict = record_conflict(
            request, entity=self.basename or self.module, instance=instance, payload=dict(request.data),
            base_version=base, server_data=server,
            reason=f"Changed by someone else (version {base} on the device, {current} on the server).")
        return Response({"detail": "This record was changed by someone else after you last loaded it. "
                                   "Nothing was overwritten. Review both versions in the Sync Centre.",
                         "code": "version_conflict", "conflict": conflict.pk, "server": server},
                        status=status.HTTP_409_CONFLICT)

    def perform_create(self, serializer):
        unit = self._unit_of(serializer.validated_data)
        self.require("create", unit, self._department_of(serializer.validated_data))
        extra = {"created_by": self.request.user, "updated_by": self.request.user}
        device = self.request.META.get("HTTP_X_DEVICE_ID")
        if device and hasattr(serializer.Meta.model, "device_id"):
            extra["device_id"] = device[:64]
        instance = serializer.save(**extra)
        audit.record(AuditLog.Action.CREATE, instance=instance, changes=audit.diff({}, audit.snapshot(instance)))
        self.after_create(instance)

    def after_create(self, instance):
        pass

    def perform_update(self, serializer):
        instance = serializer.instance
        self.require("edit", self._unit_of(instance), self._department_of(instance))
        new_unit = self._unit_of(serializer.validated_data)
        if new_unit is not None and new_unit != self._unit_of(instance):
            self.require("edit", new_unit)
        self.check_editable(instance)
        before = audit.snapshot(instance)
        instance = serializer.save(updated_by=self.request.user)
        changes = audit.diff(before, audit.snapshot(instance))
        if changes:
            audit.record(AuditLog.Action.UPDATE, instance=instance, changes=changes)

    def check_editable(self, instance):
        """Hook for modules that lock records (e.g. approved transactions)."""

    def perform_destroy(self, instance):
        self.require("delete", self._unit_of(instance), self._department_of(instance))
        self.check_editable(instance)
        if hasattr(instance, "soft_delete"):
            instance.soft_delete(self.request.user)
        else:
            instance.delete()
        audit.record(AuditLog.Action.DELETE, instance=instance)
