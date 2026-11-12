from rest_framework.routers import DefaultRouter

from .views import OrgUnitViewSet

router = DefaultRouter()
router.register("org-units", OrgUnitViewSet, basename="org-unit")
urlpatterns = router.urls
