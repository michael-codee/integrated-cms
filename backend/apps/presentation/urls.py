from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("media/songs", views.SongViewSet, basename="media-song")
router.register("media/images", views.MediaImageViewSet, basename="media-image")
router.register("media/plans", views.ServicePlanViewSet, basename="media-plan")
urlpatterns = router.urls
