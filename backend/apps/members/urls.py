from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("members", views.MemberViewSet, basename="member")
router.register("baptisms", views.BaptismViewSet, basename="baptism")
router.register("member-transfers", views.TransferViewSet, basename="member-transfer")
urlpatterns = router.urls
