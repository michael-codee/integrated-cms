from datetime import timedelta

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.presentation.models import RemoteCommand, RemoteSession
from conftest import make_user

pytestmark = pytest.mark.django_db


@pytest.fixture
def media_user(units):
    return make_user("media_koidu", "media_team", units["BR-KONO-001"])


def phone(api, token):
    c = api()
    c.credentials(HTTP_X_REMOTE_TOKEN=token)
    return c


def test_phone_presses_reach_the_desk(api, media_user):
    desk = api(media_user)
    r = desk.post("/api/media/remote/")
    assert r.status_code == 201, r.data
    sid, token = r.data["id"], r.data["token"]
    assert RemoteSession.objects.get(pk=sid).token_hash != token  # only the hash is stored

    # the desk publishes what is on screen; the phone reads it without signing in
    state = {"title": "Amazing Grace", "lines": ["Amazing grace"], "mode": "show"}
    r = desk.post(f"/api/media/remote/{sid}/sync/", {"state": state, "after": 0}, format="json")
    assert r.status_code == 200 and r.data["commands"] == [] and r.data["phone_connected"] is False
    p = phone(api, token)
    r = p.get("/api/media/remote/phone/")
    assert r.status_code == 200 and r.data["state"] == state and r.data["desk_connected"] is True

    assert p.post("/api/media/remote/phone/", {"action": "next"}, format="json").status_code == 202
    assert p.post("/api/media/remote/phone/", {"action": "slide", "value": 3}, format="json").status_code == 202
    assert p.post("/api/media/remote/phone/", {"action": "format_disk"}, format="json").status_code == 400
    assert p.post("/api/media/remote/phone/", {"action": "item", "value": "x"}, format="json").status_code == 400

    r = desk.post(f"/api/media/remote/{sid}/sync/", {"after": 0}, format="json")
    cmds = r.data["commands"]
    assert [(c["action"], c["value"]) for c in cmds] == [("next", None), ("slide", 3)]
    assert r.data["phone_connected"] is True
    # confirmed presses are not sent again and are removed
    r = desk.post(f"/api/media/remote/{sid}/sync/", {"after": cmds[-1]["id"]}, format="json")
    assert r.data["commands"] == [] and not RemoteCommand.objects.filter(session_id=sid).exists()


def test_tokens_are_the_only_key(api, media_user, people):
    desk = api(media_user)
    r = desk.post("/api/media/remote/")
    sid, token = r.data["id"], r.data["token"]
    assert phone(api, "wrong-token").get("/api/media/remote/phone/").status_code == 410
    assert api().get("/api/media/remote/phone/").status_code == 410
    # another user cannot read or end someone else's desk session
    other = api(people["pastor_lei"])
    assert other.post(f"/api/media/remote/{sid}/sync/", {}, format="json").status_code == 404
    assert other.post(f"/api/media/remote/{sid}/end/").status_code == 404
    # people without media access cannot open a remote
    assert api(people["treasurer_koidu"]).post("/api/media/remote/").status_code == 403
    assert api().post("/api/media/remote/").status_code == 401

    # ending the remote stops the phone; a new pairing ends the previous link
    r2 = desk.post("/api/media/remote/")
    assert phone(api, token).get("/api/media/remote/phone/").status_code == 410
    assert desk.post(f"/api/media/remote/{sid}/sync/", {}, format="json").status_code == 410
    p2 = phone(api, r2.data["token"])
    assert p2.get("/api/media/remote/phone/").status_code == 200
    assert desk.post(f"/api/media/remote/{r2.data['id']}/end/").status_code == 204
    assert p2.post("/api/media/remote/phone/", {"action": "next"}, format="json").status_code == 410


def test_expiry_limits_and_cleanup(api, media_user):
    desk = api(media_user)
    r = desk.post("/api/media/remote/")
    sid, token = r.data["id"], r.data["token"]
    p = phone(api, token)
    for _ in range(40):
        p.post("/api/media/remote/phone/", {"action": "next"}, format="json")
    # a desk that is not collecting presses does not let them pile up
    assert p.post("/api/media/remote/phone/", {"action": "next"}, format="json").status_code == 429
    big = {"lines": ["x" * 70_000]}
    assert desk.post(f"/api/media/remote/{sid}/sync/", {"state": big}, format="json").status_code == 400

    RemoteSession.objects.filter(pk=sid).update(expires_at=timezone.now() - timedelta(days=2))
    assert p.get("/api/media/remote/phone/").status_code == 410
    call_command("purge_expired")
    assert not RemoteSession.objects.filter(pk=sid).exists()
