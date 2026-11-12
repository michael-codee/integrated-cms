from .base import *  # noqa: F401,F403
from .base import env

DEBUG = env("DJANGO_DEBUG", True, bool)
REFRESH_COOKIE_SECURE = env("REFRESH_COOKIE_SECURE", False, bool)
CORS_ALLOWED_ORIGINS = env("CORS_ALLOWED_ORIGINS", ["http://localhost:5173", "http://127.0.0.1:5173"], list)
ALLOW_DEMO_DATA = env("ALLOW_DEMO_DATA", True, bool)
