import os

from django.db import transaction
from rest_framework import serializers

from apps.core import scoping

from .models import Document, DocumentVersion, file_digest
from apps.core.uploads import document_validator


class VersionSerializer(serializers.ModelSerializer):
    uploaded_by = serializers.CharField(source="created_by.full_name", read_only=True, default=None)

    class Meta:
        model = DocumentVersion
        fields = ["id", "number", "original_name", "size", "sha256", "notes", "uploaded_by", "created_at"]


class DocumentSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True)
    org_unit_name = serializers.CharField(source="org_unit.name", read_only=True)
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True, default=None)
    latest = serializers.SerializerMethodField()
    version_count = serializers.IntegerField(read_only=True)
    file = serializers.FileField(write_only=True, required=False, validators=[document_validator])
    notes = serializers.CharField(write_only=True, required=False, allow_blank=True, max_length=300)

    class Meta:
        model = Document
        fields = ["id", "title", "category", "category_name", "org_unit", "org_unit_name", "description", "reference_no",
                  "document_date", "access", "expires_on", "is_archived", "created_by_name", "created_at", "updated_at",
                  "latest", "version_count", "file", "notes"]
        read_only_fields = ["created_at", "updated_at"]

    def get_latest(self, obj):
        v = getattr(obj, "_latest", None) or obj.current_version
        return VersionSerializer(v).data if v else None

    def validate(self, attrs):
        if self.instance is None and not attrs.get("file"):
            raise serializers.ValidationError({"file": "Attach the document."})
        if self.instance is not None and "org_unit" in attrs and attrs["org_unit"] != self.instance.org_unit:
            raise serializers.ValidationError({"org_unit": "A document cannot move to another unit."})
        if self.instance is not None and attrs.get("file"):
            raise serializers.ValidationError({"file": "Upload a new version instead."})
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        f = validated_data.pop("file")
        notes = validated_data.pop("notes", "")
        doc = super().create(validated_data)
        add_version(doc, f, notes, validated_data.get("created_by"))
        return doc

    def update(self, instance, validated_data):
        validated_data.pop("notes", None)
        return super().update(instance, validated_data)


def add_version(doc, f, notes, user):
    last = DocumentVersion.objects.select_for_update().filter(document=doc).order_by("-number").first() \
        if doc.pk else None
    v = DocumentVersion(document=doc, number=(last.number + 1) if last else 1,
                        original_name=os.path.basename(f.name)[:200], size=f.size, sha256=file_digest(f),
                        notes=notes or "", created_by=user, updated_by=user)
    v.file.save(f.name, f, save=False)
    v.save()
    return v


class NewVersionSerializer(serializers.Serializer):
    file = serializers.FileField(validators=[document_validator])
    notes = serializers.CharField(required=False, allow_blank=True, max_length=300, default="")


def can_open(user, doc):
    perm = "documents.edit" if doc.access == Document.Access.RESTRICTED else "documents.view"
    return scoping.can(user, perm, doc.org_unit)
