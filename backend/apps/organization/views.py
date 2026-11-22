from django.db import models as dj_models
from django.db.models import Count, Q
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit import services as audit
from apps.audit.models import AuditLog
from apps.core import scoping
from apps.core.exceptions import BusinessRuleError
from apps.core.views import ScopedModelViewSet

from .models import ROOT_LEVEL, OrgUnit, OrgUnitHistory, StructureLevel, member_level_codes
from .serializers import OrgUnitHistorySerializer, OrgUnitSerializer, StructureLevelSerializer

# Relations that belong to the unit itself and do not stop it being removed.
_OWN_RELATIONS = {OrgUnitHistory}


def unit_dependencies(unit):
    """Records that still point at ``unit`` (members, transactions, assets…),
    as ``[{"label": "Members", "count": 12}, …]``. Soft-deleted rows are ignored."""
    found = []
    children = OrgUnit.objects.filter(parent=unit).count()
    if children:
        found.append({"key": "children", "label": "Units below this one", "count": children})
    for rel in OrgUnit._meta.related_objects:
        model = rel.related_model
        if model is OrgUnit or model in _OWN_RELATIONS or rel.many_to_many:
            continue
        if not isinstance(rel.field, dj_models.ForeignKey):
            continue
        n = model._default_manager.filter(**{rel.field.name: unit}).count()
        if n:
            found.append({"key": f"{model._meta.label_lower}.{rel.field.name}",
                          "label": str(model._meta.verbose_name_plural).capitalize(), "count": n})
    return found


class OrgUnitViewSet(ScopedModelViewSet):
    """Church structure: headquarters, regions, districts, branches, congregations."""

    module = "org"
    serializer_class = OrgUnitSerializer
    queryset = OrgUnit.objects.select_related("parent")
    scope_path_field = "path"
    filterset_fields = ["unit_type", "status", "parent"]
    search_fields = ["name", "code", "town", "chiefdom", "civil_district"]
    ordering_fields = ["name", "code", "path", "established_on"]
    action_permissions = {"tree": "view", "history": "view", "set_status": "edit", "dependencies": "view"}

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
        """Remove a unit that was added by mistake. A unit with members, money,
        records or units below it is never removed: it is closed (deactivated)
        instead, so its history stays intact."""
        self.require("delete", instance)
        if instance.unit_type == ROOT_LEVEL:
            raise BusinessRuleError("The headquarters cannot be removed.")
        deps = unit_dependencies(instance)
        if deps:
            listed = ", ".join(f"{d['count']} {d['label'].lower()}" for d in deps)
            raise BusinessRuleError(
                f"{instance.name} still has records attached ({listed}). Close it instead to keep its history, "
                "or move those records to another unit first.", code="unit_in_use", status_code=409)
        OrgUnitHistory.objects.create(org_unit=instance, event=OrgUnitHistory.Event.REMOVED,
                                      note=self.request.query_params.get("note", ""), created_by=self.request.user)
        instance.soft_delete(self.request.user)
        audit.record(AuditLog.Action.DELETE, instance=instance)

    @action(detail=True)
    def dependencies(self, request, pk=None):
        """What is attached to the unit, so the UI can offer remove or close."""
        unit = self.get_object()
        deps = unit_dependencies(unit)
        return Response({"removable": not deps and unit.unit_type != ROOT_LEVEL, "dependencies": deps,
                         "active_children": OrgUnit.objects.filter(parent=unit, status="active").count()})

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
        if unit.unit_type == ROOT_LEVEL and new_status != "active":
            raise BusinessRuleError("The headquarters is always active.")
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
        units = OrgUnit.objects.filter(unit_type__in=member_level_codes(), status="active").select_related(
            "parent").order_by("name")
        return Response([{"id": str(u.id), "name": u.name, "code": u.code,
                          "district": u.parent.name if u.parent else ""} for u in units])


class StructureLevelViewSet(viewsets.ModelViewSet):
    """The levels of the church hierarchy. Anyone signed in can read them;
    changing them needs ``settings.edit`` (System Administrator / General Overseer)."""

    serializer_class = StructureLevelSerializer
    queryset = StructureLevel.objects.all()
    pagination_class = None
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["unit_counts"] = dict(OrgUnit.objects.values_list("unit_type").annotate(n=Count("id"))
                                  .values_list("unit_type", "n"))
        return ctx

    def check_permissions(self, request):
        super().check_permissions(request)
        if request.method not in permissions.SAFE_METHODS and not scoping.has_perm_anywhere(request.user, "settings.edit"):
            self.permission_denied(request, "Only administrators can change the church structure levels.")

    def perform_create(self, serializer):
        level = serializer.save(created_by=self.request.user, updated_by=self.request.user)
        audit.record(AuditLog.Action.CREATE, instance=level, changes=audit.diff({}, audit.snapshot(level)))

    def perform_update(self, serializer):
        before = audit.snapshot(serializer.instance)
        level = serializer.save(updated_by=self.request.user)
        changes = audit.diff(before, audit.snapshot(level))
        if changes:
            audit.record(AuditLog.Action.UPDATE, instance=level, changes=changes)

    def perform_destroy(self, instance):
        if instance.is_system:
            raise BusinessRuleError(f"{instance.name} is a system level and cannot be removed.")
        used = OrgUnit.all_objects.filter(unit_type=instance.code).count()
        if used:
            raise BusinessRuleError(f"{used} unit(s) are at the {instance.name} level. Mark the level as not in use "
                                    "instead, or move those units to another level first.", code="level_in_use",
                                    status_code=409)
        from .models import LeadershipPosition

        if LeadershipPosition.objects.filter(unit_type=instance.code).exists():
            raise BusinessRuleError("Leadership positions refer to this level. Change them first.", code="level_in_use",
                                    status_code=409)
        audit.record(AuditLog.Action.DELETE, instance=instance)
        instance.delete()
