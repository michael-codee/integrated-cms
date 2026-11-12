import pytest
from django.core import mail
from django.test import override_settings

from apps.audit.models import AuditLog
from conftest import PASSWORD

pytestmark = pytest.mark.django_db


def login(client, username, password=PASSWORD):
    return client.post("/api/auth/login/", {"username": username, "password": password}, format="json")


def test_login_returns_access_token_and_sets_httponly_refresh_cookie(api, people):
    client = api()
    res = login(client, "pastor_koidu")
    assert res.status_code == 200
    assert res.data["access"]
    assert res.data["user"]["username"] == "pastor_koidu"
    cookie = res.cookies["cmis_refresh"]
    assert cookie["httponly"]
    assert cookie["samesite"] == "Strict"
    assert AuditLog.objects.filter(action="login", entity_id=str(people["pastor_koidu"].pk)).exists()


def test_login_by_email_works(api, people):
    assert login(api(), "pastor_koidu@example.org").status_code == 200


def test_wrong_password_rejected_with_generic_message(api, people):
    res = login(api(), "pastor_koidu", "wrong-password")
    assert res.status_code == 401
    assert res.data["detail"] == "Invalid username or password."
    unknown = login(api(), "nobody", "wrong-password")
    assert unknown.data["detail"] == res.data["detail"]


@override_settings(LOGIN_MAX_FAILURES=3)
def test_account_locks_after_repeated_failures(api, people):
    client = api()
    for _ in range(3):
        login(client, "pastor_koidu", "bad")
    res = login(client, "pastor_koidu")  # correct password but locked
    assert res.status_code == 403
    assert "locked" in res.data["detail"]


def test_suspended_user_cannot_login_or_use_existing_token(api, people):
    client = api()
    token = login(client, "pastor_bo").data["access"]
    user = people["pastor_bo"]
    user.status = "suspended"
    user.save()
    assert login(api(), "pastor_bo").status_code == 403
    authed = api()
    authed.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    assert authed.get("/api/auth/me/").status_code == 401


def test_protected_endpoints_require_authentication(api, people):
    client = api()
    for url in ["/api/auth/me/", "/api/users/", "/api/org-units/", "/api/audit-logs/", "/api/settings/"]:
        assert client.get(url).status_code == 401, url


def test_refresh_rotates_cookie_and_logout_revokes(api, people):
    client = api()
    login(client, "kono_overseer")
    res = client.post("/api/auth/refresh/")
    assert res.status_code == 200 and res.data["access"]
    old_cookie = res.cookies["cmis_refresh"].value
    assert client.post("/api/auth/logout/").status_code == 204
    client.cookies["cmis_refresh"] = old_cookie
    assert client.post("/api/auth/refresh/").status_code == 401


def test_refresh_requires_client_header(people):
    from rest_framework.test import APIClient

    client = APIClient()
    login(client, "kono_overseer")
    assert client.post("/api/auth/refresh/").status_code == 403


def test_bearer_token_grants_access(api, people):
    token = login(api(), "general_overseer").data["access"]
    client = api()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    me = client.get("/api/auth/me/")
    assert me.status_code == 200
    assert "finance.approve" in me.data["permissions"]


def test_password_reset_flow(api, people):
    client = api()
    res = client.post("/api/auth/password-reset/", {"email": "pastor_lei@example.org"}, format="json")
    assert res.status_code == 200
    assert len(mail.outbox) == 1
    token = mail.outbox[0].body.split("token=")[1].split()[0]
    res = client.post("/api/auth/password-reset/confirm/", {"token": token, "new_password": "A-brand-new-Passw0rd"},
                      format="json")
    assert res.status_code == 200
    assert login(api(), "pastor_lei", "A-brand-new-Passw0rd").status_code == 200
    # token is single-use
    again = client.post("/api/auth/password-reset/confirm/", {"token": token, "new_password": "Another-Passw0rd-1"},
                        format="json")
    assert again.status_code == 400


def test_password_reset_unknown_email_does_not_leak(api, people):
    res = api().post("/api/auth/password-reset/", {"email": "nobody@example.org"}, format="json")
    assert res.status_code == 200
    assert len(mail.outbox) == 0


def test_change_password_invalidates_old_tokens(api, people):
    client = api()
    old_access = login(client, "pastor_lei").data["access"]
    authed = api()
    authed.credentials(HTTP_AUTHORIZATION=f"Bearer {old_access}")
    import time

    time.sleep(1.1)
    res = authed.post("/api/auth/change-password/",
                      {"current_password": PASSWORD, "new_password": "Changed-Passw0rd-99"}, format="json")
    assert res.status_code == 200
    assert authed.get("/api/auth/me/").status_code == 401
    assert login(api(), "pastor_lei", "Changed-Passw0rd-99").status_code == 200


def test_weak_password_rejected(api, people):
    client = api(people["pastor_lei"])
    res = client.post("/api/auth/change-password/", {"current_password": PASSWORD, "new_password": "12345"},
                      format="json")
    assert res.status_code == 400
