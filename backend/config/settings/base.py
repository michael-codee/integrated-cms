"""
Base settings for the RLWM Church Management Information System.

Environment-specific modules (dev, test, prod) import from here. All secrets and
host-specific values come from environment variables (see ../../.env.example).
"""
from datetime import timedelta
from pathlib import Path
import os

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent.parent
load_dotenv(BASE_DIR.parent / ".env")


def env(name, default=None, cast=str):
    value = os.environ.get(name)
    if value is None or value == "":
        return default
    if cast is bool:
        return value.lower() in ("1", "true", "yes", "on")
    if cast is list:
        return [v.strip() for v in value.split(",") if v.strip()]
    return cast(value)


SECRET_KEY = env("DJANGO_SECRET_KEY", "insecure-development-key-change-me")
DEBUG = env("DJANGO_DEBUG", False, bool)
ALLOWED_HOSTS = env("DJANGO_ALLOWED_HOSTS", ["localhost", "127.0.0.1"], list)

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # third party
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "django_filters",
    "corsheaders",
    "drf_spectacular",
    # CMIS apps
    "apps.core",
    "apps.audit",
    "apps.organization",
    "apps.accounts",
    "apps.configuration",
    "apps.members",
    "apps.finance",
    "apps.assets",
    "apps.departments",
    "apps.programs",
    "apps.attendance",
    "apps.notifications",
    "apps.dashboard",
    "apps.sync",
    "apps.reports",
    "apps.documents",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "apps.audit.middleware.RequestContextMiddleware",
    "apps.sync.middleware.IdempotencyMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

def _database():
    """PostgreSQL from POSTGRES_* variables, or from DATABASE_URL (e.g. Supabase's connection string).

    DB_POOLER=transaction is for Supabase's transaction pooler (port 6543), which serverless hosts such
    as Vercel must use: no persistent connections, no server-side cursors, no prepared statements.
    """
    from urllib.parse import unquote, urlsplit

    url = env("DATABASE_URL")
    db = {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("POSTGRES_DB", "cmis"),
        "USER": env("POSTGRES_USER", "cmis"),
        "PASSWORD": env("POSTGRES_PASSWORD", "cmis"),
        "HOST": env("POSTGRES_HOST", "localhost"),
        "PORT": env("POSTGRES_PORT", "5432"),
        "CONN_MAX_AGE": env("POSTGRES_CONN_MAX_AGE", 60, int),
        "ATOMIC_REQUESTS": True,
        "OPTIONS": {},
    }
    if url:
        parts = urlsplit(url)
        db.update(NAME=unquote(parts.path.lstrip("/")) or "postgres", USER=unquote(parts.username or ""),
                  PASSWORD=unquote(parts.password or ""), HOST=parts.hostname or "", PORT=str(parts.port or 5432))
    sslmode = env("DB_SSLMODE", "require" if url else None)
    if sslmode:
        db["OPTIONS"]["sslmode"] = sslmode
    if env("DB_POOLER", "") == "transaction":
        db["CONN_MAX_AGE"] = 0
        db["DISABLE_SERVER_SIDE_CURSORS"] = True
        db["OPTIONS"]["prepare_threshold"] = None
    return db


DATABASES = {"default": _database()}

AUTH_USER_MODEL = "accounts.User"

PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 10}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-gb"
TIME_ZONE = "Africa/Freetown"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = Path(env("MEDIA_ROOT", str(BASE_DIR / "media")))
# Uploaded files are served only through short-lived signed links (apps.core.files), never by the
# web server. FILE_URL_MAX_AGE is how long such a link works, in seconds.
FILE_URL_MAX_AGE = env("FILE_URL_MAX_AGE", 3600, int)
# Documents & records are stored here and only served through the API (never by the web server).
PRIVATE_MEDIA_ROOT = Path(env("PRIVATE_MEDIA_ROOT", str(BASE_DIR / "private-media")))

# File storage. "local" keeps uploads on disk (MEDIA_ROOT / PRIVATE_MEDIA_ROOT, the Docker setup).
# "s3" keeps them in S3-compatible object storage such as Supabase Storage (required on Vercel, whose
# functions have no permanent disk). Two private buckets: uploads, and Documents & records.
FILE_STORAGE = env("FILE_STORAGE", "local")
if FILE_STORAGE == "s3":
    _s3 = {
        "endpoint_url": env("S3_ENDPOINT_URL"),
        "region_name": env("S3_REGION"),
        "access_key": env("S3_ACCESS_KEY_ID"),
        "secret_key": env("S3_SECRET_ACCESS_KEY"),
        "addressing_style": "path",
        "signature_version": "s3v4",
        "default_acl": None,
        "file_overwrite": False,
        "querystring_auth": True,
    }
    STORAGES = {
        "default": {"BACKEND": "storages.backends.s3.S3Storage",
                    "OPTIONS": {**_s3, "bucket_name": env("S3_BUCKET_MEDIA", "cmis-media")}},
        "private": {"BACKEND": "storages.backends.s3.S3Storage",
                    "OPTIONS": {**_s3, "bucket_name": env("S3_BUCKET_PRIVATE", "cmis-documents")}},
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    }
else:
    STORAGES = {
        "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
        "private": {"BACKEND": "django.core.files.storage.FileSystemStorage",
                    "OPTIONS": {"location": str(PRIVATE_MEDIA_ROOT), "base_url": None}},
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    }

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --------------------------------------------------------------------------- DRF
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["apps.accounts.authentication.CMISJWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.StandardPagination",
    "PAGE_SIZE": 25,
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "apps.core.exceptions.exception_handler",
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": env("THROTTLE_ANON", "60/min"),
        "user": env("THROTTLE_USER", "1200/min"),
        "login": env("THROTTLE_LOGIN", "10/min"),
        "password_reset": env("THROTTLE_PASSWORD_RESET", "5/hour"),
        "export": env("THROTTLE_EXPORT", "30/hour"),
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=env("JWT_ACCESS_MINUTES", 15, int)),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env("JWT_REFRESH_DAYS", 7, int)),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": False,
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
    "AUTH_HEADER_TYPES": ("Bearer",),
}

# Refresh token cookie (httpOnly; never readable by JavaScript)
REFRESH_COOKIE_NAME = "cmis_refresh"
REFRESH_COOKIE_PATH = "/api/auth/"
REFRESH_COOKIE_SECURE = env("REFRESH_COOKIE_SECURE", True, bool)
REFRESH_COOKIE_SAMESITE = "Strict"

# Account lockout
LOGIN_MAX_FAILURES = env("LOGIN_MAX_FAILURES", 5, int)
LOGIN_LOCKOUT_MINUTES = env("LOGIN_LOCKOUT_MINUTES", 15, int)
PASSWORD_RESET_TOKEN_HOURS = env("PASSWORD_RESET_TOKEN_HOURS", 2, int)
FRONTEND_URL = env("FRONTEND_URL", "http://localhost:5173")

SPECTACULAR_SETTINGS = {
    "TITLE": "RLWM Church Management Information System API",
    "DESCRIPTION": "Rivers of Living Water Ministries (Holy Ghost Bible Church). "
    "\"Let all things be done decently and in order.\" — 1 Corinthians 14:40",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
}

CORS_ALLOWED_ORIGINS = env("CORS_ALLOWED_ORIGINS", [], list)
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_HEADERS = [
    "accept",
    "authorization",
    "content-type",
    "idempotency-key",
    "if-match",
    "x-device-id",
    "x-cmis-client",
]
CSRF_TRUSTED_ORIGINS = env("CSRF_TRUSTED_ORIGINS", [], list)

EMAIL_BACKEND = env("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = env("EMAIL_HOST", "")
EMAIL_PORT = env("EMAIL_PORT", 587, int)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = env("EMAIL_USE_TLS", True, bool)
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", "CMIS <no-reply@localhost>")

# Uploads
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024
MAX_UPLOAD_MB = env("MAX_UPLOAD_MB", 10, int)  # Vercel refuses request bodies over 4.5 MB: use 4 there
ALLOWED_UPLOAD_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "webp", "doc", "docx", "xls", "xlsx", "csv", "txt"]

# Retention (purge_expired). The audit trail and church records are never purged.
IDEMPOTENCY_KEEP_DAYS = env("IDEMPOTENCY_KEEP_DAYS", 30, int)
NOTIFICATION_KEEP_DAYS = env("NOTIFICATION_KEEP_DAYS", 180, int)

# Demo data (never in production)
ALLOW_DEMO_DATA = env("ALLOW_DEMO_DATA", False, bool)

# Rate limits and other cached counters. On serverless hosts each instance has its own memory, so keep
# them in the database there (CACHE_BACKEND=database; `manage.py createcachetable` creates the table).
if env("CACHE_BACKEND", "memory") == "database":
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.db.DatabaseCache", "LOCATION": "cmis_cache"}}

# Vercel Cron calls /api/cron/housekeeping/ with "Authorization: Bearer <CRON_SECRET>".
CRON_SECRET = env("CRON_SECRET", "")

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "standard": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "standard"},
    },
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", "INFO")},
    "loggers": {
        "django.db.backends": {"level": "WARNING"},
        "cmis": {"level": env("LOG_LEVEL", "INFO"), "propagate": True},
    },
}
