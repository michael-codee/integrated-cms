from rest_framework.routers import DefaultRouter

from .leadership import AppointmentViewSet, PositionViewSet
from django.urls import path

from .views import BranchDirectoryView, OrgUnitViewSet

router = DefaultRouter()
router.register("org-units", OrgUnitViewSet, basename="org-unit")
router.register("leadership-positions", PositionViewSet, basename="leadership-position")
router.register("appointments", AppointmentViewSet, basename="appointment")
urlpatterns = [path("org-units/directory/", BranchDirectoryView.as_view(), name="branch-directory")] + router.urls
