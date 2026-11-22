from datetime import timedelta

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.presentation.models import RemoteCommand, RemoteSession, RemoteSignal
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


OFFER = {"type": "offer", "sdp": "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n"}
ANSWER = {"type": "answer", "sdp": "v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\n"}


def test_phone_camera_setup_messages(api, media_user):
    desk = api(media_user)
    r = desk.post("/api/media/remote/")
    sid, token = r.data["id"], r.data["token"]
    p = phone(api, token)
    # the phone offers its camera; only offers and hang-ups are accepted from it
    assert p.post("/api/media/remote/phone/signal/", {"kind": "offer", "payload": OFFER}, format="json").status_code == 202
    assert p.post("/api/media/remote/phone/signal/", {"kind": "answer", "payload": ANSWER}, format="json").status_code == 400
    assert p.post("/api/media/remote/phone/signal/", {"kind": "offer", "payload": {"type": "offer", "sdp": "<script>"}},
                  format="json").status_code == 400
    assert phone(api, "nope").post("/api/media/remote/phone/signal/", {"kind": "bye"}, format="json").status_code == 410

    r = desk.post(f"/api/media/remote/{sid}/sync/", {"signals_after": 0}, format="json")
    [offer] = r.data["signals"]
    assert offer["kind"] == "offer" and offer["payload"] == OFFER
    # the desk answers in its next sync and confirms it read the offer
    r = desk.post(f"/api/media/remote/{sid}/sync/",
                  {"signals_after": offer["id"], "send_signals": [{"kind": "answer", "payload": ANSWER}]}, format="json")
    assert r.status_code == 200 and r.data["signals"] == []
    bad = desk.post(f"/api/media/remote/{sid}/sync/", {"send_signals": [{"kind": "exec", "payload": {}}]}, format="json")
    assert bad.status_code == 400

    r = p.get("/api/media/remote/phone/", {"signals_after": 0})
    [answer] = r.data["signals"]
    assert answer["kind"] == "answer" and answer["payload"] == ANSWER
    assert p.get("/api/media/remote/phone/", {"signals_after": answer["id"]}).data["signals"] == []

    # a new offer replaces one the desk has not read; ending the remote clears everything
    p.post("/api/media/remote/phone/signal/", {"kind": "offer", "payload": OFFER}, format="json")
    p.post("/api/media/remote/phone/signal/", {"kind": "offer", "payload": OFFER}, format="json")
    assert RemoteSignal.objects.filter(session_id=sid, sender="phone").count() == 1
    desk.post(f"/api/media/remote/{sid}/end/")
    assert not RemoteSignal.objects.filter(session_id=sid).exists()


def test_media_officer_role(seeded, api, units):
    import importlib

    from django.apps import apps as django_apps

    from apps.accounts.models import Role

    role = Role.objects.get(code="media_officer")
    assert role.name == "Media Officer"
    codes = set(role.permissions.values_list("code", flat=True))
    assert {"media.view", "media.create", "media.edit", "media.delete", "media.approve"} <= codes
    assert not any(c.startswith(("finance.", "members.")) for c in codes)
    officer = make_user("media_officer_koidu", "media_officer", units["BR-KONO-001"])
    assert api(officer).post("/api/media/remote/").status_code == 201
    # the data migration adds the role to a database that does not have it yet
    from apps.accounts.models import RoleAssignment
    RoleAssignment.objects.filter(role=role).delete()
    role.delete()
    add_role = importlib.import_module("apps.presentation.migrations.0005_media_officer_role").add_role
    add_role(django_apps, None)
    assert Role.objects.get(code="media_officer").permissions.filter(code="media.approve").exists()
