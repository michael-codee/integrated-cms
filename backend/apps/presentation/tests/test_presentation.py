import datetime

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.accounts.models import Role
from apps.presentation.models import ServicePlan, Song
from conftest import make_user

pytestmark = pytest.mark.django_db



def png_bytes():
    from io import BytesIO

    from PIL import Image

    buf = BytesIO()
    Image.new("RGB", (4, 4), (20, 40, 120)).save(buf, format="PNG")
    return buf.getvalue()


LYRICS = "[Verse 1]\nAmazing grace how sweet the sound\nThat saved a wretch like me\n\n[Chorus]\nPraise Him"


@pytest.fixture
def media_user(units):
    return make_user("media_koidu", "media_team", units["BR-KONO-001"])


def test_roles_get_media_permissions(seeded):
    assert Role.objects.get(code="media_team").permissions.filter(code="media.edit").exists()
    assert Role.objects.get(code="branch_pastor").permissions.filter(code="media.create").exists()
    assert not Role.objects.get(code="treasurer").permissions.filter(code__startswith="media.").exists()


def test_song_library_is_shared_and_searchable(api, people, media_user):
    c = api(media_user)
    r = c.post("/api/media/songs/", {"title": " Amazing Grace ", "author": "John Newton", "lyrics": LYRICS})
    assert r.status_code == 201, r.data
    assert r.data["title"] == "Amazing Grace"
    # another branch's pastor sees and finds the same song
    found = api(people["pastor_bo"]).get("/api/media/songs/", {"search": "wretch"}).data["results"]
    assert [s["title"] for s in found] == ["Amazing Grace"]
    assert found[0]["first_line"] == "Amazing grace how sweet the sound"
    assert "lyrics" in c.get(f"/api/media/songs/{r.data['id']}/").data
    # a treasurer has no media permission
    assert api(people["treasurer_koidu"]).get("/api/media/songs/").status_code == 403
    assert api(people["treasurer_koidu"]).post("/api/media/songs/", {"title": "X", "lyrics": "y"}).status_code == 403
    # soft delete
    assert c.delete(f"/api/media/songs/{r.data['id']}/").status_code == 204
    assert Song.all_objects.get(pk=r.data["id"]).is_deleted


def test_song_requires_words(api, media_user):
    r = api(media_user).post("/api/media/songs/", {"title": "Empty", "lyrics": "   "})
    assert r.status_code == 400 and "lyrics" in r.data


def test_picture_upload(api, media_user, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    c = api(media_user)
    r = c.post("/api/media/images/", {"title": "Sunrise", "kind": "background",
                                      "image": SimpleUploadedFile("sun.png", png_bytes(), content_type="image/png")},
               format="multipart")
    assert r.status_code == 201, r.data
    assert r.data["image"].startswith("/api/files/")
    bad = c.post("/api/media/images/", {"title": "x", "image": SimpleUploadedFile("x.png", b"MZ not png")},
                 format="multipart")
    assert bad.status_code == 400


def _plan(song_id, **extra):
    return {"org_unit": None, "title": "Sunday Divine Service", "service_date": str(datetime.date(2026, 11, 29)),
            "items": [{"kind": "song", "song": str(song_id)}, {"kind": "scripture", "ref": "John 3:16-18"},
                      {"kind": "text", "title": "Welcome", "body": "Visitors, you are welcome"},
                      {"kind": "blank"}],
            "theme": {"preset": "royal"}, **extra}


def test_service_plan_scoped_to_branch(api, people, units, media_user):
    song = Song.objects.create(title="Amazing Grace", lyrics=LYRICS)
    c = api(media_user)
    r = c.post("/api/media/plans/", _plan(song.pk, org_unit=str(units["BR-KONO-001"].pk)), format="json")
    assert r.status_code == 201, r.data
    assert r.data["item_count"] == 4 and r.data["items"][1]["ref"] == "John 3:16-18"
    # cannot create for another branch
    other = c.post("/api/media/plans/", _plan(song.pk, org_unit=str(units["BR-BO-001"].pk)), format="json")
    assert other.status_code == 403
    # the Bo pastor does not see the Koidu plan; the Koidu pastor does
    assert api(people["pastor_bo"]).get("/api/media/plans/").data["count"] == 0
    assert api(people["pastor_koidu"]).get("/api/media/plans/").data["count"] == 1
    # reorder items
    items = list(reversed(r.data["items"]))
    r2 = c.patch(f"/api/media/plans/{r.data['id']}/", {"items": items}, format="json")
    assert r2.status_code == 200 and r2.data["items"][0]["kind"] == "blank"
    assert ServicePlan.objects.get(pk=r.data["id"]).items[-1]["kind"] == "song"


@pytest.mark.parametrize("item,message", [
    ({"kind": "slideshow"}, "not a song"),
    ({"kind": "video"}, "video from this computer"),
    ({"kind": "video", "video": "../../etc/passwd"}, "video from this computer"),
    ({"kind": "blank", "notes": "x" * 2001}, "too long"),
    ({"kind": "scripture", "ref": "hello"}, "Bible reference"),
    ({"kind": "scripture", "ref": "John 3:16", "version": "../niv"}, "unknown Bible translation"),
    ({"kind": "song", "song": "not-a-uuid"}, "choose a song"),
    ({"kind": "song", "song": "8b0f7c55-0f55-4c51-9d55-0b9c7a3c0e11"}, "no longer in the library"),
    ({"kind": "text", "title": "", "body": ""}, "needs a title"),
])
def test_bad_plan_items_refused(api, units, media_user, item, message):
    r = api(media_user).post("/api/media/plans/", {"org_unit": str(units["BR-KONO-001"].pk), "title": "x",
                                                    "service_date": "2026-11-29", "items": [item]}, format="json")
    assert r.status_code == 400 and message in str(r.data["items"])


def test_video_camera_and_notes_items(api, units, media_user):
    items = [
        {"kind": "video", "video": "v_k3j9x2", "name": "Sermon clip.mp4", "loop": 1, "notes": "  Play before the sermon "},
        {"kind": "camera", "label": "Pulpit camera", "notes": "Preacher on screen"},
        {"kind": "blank", "notes": "   "},
    ]
    theme = {"preset": "night", "background_video": "v_bg01", "background_video_name": "Water loop.mp4"}
    r = api(media_user).post("/api/media/plans/", {"org_unit": str(units["BR-KONO-001"].pk), "title": "x",
                                                    "service_date": "2026-11-29", "items": items, "theme": theme},
                             format="json")
    assert r.status_code == 201, r.data
    video, camera, blank = r.data["items"]
    assert video == {"kind": "video", "key": "1", "video": "v_k3j9x2", "name": "Sermon clip.mp4", "loop": True,
                     "notes": "Play before the sermon"}
    assert camera == {"kind": "camera", "key": "2", "label": "Pulpit camera", "notes": "Preacher on screen"}
    assert "notes" not in blank
    assert r.data["theme"]["background_video"] == "v_bg01"
    bad = api(media_user).post("/api/media/plans/", {"org_unit": str(units["BR-KONO-001"].pk), "title": "x",
                                                      "service_date": "2026-11-29",
                                                      "theme": {"background_video": "https://x.example/v.mp4"}},
                               format="json")
    assert bad.status_code == 400 and "background video" in str(bad.data["theme"])


def test_scripture_translation_choice(api, units, media_user):
    items = [{"kind": "scripture", "ref": "Psalm 23", "version": "bsb"},
             {"kind": "scripture", "ref": "John 3:16", "version": "local-niv"},
             {"kind": "scripture", "ref": "Romans 8:28"}]
    r = api(media_user).post("/api/media/plans/", {"org_unit": str(units["BR-KONO-001"].pk), "title": "x",
                                                    "service_date": "2026-11-29", "items": items,
                                                    "theme": {"bible": "asv"}}, format="json")
    assert r.status_code == 201, r.data
    assert [i.get("version") for i in r.data["items"]] == ["bsb", "local-niv", None]
    assert r.data["theme"]["bible"] == "asv"
    bad = api(media_user).post("/api/media/plans/", {"org_unit": str(units["BR-KONO-001"].pk), "title": "x",
                                                      "service_date": "2026-11-29", "theme": {"bible": "NIV 2011!"}},
                               format="json")
    assert bad.status_code == 400 and "translation" in str(bad.data["theme"])


def test_unknown_theme_keys_refused(api, units, media_user):
    r = api(media_user).post("/api/media/plans/", {"org_unit": str(units["BR-KONO-001"].pk), "title": "x",
                                                    "service_date": "2026-11-29", "theme": {"script": "x"}},
                             format="json")
    assert r.status_code == 400 and "theme" in r.data


def test_migration_adds_media_permissions_to_existing_roles(seeded):
    import importlib

    from django.apps import apps as django_apps

    grant = importlib.import_module("apps.presentation.migrations.0002_media_permissions").grant
    pastor = Role.objects.get(code="branch_pastor")
    pastor.permissions.remove(*pastor.permissions.filter(module="media"))
    before = pastor.permissions.count()
    grant(django_apps, None)
    assert pastor.permissions.filter(code="media.edit").exists()
    assert pastor.permissions.count() == before + 7
    assert not pastor.permissions.filter(code="media.approve").exists()
