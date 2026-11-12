"""Production settings. Every security-relevant value must come from the environment."""
from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F401,F403
from .base import SECRET_KEY, env

DEBUG = False
if SECRET_KEY.startswith("insecure") or len(SECRET_KEY) < 40:
    raise ImproperlyConfigured("Set a strong DJANGO_SECRET_KEY (at least 40 random characters) in production.")

ALLOW_DEMO_DATA = False
REFRESH_COOKIE_SECURE = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = env("SECURE_SSL_REDIRECT", True, bool)
SECURE_HSTS_SECONDS = env("SECURE_HSTS_SECONDS", 31536000, int)
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
X_FRAME_OPTIONS = "DENY"
SECURE_REFERRER_POLICY = "same-origin"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
