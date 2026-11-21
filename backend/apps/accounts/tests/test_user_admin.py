"""System administrator account management: temporary passwords, moving roles between units, access review."""
import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Role, RoleAssignment, User
from apps.audit.models import AuditLog
from conftest import PASSWORD

pytestmark = pytest.mark.django_db

NEW_PASSWORD = "Kono-Branch-2026!"


def test_admin_sets_temporary_password(api, people):
    target = people["pastor_bo"]
    res = api(people["admin"]).post(f"/api/users/{target.pk}/set-password/", {"password": NEW_PASSWORD},
                                    format="json")
    assert res.status_code == 200
    target.refresh_from_db()
    assert target.check_password(NEW_PASSWORD) and not target.check_password(PASSWORD)
    assert target.must_change_password
    assert AuditLog.objects.filter(entity_id=str(target.pk), action=AuditLog.Action.PASSWORD_RESET).exists()
    login = APIClient(HTTP_X_CMIS_CLIENT="web").post("/api/auth/login/", {"username": target.username,
                                                                          "password": NEW_PASSWORD}, format="json")
    assert login.status_code == 200 and login.data["user"]["must_change_password"]


def test_set_password_clears_lockout_and_rejects_weak_passwords(api, people):
    target = people["pastor_bo"]
    from django.utils import timezone

    User.objects.filter(pk=target.pk).update(failed_login_count=9, locked_until=timezone.now() + timezone.timedelta(hours=1))
    client = api(people["admin"])
    weak = client.post(f"/api/users/{target.pk}/set-password/", {"password": "password"}, format="json")
    assert weak.status_code == 400 and "password" in weak.data
    ok = client.post(f"/api/users/{target.pk}/set-password/", {"password": NEW_PASSWORD}, format="json")
    assert ok.status_code == 200
    target.refresh_from_db()
    assert not target.is_locked and target.failed_login_count == 0


def test_cannot_set_password_of_more_senior_user_or_self(api, people):
    assert api(people["east"]).post(f"/api/users/{people['go'].pk}/set-password/", {"password": NEW_PASSWORD},
                                    format="json").status_code in (403, 404)
    assert api(people["admin"]).post(f"/api/users/{people['admin'].pk}/set-password/",
                                     {"password": NEW_PASSWORD}, format="json").status_code == 403


def test_pastor_cannot_set_passwords(api, people):
    res = api(people["pastor_koidu"]).post(f"/api/users/{people['treasurer_koidu'].pk}/set-password/",
                                           {"password": NEW_PASSWORD}, format="json")
    assert res.status_code in (403, 404)


def test_admin_moves_role_to_another_unit_keeping_history(api, people, units):
    target = people["pastor_bo"]
    old = RoleAssignment.objects.get(user=target)
    res = api(people["admin"]).post(f"/api/role-assignments/{old.pk}/change/",
                                    {"org_unit": str(units["BR-KONO-002"].pk), "reason": "Transferred"},
                                    format="json")
    assert res.status_code == 201, res.data
    old.refresh_from_db()
    assert not old.is_active and old.ends_on is not None
    new = RoleAssignment.objects.get(pk=res.data["id"])
    assert new.is_active and new.org_unit == units["BR-KONO-002"] and new.role == old.role
    assert new.notes == "Transferred"
    from apps.core import scoping

    target = User.objects.get(pk=target.pk)
    assert scoping.can(target, "members.view", units["BR-KONO-002"])
    assert not scoping.can(target, "members.view", units["BR-BO-001"])


def test_admin_swaps_role(api, people):
    target = people["treasurer_koidu"]
    old = RoleAssignment.objects.get(user=target)
    secretary = Role.objects.get(code="church_secretary")
    res = api(people["admin"]).post(f"/api/role-assignments/{old.pk}/change/", {"role": str(secretary.pk)},
                                    format="json")
    assert res.status_code == 201, res.data
    assert res.data["role_code"] == "church_secretary"


def test_change_respects_jurisdiction_and_seniority(api, people, units):
    # A regional overseer allowed to manage users still cannot move someone into another region.
    from apps.accounts.models import Permission

    Role.objects.get(code="regional_overseer").permissions.add(Permission.objects.get(code="users.edit"))
    pastor = RoleAssignment.objects.get(user=people["pastor_koidu"])
    res = api(people["east"]).post(f"/api/role-assignments/{pastor.pk}/change/",
                                   {"org_unit": str(units["BR-BO-001"].pk)}, format="json")
    assert res.status_code == 400 and "org_unit" in res.data
    # A regional overseer cannot touch the General Overseer's assignment.
    go = RoleAssignment.objects.get(user=people["go"])
    res = api(people["east"]).post(f"/api/role-assignments/{go.pk}/change/",
                                   {"org_unit": str(units["RG-EAST"].pk)}, format="json")
    assert res.status_code in (403, 404)
    # Nobody changes their own assignment.
    own = RoleAssignment.objects.get(user=people["admin"])
    res = api(people["admin"]).post(f"/api/role-assignments/{own.pk}/change/",
                                    {"org_unit": str(units["RG-EAST"].pk)}, format="json")
    assert res.status_code == 403


def test_change_without_difference_is_rejected(api, people):
    old = RoleAssignment.objects.get(user=people["pastor_bo"])
    res = api(people["admin"]).post(f"/api/role-assignments/{old.pk}/change/", {}, format="json")
    assert res.status_code == 400


def test_access_review_lists_current_permissions(api, people):
    res = api(people["admin"]).get(f"/api/users/{people['treasurer_koidu'].pk}/access/")
    assert res.status_code == 200
    assert res.data["assignments"][0]["role_code"] == "treasurer"
    assert "finance.view" in res.data["permissions"]
    assert "settings.edit" not in res.data["permissions"]


def test_access_review_hidden_outside_jurisdiction(api, people):
    res = api(people["pastor_bo"]).get(f"/api/users/{people['treasurer_koidu'].pk}/access/")
    assert res.status_code in (403, 404)


def test_admin_edits_user_details(api, people):
    target = people["pastor_bo"]
    res = api(people["admin"]).patch(f"/api/users/{target.pk}/", {"full_name": "Rev. Bo Pastor",
                                                                   "phone": "+23276000000"}, format="json")
    assert res.status_code == 200 and res.data["full_name"] == "Rev. Bo Pastor"
