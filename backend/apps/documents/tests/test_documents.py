import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.audit.models import AuditLog
from apps.configuration.models import DocumentCategory
from apps.documents.models import Document, DocumentVersion

pytestmark = pytest.mark.django_db

PDF = b"%PDF-1.4\n%fake test pdf\n"


@pytest.fixture(autouse=True)
def private_root(settings, tmp_path):
    settings.PRIVATE_MEDIA_ROOT = tmp_path / "private"
    settings.MEDIA_ROOT = tmp_path / "media"
    from django.utils.functional import empty

    from apps.documents.models import private_storage

    private_storage._wrapped = empty  # re-create the lazy storage at the temporary location
    return tmp_path


def upload(api, user, unit, name="minutes.pdf", content=PDF, **extra):
    cat = DocumentCategory.objects.first()
    data = {"title": "Church council minutes", "category": str(cat.pk), "org_unit": str(unit.pk),
            "file": SimpleUploadedFile(name, content, content_type="application/pdf"), **extra}
    return api(user).post("/api/documents/", data, format="multipart")


def test_upload_version_and_download(api, people, units, private_root):
    r = upload(api, people["pastor_koidu"], units["BR-KONO-001"])
    assert r.status_code == 201, r.data
    doc = Document.objects.get(pk=r.data["id"])
    v1 = doc.current_version
    assert v1.number == 1 and v1.original_name == "minutes.pdf" and len(v1.sha256) == 64
    # stored privately under a random name, outside the public media root
    assert str(private_root / "private") in v1.file.path and "minutes" not in v1.file.name
    c = api(people["pastor_koidu"])
    r = c.post(f"/api/documents/{doc.pk}/upload-version/", {"file": SimpleUploadedFile("minutes-v2.pdf", PDF + b"v2"),
                                                            "notes": "Signed copy"}, format="multipart")
    assert r.status_code == 201 and r.data["number"] == 2
    assert [v["number"] for v in c.get(f"/api/documents/{doc.pk}/versions/").data] == [2, 1]
    dl = c.get(f"/api/documents/{doc.pk}/download/?version=1")
    assert dl.status_code == 200 and b"".join(dl.streaming_content) == PDF
    assert "minutes.pdf" in dl["Content-Disposition"]
    assert AuditLog.objects.filter(action=AuditLog.Action.EXPORT, entity_id=str(doc.pk)).exists()
    # replacing the file on the document itself is not allowed; versions are append-only
    assert c.patch(f"/api/documents/{doc.pk}/", {"file": SimpleUploadedFile("x.pdf", PDF)},
                   format="multipart").status_code == 400
    assert DocumentVersion.objects.filter(document=doc).count() == 2


def test_unsafe_files_refused(api, people, units):
    assert upload(api, people["pastor_koidu"], units["BR-KONO-001"], name="evil.pdf",
                  content=b"MZ\x90\x00 not a pdf").status_code == 400
    assert upload(api, people["pastor_koidu"], units["BR-KONO-001"], name="page.html",
                  content=b"<html></html>").status_code == 400


def test_jurisdiction_and_restricted_access(api, people, units):
    internal = upload(api, people["pastor_koidu"], units["BR-KONO-001"]).data["id"]
    restricted = upload(api, people["pastor_koidu"], units["BR-KONO-001"], title="Title deed",
                        access="restricted").data["id"]
    assert upload(api, people["pastor_koidu"], units["BR-BO-001"]).status_code == 403
    assert api(people["pastor_bo"]).get(f"/api/documents/{internal}/download/").status_code == 404
    # district overseer may view documents but not edit them: sees internal, not restricted
    seen = {d["id"] for d in api(people["kono"]).get("/api/documents/").data["results"]}
    assert internal in seen and restricted not in seen
    assert api(people["kono"]).get(f"/api/documents/{restricted}/download/").status_code == 404
    assert api(people["pastor_koidu"]).get(f"/api/documents/{restricted}/download/").status_code == 200
    # treasurer has no documents permission
    assert api(people["treasurer_koidu"]).get("/api/documents/").status_code == 403
