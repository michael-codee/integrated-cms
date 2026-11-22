from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.accounts.urls import auth_urls
from apps.core import cron
from apps.core.files import serve_signed_file


def health(request):
    from django.db import connection

    with connection.cursor() as c:
        c.execute("SELECT 1")
    return JsonResponse({"status": "ok"})


api = [
    path("health/", health, name="health"),
    path("files/<str:token>/", serve_signed_file, name="signed-file"),
    path("cron/housekeeping/", cron.housekeeping, name="cron-housekeeping"),
    path("auth/", include(auth_urls)),
    path("", include("apps.accounts.urls")),
    path("", include("apps.organization.urls")),
    path("", include("apps.configuration.urls")),
    path("", include("apps.audit.urls")),
    path("", include("apps.members.urls")),
    path("", include("apps.finance.urls")),
    path("", include("apps.assets.urls")),
    path("", include("apps.departments.urls")),
    path("", include("apps.programs.urls")),
    path("", include("apps.attendance.urls")),
    path("", include("apps.notifications.urls")),
    path("", include("apps.dashboard.urls")),
    path("", include("apps.sync.urls")),
    path("", include("apps.reports.urls")),
    path("", include("apps.documents.urls")),
    path("", include("apps.presentation.urls")),
    path("schema/", SpectacularAPIView.as_view(), name="schema"),
    path("docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="api-docs"),
]

urlpatterns = [
    path("django-admin/", admin.site.urls),
    path("api/", include(api)),
]
