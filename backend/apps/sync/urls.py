from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("sync/conflicts", views.ConflictViewSet, basename="sync-conflict")
router.register("sync/devices", views.DeviceViewSet, basename="sync-device")

urlpatterns = [
    path("sync/pull/", views.PullView.as_view(), name="sync-pull"),
    path("sync/status/", views.StatusView.as_view(), name="sync-status"),
    path("", include(router.urls)),
]
