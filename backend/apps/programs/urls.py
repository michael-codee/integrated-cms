from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("programs", views.ProgramViewSet, basename="program")
urlpatterns = router.urls
