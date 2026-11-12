import datetime

import pytest

from apps.configuration.models import FinancialYear, SystemSetting

pytestmark = pytest.mark.django_db


def test_seed_is_idempotent_and_creates_no_accounts(seeded):
    from apps.accounts.models import User
    from apps.configuration.seed import seed_all
    from apps.organization.models import OrgUnit

    count = OrgUnit.objects.count()
    seed_all()
    assert OrgUnit.objects.count() == count
    assert User.objects.count() == 0


def test_public_settings_available_without_login(api, seeded):
    res = api().get("/api/settings/public/")
    assert res.status_code == 200
    assert res.data["ministry_name"] == "Rivers of Living Water Ministries"
    assert res.data["default_currency"] == "SLE"


def test_only_authorised_users_change_settings(api, people):
    assert api(people["pastor_bo"]).patch("/api/settings/", {"phone": "+232"}, format="json").status_code == 403
    res = api(people["admin"]).patch("/api/settings/", {"phone": "+232 76 000000"}, format="json")
    assert res.status_code == 200 and res.data["phone"] == "+232 76 000000"


def test_lookups_are_readable_by_all_and_editable_by_admin(api, people):
    res = api(people["pastor_bo"]).get("/api/lookups/finance-categories/?kind=income")
    assert res.status_code == 200 and any(c["code"] == "tithes" for c in res.data)
    assert api(people["pastor_bo"]).post("/api/lookups/asset-categories/", {"code": "drones", "name": "Drones"},
                                         format="json").status_code == 403
    assert api(people["admin"]).post("/api/lookups/asset-categories/", {"code": "drones", "name": "Drones"},
                                     format="json").status_code == 201


def test_financial_year_auto_created_from_start_month(seeded):
    s = SystemSetting.get()
    s.financial_year_start_month = 7
    s.save()
    fy = FinancialYear.for_date(datetime.date(2026, 3, 15))
    assert fy.start_date == datetime.date(2025, 7, 1)
    assert fy.end_date == datetime.date(2026, 6, 30)
    assert fy.name == "FY 2025/26"


def test_provision_admin_command(seeded, monkeypatch):
    from django.core.management import call_command

    from apps.accounts.models import User

    monkeypatch.setenv("CMIS_ADMIN_PW", "A-Very-Strong-Passw0rd!")
    call_command("provision_admin", role="general_overseer", username="go", email="go@example.org",
                 full_name="General Overseer", password_env="CMIS_ADMIN_PW")
    user = User.objects.get(username="go")
    assert user.must_change_password
    assert user.role_assignments.get().org_unit.unit_type == "headquarters"


def test_provision_admin_rejects_weak_password(seeded, monkeypatch):
    from django.core.management import CommandError, call_command

    monkeypatch.setenv("CMIS_ADMIN_PW", "password")
    with pytest.raises(CommandError):
        call_command("provision_admin", role="system_admin", username="a", email="a@example.org", full_name="A",
                     password_env="CMIS_ADMIN_PW")
