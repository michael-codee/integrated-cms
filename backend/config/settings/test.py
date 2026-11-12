from .base import *  # noqa: F401,F403
from .base import REST_FRAMEWORK

DEBUG = False
SECRET_KEY = "test-secret-key-not-for-production"
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
REFRESH_COOKIE_SECURE = False
ALLOW_DEMO_DATA = True
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
REST_FRAMEWORK = {
    **REST_FRAMEWORK,
    "DEFAULT_THROTTLE_RATES": {
        **REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"],
        "anon": "10000/min",
        "user": "10000/min",
        "login": "1000/min",
        "password_reset": "1000/min",
        "export": "1000/min",
    },
}
MEDIA_ROOT = BASE_DIR / "test-media"  # noqa: F405
