from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit import services as audit
from apps.audit.models import AuditLog
from apps.core import scoping
from apps.core.views import ModulePermission, ScopedViewMixin

from .models import Currency, FinancialYear, SystemSetting
from .serializers import (LOOKUPS, CurrencySerializer, FinancialYearSerializer, PublicSettingSerializer,
                          SystemSettingSerializer, lookup_serializer)


class SettingsWriteMixin(ScopedViewMixin):
    """Anyone signed in can read configuration; changes need ``settings.edit``."""

    module = "settings"
    permission_classes = [permissions.IsAuthenticated, ModulePermission]

    def get_required_permission(self):
        if self.action in ("list", "retrieve", "public", None) and self.request.method in permissions.SAFE_METHODS:
            return None
        return super().get_required_permission()

    def perform_create(self, serializer):
        obj = serializer.save()
        audit.record(AuditLog.Action.CREATE, instance=obj)

    def perform_update(self, serializer):
        before = audit.snapshot(serializer.instance)
        obj = serializer.save()
        audit.record(AuditLog.Action.UPDATE, instance=obj, changes=audit.diff(before, audit.snapshot(obj)))

    def perform_destroy(self, instance):
        audit.record(AuditLog.Action.DELETE, instance=instance)
        if hasattr(instance, "soft_delete"):
            instance.soft_delete(self.request.user)
        else:
            instance.delete()


class SystemSettingView(APIView):
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_permissions(self):
        return [permissions.IsAuthenticated()]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(SystemSettingSerializer(SystemSetting.get(), context={"request": request}).data)

    def patch(self, request):
        if not scoping.has_perm_anywhere(request.user, "settings.edit"):
            return Response({"detail": "You do not have permission to change system settings."}, status=403)
        obj = SystemSetting.get()
        before = audit.snapshot(obj)
        serializer = SystemSettingSerializer(obj, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        obj = serializer.save(updated_by=request.user)
        audit.record(AuditLog.Action.UPDATE, instance=obj, changes=audit.diff(before, audit.snapshot(obj)))
        return Response(serializer.data)


class PublicSettingView(APIView):
    """Branding for the login page (no sensitive data)."""

    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(PublicSettingSerializer(SystemSetting.get(), context={"request": request}).data)


class CurrencyViewSet(SettingsWriteMixin, viewsets.ModelViewSet):
    serializer_class = CurrencySerializer
    queryset = Currency.objects.all()
    pagination_class = None


class FinancialYearViewSet(SettingsWriteMixin, viewsets.ModelViewSet):
    serializer_class = FinancialYearSerializer
    queryset = FinancialYear.objects.all()
    pagination_class = None
    action_permissions = {"current": "view"}

    @action(detail=False)
    def current(self, request):
        from django.utils import timezone

        return Response(FinancialYearSerializer(FinancialYear.for_date(timezone.localdate())).data)


def make_lookup_viewset(model_cls, extra):
    class _V(SettingsWriteMixin, viewsets.ModelViewSet):
        serializer_class = lookup_serializer(model_cls, extra)
        queryset = model_cls.objects.all()
        pagination_class = None
        filterset_fields = ["is_active"] + (["kind"] if "kind" in extra else [])
        search_fields = ["name", "code"]

    _V.__name__ = f"{model_cls.__name__}ViewSet"
    return _V


LOOKUP_VIEWSETS = {prefix: make_lookup_viewset(m, extra) for prefix, (m, extra) in LOOKUPS.items()}
