"""OpenAPI description of CMIS authentication (picked up by drf-spectacular)."""
from drf_spectacular.contrib.rest_framework_simplejwt import SimpleJWTScheme


class CMISJWTScheme(SimpleJWTScheme):
    target_class = "apps.accounts.authentication.CMISJWTAuthentication"
    name = "jwtAuth"
