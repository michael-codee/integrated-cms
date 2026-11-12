import time

import pytest
from django.core import signing
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.test import Client

from apps.core.files import SALT, signed_url

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture
def stored(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    name = default_storage.save("members/photos/abc.png", ContentFile(PNG))
    yield name


@pytest.mark.django_db
def test_signed_link_serves_file(stored):
    r = Client().get(signed_url(stored))
    assert r.status_code == 200 and b"".join(r.streaming_content) == PNG
    assert r["X-Content-Type-Options"] == "nosniff" and "sandbox" in r["Content-Security-Policy"]


@pytest.mark.django_db
def test_tampered_expired_and_traversal_links_refused(stored):
    url = signed_url(stored)
    assert Client().get(url[:-3] + "xx/").status_code == 404
    expired = signing.dumps({"n": stored, "e": int(time.time()) - 1}, salt=SALT, compress=True)
    assert Client().get(f"/api/files/{expired}/").status_code == 404
    escape = signing.dumps({"n": "../settings.py", "e": int(time.time()) + 60}, salt=SALT, compress=True)
    assert Client().get(f"/api/files/{escape}/").status_code == 404


def test_media_is_not_served_directly():
    assert Client().get("/media/members/photos/abc.png").status_code == 404


@pytest.mark.django_db
def test_member_photo_returned_as_signed_link(api, people, units, stored):
    from apps.members.models import Member

    m = Member.objects.create(org_unit=units["BR-KONO-001"], first_name="Ama", last_name="Kamara", gender="female",
                              photo_consent=True, photo=stored)
    r = api(people["admin"]).get(f"/api/members/{m.pk}/")
    assert r.status_code == 200 and "/api/files/" in r.data["photo"] and "/media/" not in r.data["photo"]
