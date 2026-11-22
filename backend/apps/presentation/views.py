import django_filters
from rest_framework import permissions, viewsets

from apps.audit import services as audit
from apps.audit.models import AuditLog
from apps.core.views import ModulePermission, ScopedModelViewSet, ScopedViewMixin
from apps.members.filters import WithinUnitFilter

from .models import MediaImage, ServicePlan, Song
from .serializers import MediaImageSerializer, ServicePlanSerializer, SongListSerializer, SongSerializer


class LibraryViewSet(ScopedViewMixin, viewsets.ModelViewSet):
    """Church-wide libraries (songs, pictures): anyone holding ``media.<action>`` in any unit may use them."""

    module = "media"
    permission_classes = [permissions.IsAuthenticated, ModulePermission]

    def perform_create(self, serializer):
        obj = serializer.save(created_by=self.request.user, updated_by=self.request.user)
        audit.record(AuditLog.Action.CREATE, instance=obj, changes=audit.diff({}, audit.snapshot(obj)))

    def perform_update(self, serializer):
        before = audit.snapshot(serializer.instance)
        obj = serializer.save(updated_by=self.request.user)
        changes = audit.diff(before, audit.snapshot(obj))
        if changes:
            audit.record(AuditLog.Action.UPDATE, instance=obj, changes=changes)

    def perform_destroy(self, instance):
        instance.soft_delete(self.request.user)
        audit.record(AuditLog.Action.DELETE, instance=instance)


class SongViewSet(LibraryViewSet):
    queryset = Song.objects.all()
    filterset_fields = ["language"]
    search_fields = ["title", "alternate_title", "author", "tags", "lyrics"]

    def get_serializer_class(self):
        return SongListSerializer if self.action == "list" else SongSerializer


class MediaImageViewSet(LibraryViewSet):
    queryset = MediaImage.objects.all()
    serializer_class = MediaImageSerializer
    filterset_fields = ["kind"]
    search_fields = ["title"]


class ServicePlanFilter(django_filters.FilterSet):
    org_unit = WithinUnitFilter()
    date_from = django_filters.DateFilter(field_name="service_date", lookup_expr="gte")
    date_to = django_filters.DateFilter(field_name="service_date", lookup_expr="lte")

    class Meta:
        model = ServicePlan
        fields = ["service_type"]


class ServicePlanViewSet(ScopedModelViewSet):
    module = "media"
    serializer_class = ServicePlanSerializer
    filterset_class = ServicePlanFilter
    search_fields = ["title"]
    queryset = ServicePlan.objects.select_related("org_unit", "service_type")
