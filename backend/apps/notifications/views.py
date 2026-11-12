from django.db.models import Q
from django.utils import timezone
from rest_framework import mixins, permissions, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.events import publish
from apps.core.views import ScopedModelViewSet

from .models import Announcement, Notification
from .serializers import AnnouncementSerializer, NotificationSerializer


class NotificationViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """The signed-in user's own notifications."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = NotificationSerializer
    filter_backends = []

    def get_queryset(self):
        qs = Notification.objects.filter(recipient=self.request.user)
        if self.request.query_params.get("unread") == "true":
            qs = qs.filter(read_at__isnull=True)
        return qs

    @action(detail=False)
    def summary(self, request):
        qs = Notification.objects.filter(recipient=request.user, read_at__isnull=True)
        latest = NotificationSerializer(qs[:8], many=True).data
        return Response({"unread": qs.count(), "latest": latest})

    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        Notification.objects.filter(recipient=request.user, pk=pk, read_at__isnull=True).update(read_at=timezone.now())
        return Response({"ok": True})

    @action(detail=False, methods=["post"], url_path="read-all")
    def read_all(self, request):
        n = Notification.objects.filter(recipient=request.user, read_at__isnull=True).update(read_at=timezone.now())
        return Response({"marked": n})


def visible_announcements(user):
    """Announcements addressed to any unit the user belongs to, or above/below it within their reach."""
    from apps.accounts.models import RoleAssignment

    paths = {a.org_unit.path for a in RoleAssignment.objects.current().filter(user=user).select_related("org_unit")}
    if not paths:
        return Announcement.objects.none()
    q = Q()
    for p in paths:
        # addressed to my unit or an ancestor (audience includes me) …
        ancestors = [p[: 1 + 33 * k] for k in range(1, len(p) // 33 + 1)]
        q |= Q(org_unit__path__in=ancestors)
        # … or to a unit inside my jurisdiction (overseers see what their branches were told)
        q |= Q(org_unit__path__startswith=p)
    now = timezone.now()
    return Announcement.objects.filter(q, publish_at__lte=now).filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))


class AnnouncementViewSet(ScopedModelViewSet):
    module = "notifications"
    serializer_class = AnnouncementSerializer
    queryset = Announcement.objects.select_related("org_unit", "created_by")
    filterset_fields = ["priority", "org_unit"]
    search_fields = ["title", "body"]
    # Whoever may publish at a unit may also correct or withdraw announcements there.
    action_permissions = {"list": None, "retrieve": None, "update": "create", "partial_update": "create",
                          "destroy": "create"}

    def require(self, action, org_unit, department_id=None):
        super().require("create", org_unit, department_id)

    def get_queryset(self):
        if self.action in ("list", "retrieve") and self.request.query_params.get("manage") != "true":
            return visible_announcements(self.request.user).select_related("org_unit", "created_by")
        return self.scope(Announcement.objects.select_related("org_unit", "created_by"), "notifications.create")

    def after_create(self, instance):
        if instance.priority != Announcement.Priority.NORMAL:
            publish("announcement.published", org_unit=instance.org_unit, actor=self.request.user,
                    title=f"{instance.get_priority_display()}: {instance.title}", body=instance.body[:300],
                    link="/announcements", notify_perm="dashboard.view", data={"audience_subtree": True})

