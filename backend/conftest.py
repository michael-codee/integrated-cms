"""Shared pytest fixtures: a seeded church structure and users at each level."""
import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Role, RoleAssignment, User
from apps.configuration.seed import seed_all
from apps.organization.models import OrgUnit

PASSWORD = "Str0ng-Test-Passw0rd!"


@pytest.fixture
def seeded(db):
    seed_all()
    return {u.code: u for u in OrgUnit.objects.all()}


@pytest.fixture
def units(seeded):
    return seeded


def make_user(username, role_code, unit, **extra):
    user = User.objects.create_user(username=username, email=f"{username}@example.org", password=PASSWORD,
                                    full_name=username.replace("_", " ").title(), **extra)
    RoleAssignment.objects.create(user=user, role=Role.objects.get(code=role_code), org_unit=unit)
    return User.objects.get(pk=user.pk)


@pytest.fixture
def people(units):
    return {
        "admin": make_user("sysadmin", "system_admin", units["HQ-RLWM"]),
        "go": make_user("general_overseer", "general_overseer", units["HQ-RLWM"]),
        "east": make_user("east_overseer", "regional_overseer", units["RG-EAST"]),
        "south": make_user("south_overseer", "regional_overseer", units["RG-SOUTH"]),
        "kono": make_user("kono_overseer", "district_overseer", units["DT-KONO"]),
        "pastor_koidu": make_user("pastor_koidu", "branch_pastor", units["BR-KONO-001"]),
        "pastor_lei": make_user("pastor_lei", "branch_pastor", units["BR-KONO-002"]),
        "pastor_bo": make_user("pastor_bo", "branch_pastor", units["BR-BO-001"]),
        "treasurer_koidu": make_user("treasurer_koidu", "treasurer", units["BR-KONO-001"]),
    }


@pytest.fixture
def api():
    def _client(user=None):
        client = APIClient(HTTP_X_CMIS_CLIENT="test")
        if user is not None:
            client.force_authenticate(User.objects.get(pk=user.pk))
        return client

    return _client
