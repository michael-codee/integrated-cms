"""Documents & records: minutes, constitutions, title deeds, certificates, letters…

Files are kept in *private* storage (never under the public media URL) and are
only ever served through the API after a permission check, with the download
audited. Each upload is a new immutable version; earlier versions remain
available, so a record's history can always be shown.
"""
import hashlib

from django.core.files.storage import storages
from django.db import models
from django.utils.functional import LazyObject

from apps.core.models import BaseModel, SoftDeleteModel
from apps.core.uploads import RandomName, document_validator


class PrivateStorage(LazyObject):
    """The "private" storage: a folder outside the web root, or a private object-storage bucket."""

    def _setup(self):
        self._wrapped = storages["private"]


private_storage = PrivateStorage()


def _private_storage():
    return private_storage


class Document(SoftDeleteModel):
    class Access(models.TextChoices):
        INTERNAL = "internal", "Internal — anyone with access to documents of the unit"
        RESTRICTED = "restricted", "Restricted — only those who may edit documents of the unit"

    title = models.CharField(max_length=200)
    category = models.ForeignKey("configuration.DocumentCategory", on_delete=models.PROTECT, related_name="documents")
    org_unit = models.ForeignKey("organization.OrgUnit", on_delete=models.PROTECT, related_name="documents")
    description = models.TextField(blank=True, default="")
    reference_no = models.CharField(max_length=80, blank=True, default="")
    document_date = models.DateField(null=True, blank=True)
    access = models.CharField(max_length=10, choices=Access.choices, default=Access.INTERNAL)
    expires_on = models.DateField(null=True, blank=True, help_text="e.g. certificate or lease expiry")
    is_archived = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["org_unit", "category"])]

    def __str__(self):
        return self.title

    @property
    def current_version(self):
        return self.versions.order_by("-number").first()


class DocumentVersion(BaseModel):
    document = models.ForeignKey(Document, on_delete=models.PROTECT, related_name="versions")
    number = models.PositiveIntegerField()
    file = models.FileField(upload_to=RandomName("documents"), storage=_private_storage, validators=[document_validator],
                            max_length=200)
    original_name = models.CharField(max_length=200)
    size = models.PositiveIntegerField(default=0)
    sha256 = models.CharField(max_length=64)
    notes = models.CharField(max_length=300, blank=True, default="")

    class Meta:
        ordering = ["-number"]
        constraints = [models.UniqueConstraint(fields=["document", "number"], name="document_version_unique")]

    def __str__(self):
        return f"{self.document.title} v{self.number}"


def file_digest(f):
    h = hashlib.sha256()
    for chunk in f.chunks():
        h.update(chunk)
    f.seek(0)
    return h.hexdigest()
