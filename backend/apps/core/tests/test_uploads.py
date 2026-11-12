import io

import pytest
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.core.uploads import RandomName, document_validator, image_validator

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
PDF = b"%PDF-1.7\n" + b"0" * 64


def f(name, content):
    return SimpleUploadedFile(name, content)


def test_accepts_genuine_files():
    image_validator(f("photo.png", PNG))
    document_validator(f("receipt.pdf", PDF))
    document_validator(f("notes.txt", b"Offering count sheet\n"))


@pytest.mark.parametrize("name,content", [
    ("photo.png", b"MZ\x90\x00 not really a png"),     # disguised executable
    ("invoice.pdf", b"<html><script>alert(1)</script>"),  # html renamed to pdf
    ("logo.svg", b"<svg></svg>"),                     # svg never accepted
    ("tool.exe", b"MZ\x90\x00"),
    ("page.html", b"<html></html>"),
])
def test_rejects_unsafe_files(name, content):
    with pytest.raises(ValidationError):
        document_validator(f(name, content)) if not name.endswith(".png") else image_validator(f(name, content))


def test_rejects_oversize():
    with pytest.raises(ValidationError):
        image_validator(f("big.png", PNG + b"0" * (6 * 1024 * 1024)))


def test_random_names_hide_user_filename():
    path = RandomName("members/photos")(None, "../../etc/passwd John Doe.PNG")
    assert path.startswith("members/photos/") and path.endswith(".png") and "passwd" not in path and ".." not in path


@pytest.mark.django_db
def test_api_rejects_disguised_attachment(api, people, units):
    from apps.configuration.models import FinanceCategory
    from apps.finance.models import Account

    acct = Account.objects.create(org_unit=units["BR-KONO-001"], name="Cash")
    cat = FinanceCategory.objects.get(code="tithes")
    r = api(people["treasurer_koidu"]).post("/api/finance/transactions/", {
        "kind": "income", "account": str(acct.pk), "category": str(cat.pk), "amount": "10",
        "attachment": SimpleUploadedFile("receipt.pdf", b"<html>bad</html>", content_type="application/pdf")},
        format="multipart")
    assert r.status_code == 400 and "attachment" in r.data
