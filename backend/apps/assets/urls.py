from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("assets", views.AssetViewSet, basename="asset")
router.register("asset-movements", views.MovementViewSet, basename="asset-movement")
router.register("asset-maintenance", views.MaintenanceViewSet, basename="asset-maintenance")
router.register("asset-disposals", views.DisposalViewSet, basename="asset-disposal")
urlpatterns = [path("assets/summary/", views.AssetSummaryView.as_view(), name="asset-summary")] + router.urls
