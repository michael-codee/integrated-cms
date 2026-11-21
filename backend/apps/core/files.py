"""
Uploaded files (member photos, finance supporting documents, asset documents, the logo)
are never served directly by the web server. Serializers return a short-lived signed
link instead; the link is only issued to someone allowed to see the record, and it
stops working after ``FILE_URL_MAX_AGE`` seconds.
"""
import mimetypes
import time

from django.conf import settings
from django.core import signing
from django.core.files.storage import default_storage
from django.db import models
from django.http import FileResponse, Http404
from django.urls import reverse
from django.views.decorators.http import require_GET
from rest_framework import serializers

SALT = "cmis.files"
INLINE_TYPES = {"image/png", "image/jpeg", "image/webp", "application/pdf"}


def signed_url(name, request=None, max_age=None):
    if not name:
        return None
    expires = int(time.time()) + (max_age or settings.FILE_URL_MAX_AGE)
    token = signing.dumps({"n": name, "e": expires}, salt=SALT, compress=True)
    # Root-relative on purpose: the app and the API share one address everywhere (Docker, Vercel,
    # Codespaces), and an absolute link would carry http:// when TLS ends at a proxy in front.
    return reverse("signed-file", args=[token])


class SignedFileField(serializers.FileField):
    def to_representation(self, value):
        if not value:
            return None
        return signed_url(value.name, self.context.get("request"))


class SignedImageField(serializers.ImageField):
    def to_representation(self, value):
        if not value:
            return None
        return signed_url(value.name, self.context.get("request"))


class SignedFilesMixin:
    """ModelSerializer mixin: file fields on the default storage are returned as signed links."""

    serializer_field_mapping = {
        **serializers.ModelSerializer.serializer_field_mapping,
        models.FileField: SignedFileField,
        models.ImageField: SignedImageField,
    }


@require_GET
def serve_signed_file(request, token):
    try:
        data = signing.loads(token, salt=SALT)
    except signing.BadSignature:
        raise Http404
    name = data.get("n") or ""
    if data.get("e", 0) < time.time() or name.startswith(("/", "..")) or "/../" in name:
        raise Http404
    if not default_storage.exists(name):
        raise Http404
    content_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
    inline = content_type in INLINE_TYPES
    response = FileResponse(default_storage.open(name, "rb"), content_type=content_type,
                            as_attachment=not inline, filename=name.rsplit("/", 1)[-1])
    response["Cache-Control"] = "private, max-age=600"
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Security-Policy"] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"
    response["Cross-Origin-Resource-Policy"] = "same-origin"
    return response
