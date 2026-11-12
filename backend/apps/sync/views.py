from django.db.models import Q
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, permissions, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit import services as audit
from apps.audit.models import AuditLog
from apps.core import scoping

from . import feed
from .models import Device, SyncConflict
from .serializers import ConflictSerializer, DeviceSerializer, ResolveSerializer


def touch_device(request, synced=False):
    device_id = request.META.get("HTTP_X_DEVICE_ID", "")[:64]
    if not device_id:
        return None
    now = timezone.now()
    device, created = Device.objects.get_or_create(
        user=request.user, device_id=device_id,
        defaults={"user_agent": request.META.get("HTTP_USER_AGENT", "")[:300]})
    device.last_seen = now
    fields = ["last_seen"]
    if synced:
        device.last_sync_at = now
        fields.append("last_sync_at")
    device.save(update_fields=fields)
    return device


class PullView(APIView):
    """``GET /api/sync/pull/?entity=members&cursor=0&limit=500`` — records changed since ``cursor``.

    Returns changed records (``results``), deleted ids (``deleted``), the next
    ``cursor`` and whether ``more`` pages remain. Entities the user cannot see
    return ``{"skipped": true}``."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        entity = request.query_params.get("entity")
        if entity not in feed.ENTITY_NAMES:
            raise ValidationError({"entity": f"Choose one of: {', '.join(feed.ENTITY_NAMES)}."})
        try:
            cursor = max(0, int(request.query_params.get("cursor", 0)))
            limit = min(1000, max(1, int(request.query_params.get("limit", 500))))
        except ValueError as exc:
            raise ValidationError({"cursor": "cursor and limit must be numbers."}) from exc
        data = feed.pull(request, entity, cursor, limit)
        if data is None:
            return Response({"entity": entity, "skipped": True, "results": [], "deleted": [], "cursor": cursor,
                             "more": False})
        if not data["more"]:
            touch_device(request, synced=True)
        return Response(data)


class StatusView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        touch_device(request)
        return Response({
            "server_time": timezone.now(),
            "entities": feed.ENTITY_NAMES,
            "open_conflicts": conflicts_for(request.user).filter(status="open").count(),
            "devices": DeviceSerializer(request.user.devices.all()[:20], many=True).data,
        })


def conflicts_for(user):
    """Own conflicts, plus those in units where the user may oversee synchronisation."""
    q = Q(user=user)
    scoped = scoping.scope_q(user, "sync.approve")
    if scoped is not None:
        q |= scoped
    return SyncConflict.objects.filter(q).select_related("user", "resolved_by", "org_unit")


class ConflictViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = ConflictSerializer
    filterset_fields = ["status", "entity"]

    def get_queryset(self):
        return conflicts_for(self.request.user)

    @extend_schema(request=ResolveSerializer)
    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        conflict = self.get_object()
        if conflict.status == SyncConflict.Status.RESOLVED:
            raise ValidationError({"detail": "This conflict has already been resolved."})
        if conflict.user_id != request.user.pk and not (
                conflict.org_unit and scoping.can(request.user, "sync.approve", conflict.org_unit)):
            raise PermissionDenied("Only the person who made the change can resolve this conflict.")
        s = ResolveSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        conflict.status = SyncConflict.Status.RESOLVED
        conflict.resolution = s.validated_data["resolution"]
        conflict.resolved_by, conflict.resolved_at = request.user, timezone.now()
        conflict.save()
        audit.record(AuditLog.Action.UPDATE, instance=conflict,
                     message=f"Sync conflict on {conflict.entity} {conflict.label}: {conflict.get_resolution_display()}. "
                             f"{s.validated_data['note']}".strip())
        return Response(ConflictSerializer(conflict).data)


class DeviceViewSet(mixins.ListModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = DeviceSerializer
    filter_backends = []

    def get_queryset(self):
        return Device.objects.filter(user=self.request.user)
