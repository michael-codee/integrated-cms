"""
Upload safety for every file field.

* Extension allow-list (``ALLOWED_UPLOAD_EXTENSIONS``) per field kind.
* Size limit (``MAX_UPLOAD_MB``; images 5 MB).
* Content signature check, so a renamed executable or HTML file is refused.
* Random server-side file names: user-supplied names never reach the disk.

Files are served from MEDIA with ``Content-Disposition`` set by the web server
configuration (see docs/DEPLOYMENT.md); SVG and HTML are never accepted.
"""
import os
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.utils import timezone
from django.utils.deconstruct import deconstructible

IMAGE_EXT = {"png", "jpg", "jpeg", "webp"}
DOCUMENT_EXT = {"pdf", "png", "jpg", "jpeg", "webp", "doc", "docx", "xls", "xlsx", "csv", "txt"}

SIGNATURES = {
    "png": [b"\x89PNG\r\n\x1a\n"],
    "jpg": [b"\xff\xd8\xff"],
    "jpeg": [b"\xff\xd8\xff"],
    "webp": [b"RIFF"],
    "pdf": [b"%PDF-"],
    "docx": [b"PK\x03\x04"],
    "xlsx": [b"PK\x03\x04"],
    "doc": [b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"],
    "xls": [b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"],
}
TEXT_EXT = {"csv", "txt"}


def _ext(name):
    return os.path.splitext(name or "")[1].lower().lstrip(".")


@deconstructible
class FileValidator:
    def __init__(self, kind="document", max_mb=None):
        self.kind = kind
        self.max_mb = max_mb

    def __eq__(self, other):
        return isinstance(other, FileValidator) and (self.kind, self.max_mb) == (other.kind, other.max_mb)

    def __call__(self, f):
        allowed = IMAGE_EXT if self.kind == "image" else DOCUMENT_EXT
        allowed = allowed & set(getattr(settings, "ALLOWED_UPLOAD_EXTENSIONS", allowed))
        ext = _ext(getattr(f, "name", ""))
        if ext not in allowed:
            raise ValidationError(f"Files of type '.{ext or '?'}' are not accepted. Allowed: {', '.join(sorted(allowed))}.")
        limit = self.max_mb or (5 if self.kind == "image" else getattr(settings, "MAX_UPLOAD_MB", 10))
        if f.size > limit * 1024 * 1024:
            raise ValidationError(f"The file is larger than {limit} MB.")
        if not hasattr(f, "read"):
            return
        pos = f.tell() if hasattr(f, "tell") else 0
        head = f.read(16)
        f.seek(pos)
        if ext in TEXT_EXT:
            if b"\x00" in head or head.lstrip().lower().startswith((b"<", b"mz")):
                raise ValidationError("The file does not look like plain text.")
            return
        if not any(head.startswith(sig) for sig in SIGNATURES.get(ext, [])):
            raise ValidationError("The file content does not match its type. It may be damaged or disguised.")
        if ext == "webp" and head[8:12] != b"WEBP":
            raise ValidationError("The file content does not match its type.")


@deconstructible
class RandomName:
    """``upload_to`` callable: <prefix>/<yyyy>/<mm>/<uuid>.<ext>."""

    def __init__(self, prefix):
        self.prefix = prefix.strip("/")

    def __eq__(self, other):
        return isinstance(other, RandomName) and self.prefix == other.prefix

    def __call__(self, instance, filename):
        now = timezone.now()
        return f"{self.prefix}/{now:%Y/%m}/{uuid.uuid4().hex}.{_ext(filename) or 'bin'}"


image_validator = FileValidator("image")
document_validator = FileValidator("document")
