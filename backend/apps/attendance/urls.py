from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("attendance", views.AttendanceViewSet, basename="attendance")
urlpatterns = [path("attendance/stats/", views.AttendanceStatsView.as_view(), name="attendance-stats")] + router.urls
