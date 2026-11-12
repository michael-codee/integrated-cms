from django.db.models import Count, Q
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit import services as audit
from apps.audit.models import AuditLog
from apps.core import scoping
from apps.core.views import ScopedModelViewSet

from .models import OrgUnit, OrgUnitHistory
from .serializers import OrgUnitHistorySerializer, OrgUnitSerializer


class OrgUnitViewSet(ScopedModelViewSet):
    """Church structure: headquarters, regions, districts, branches, congregations."""

    module = "org"
    serializer_class = OrgUnitSerializer
    queryset = OrgUnit.objects.select_related("parent")
    scope_path_field = "path"
    filterset_fields = ["unit_type", "status", "parent"]
    search_fields = ["name", "code", "town", "chiefdom", "civil_district"]
    ordering_fields = ["name", "code", "path", "established_on"]
    action_permissions = {"tree": "view", "history": "view", "set_status": "edit"}

    def get_queryset(self):
        qs = super().get_queryset().annotate(_children_count=Count("children", filter=Q(children__is_deleted=False))).order_by("depth", "name")
        within = self.request.query_params.get("within")
        if within:
            unit = OrgUnit.objects.filter(pk=within).first()
            qs = qs.filter(path__startswith=unit.path) if unit else qs.none()
        return qs

    def perform_create(self, serializer):
        parent = serializer.validated_data.get("parent")
        if parent is None:
            # Only an organisation-wide administrator may create a headquarters.
            if not scoping.has_perm_anywhere(self.request.user, "org.create") or OrgUnit.objects.exists():
                self.permission_denied(self.request, "Headquarters already exists.")
        else:
            self.require("create", parent)
        unit = serializer.save(created_by=self.request.user, updated_by=self.request.user)
        OrgUnitHistory.objects.create(org_unit=unit, event=OrgUnitHistory.Event.CREATED, created_by=self.request.user,
                                      changes={"name": unit.name, "parent": str(unit.parent_id)})
        audit.record(AuditLog.Action.CREATE, instance=unit, changes=audit.diff({}, audit.snapshot(unit)))

    def perform_update(self, serializer):
        unit = serializer.instance
        self.require("edit", unit)
        new_parent = serializer.validated_data.get("parent", unit.parent)
        moved = new_parent != unit.parent
        if moved:
            self.require("edit", new_parent)
        before = audit.snapshot(unit)
        unit = serializer.save(updated_by=self.request.user)
        changes = audit.diff(before, audit.snapshot(unit))
        if changes:
            OrgUnitHistory.objects.create(
                org_unit=unit,
                event=OrgUnitHistory.Event.MOVED if moved else OrgUnitHistory.Event.UPDATED,
                changes=changes,
                created_by=self.request.user,
            )
            audit.record(AuditLog.Action.UPDATE, instance=unit, changes=changes)

    def perform_destroy(self, instance):
        self.require("delete", instance)
        if instance.children.exists():
            self.permission_denied(self.request, "Remove or move the units under this one first.")
        super().perform_destroy(instance)

    @action(detail=False)
    def tree(self, request):
        """Nested tree of the units visible to the user."""
        units = list(self.get_queryset().order_by("depth", "name"))
        nodes = {u.id: {"id": str(u.id), "code": u.code, "name": u.name, "unit_type": u.unit_type,
                        "status": u.status, "town": u.town, "latitude": u.latitude, "longitude": u.longitude,
                        "children": []} for u in units}
        roots = []
        for u in units:
            if u.parent_id in nodes:
                nodes[u.parent_id]["children"].append(nodes[u.id])
            else:
                roots.append(nodes[u.id])
        return Response(roots)

    @action(detail=True)
    def history(self, request, pk=None):
        unit = self.get_object()
        return Response(OrgUnitHistorySerializer(unit.history.select_related("created_by"), many=True).data)

    @action(detail=True, methods=["post"], url_path="status")
    def set_status(self, request, pk=None):
        unit = self.get_object()
        self.require("edit", unit)
        new_status = request.data.get("status")
        if new_status not in OrgUnit.Status.values:
            return Response({"status": ["Invalid status."]}, status=status.HTTP_400_BAD_REQUEST)
        old = unit.status
        unit.status = new_status
        unit.updated_by = request.user
        unit.save()
        event = OrgUnitHistory.Event.ACTIVATED if new_status == "active" else OrgUnitHistory.Event.DEACTIVATED
        OrgUnitHistory.objects.create(org_unit=unit, event=event, changes={"status": [old, new_status]},
                                      note=request.data.get("note", ""), created_by=request.user)
        audit.record(AuditLog.Action.STATUS_CHANGE, instance=unit, changes={"status": [old, new_status]})
        return Response(OrgUnitSerializer(unit, context={"request": request}).data)


class BranchDirectoryView(APIView):
    """Names of all active branches/congregations (no other details), so an
    officer can choose a receiving branch for a transfer or a program."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        units = OrgUnit.objects.filter(unit_type__in=["branch", "congregation"], status="active").select_related(
            "parent").order_by("name")
        return Response([{"id": str(u.id), "name": u.name, "code": u.code,
                          "district": u.parent.name if u.parent else ""} for u in units])
