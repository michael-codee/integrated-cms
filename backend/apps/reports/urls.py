from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("report-templates", views.TemplateViewSet, basename="report-template")
router.register("reports", views.SubmissionViewSet, basename="report")

urlpatterns = [
    path("reports/compliance/", views.ComplianceView.as_view(), name="report-compliance"),
    path("reports/due/", views.DueView.as_view(), name="report-due"),
    path("", include(router.urls)),
]
