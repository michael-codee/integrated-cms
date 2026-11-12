from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("currencies", views.CurrencyViewSet, basename="currency")
router.register("financial-years", views.FinancialYearViewSet, basename="financial-year")
for prefix, viewset in views.LOOKUP_VIEWSETS.items():
    router.register(f"lookups/{prefix}", viewset, basename=prefix)

urlpatterns = [
    path("settings/", views.SystemSettingView.as_view(), name="system-settings"),
    path("settings/public/", views.PublicSettingView.as_view(), name="public-settings"),
] + router.urls
