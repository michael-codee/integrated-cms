from django.urls import path
from rest_framework.routers import DefaultRouter

from . import remote, views

router = DefaultRouter()
router.register("media/songs", views.SongViewSet, basename="media-song")
router.register("media/images", views.MediaImageViewSet, basename="media-image")
router.register("media/plans", views.ServicePlanViewSet, basename="media-plan")
urlpatterns = [
    path("media/remote/", remote.RemoteSessionView.as_view(), name="media-remote"),
    path("media/remote/phone/", remote.PhoneView.as_view(), name="media-remote-phone"),
    path("media/remote/phone/signal/", remote.PhoneSignalView.as_view(), name="media-remote-phone-signal"),
    path("media/remote/<uuid:pk>/sync/", remote.RemoteSyncView.as_view(), name="media-remote-sync"),
    path("media/remote/<uuid:pk>/end/", remote.RemoteEndView.as_view(), name="media-remote-end"),
    *router.urls,
]
