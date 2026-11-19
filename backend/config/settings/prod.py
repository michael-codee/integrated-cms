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
# Static files (Django admin only) are collected at image build; Vercel has no collect step, so it
# keeps the plain backend (STATIC_MANIFEST=false).
if env("STATIC_MANIFEST", True, bool):
    STORAGES = {**STORAGES, "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"}}  # noqa: F405
else:
    WHITENOISE_USE_FINDERS = True  # serve the admin's static files straight from the installed apps

# API documentation (/api/docs/, /api/schema/) is only shown to staff signed in to /django-admin/
# unless API_DOCS_PUBLIC=true. The schema reveals no data, but there is no reason to publish it.
if not env("API_DOCS_PUBLIC", False, bool):
    SPECTACULAR_SETTINGS = {
        **SPECTACULAR_SETTINGS,  # noqa: F405
        "SERVE_PERMISSIONS": ["rest_framework.permissions.IsAdminUser"],
        "SERVE_AUTHENTICATION": ["rest_framework.authentication.SessionAuthentication",
                                 "apps.accounts.authentication.CMISJWTAuthentication"],
    }
