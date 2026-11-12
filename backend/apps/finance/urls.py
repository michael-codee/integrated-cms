from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("finance/accounts", views.AccountViewSet, basename="finance-account")
router.register("finance/transactions", views.TransactionViewSet, basename="finance-transaction")
router.register("finance/approval-policies", views.ApprovalPolicyViewSet, basename="approval-policy")
router.register("finance/budgets", views.BudgetViewSet, basename="budget")
router.register("finance/reconciliations", views.ReconciliationViewSet, basename="reconciliation")
urlpatterns = [path("finance/summary/", views.FinanceSummaryView.as_view(), name="finance-summary")] + router.urls
