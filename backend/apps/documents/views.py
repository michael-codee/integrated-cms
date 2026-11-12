import django_filters
from django.db.models import Count, Q
from django.http import FileResponse
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from apps.audit import services as audit
from apps.audit.models import AuditLog
from apps.core import scoping
from apps.core.views import ScopedModelViewSet
from apps.members.filters import WithinUnitFilter

from .models import Document
from .serializers import DocumentSerializer, NewVersionSerializer, VersionSerializer, add_version, can_open


class DocumentFilter(django_filters.FilterSet):
    org_unit = WithinUnitFilter()
    expiring_before = django_filters.DateFilter(field_name="expires_on", lookup_expr="lte")

    class Meta:
        model = Document
        fields = ["category", "access", "is_archived"]


class DocumentViewSet(ScopedModelViewSet):
    module = "documents"
    serializer_class = DocumentSerializer
    filterset_class = DocumentFilter
    search_fields = ["title", "reference_no", "description", "versions__original_name"]
    ordering_fields = ["created_at", "title", "document_date", "expires_on"]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    action_permissions = {"versions": "view", "upload_version": "edit", "download": "view"}

    def get_queryset(self):
        qs = Document.objects.select_related("category", "org_unit", "created_by").annotate(
            version_count=Count("versions", distinct=True)).order_by("-created_at")
        qs = self.scope(qs)
        # Restricted documents are visible only where the user may edit documents.
        edit_q = scoping.scope_q(self.request.user, "documents.edit")
        restricted = Q(access=Document.Access.RESTRICTED)
        return qs.filter(~restricted | (restricted & edit_q)) if edit_q is not None else qs.exclude(restricted)

    def perform_create(self, serializer):
        unit = serializer.validated_data.get("org_unit")
        self.require("create", unit)
        doc = serializer.save(created_by=self.request.user, updated_by=self.request.user)
        audit.record(AuditLog.Action.CREATE, instance=doc, message=f"Uploaded {doc.current_version.original_name}")

    @action(detail=True, methods=["get"])
    def versions(self, request, pk=None):
        doc = self.get_object()
        return Response(VersionSerializer(doc.versions.select_related("created_by"), many=True).data)

    @extend_schema(request={"multipart/form-data": NewVersionSerializer})
    @action(detail=True, methods=["post"], url_path="upload-version")
    def upload_version(self, request, pk=None):
        doc = self.get_object()
        self.require("edit", doc.org_unit)
        if doc.is_archived:
            raise PermissionDenied("Archived documents cannot receive new versions.")
        s = NewVersionSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        v = add_version(doc, s.validated_data["file"], s.validated_data["notes"], request.user)
        doc.updated_by = request.user
        doc.save(update_fields=["updated_by", "updated_at"])
        audit.record(AuditLog.Action.UPDATE, instance=doc, message=f"New version {v.number}: {v.original_name}")
        return Response(VersionSerializer(v).data, status=201)

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        doc = self.get_object()
        if not can_open(request.user, doc):
            raise PermissionDenied("You may not open this document.")
        number = request.query_params.get("version")
        v = doc.versions.filter(number=number).first() if number else doc.current_version
        if v is None:
            raise NotFound("No such version.")
        audit.record(AuditLog.Action.EXPORT, instance=doc, message=f"Downloaded version {v.number} ({v.original_name})")
        response = FileResponse(v.file.open("rb"), as_attachment=True, filename=v.original_name)
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Security-Policy"] = "default-src 'none'; sandbox"
        response["Access-Control-Expose-Headers"] = "Content-Disposition"
        return response
