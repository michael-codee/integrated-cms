"""Media & presentation: what the media team puts on the screens during service.

* ``Song``        – a church-wide song library (lyrics in plain text; a blank line starts a new slide,
                    a line such as ``[Chorus]`` starts a new section).
* ``MediaImage``  – church-wide images used as backgrounds or as picture slides.
* ``ServicePlan`` – the order of service for one meeting of one unit: an ordered list of items
                    (songs, scripture passages, text slides, pictures, blank screens) and a look (theme).

Scripture text itself is not stored here: the public-domain translations ship with the web app as
static files so they work without a connection.

* ``RemoteSession`` / ``RemoteCommand`` / ``RemoteSignal`` – a phone paired with a control desk as a
                    remote, and the set-up messages for sending its camera to the screens.
"""
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.core.models import SoftDeleteModel
from apps.core.uploads import RandomName, image_validator


class Song(SoftDeleteModel):
    title = models.CharField(max_length=200)
    alternate_title = models.CharField(max_length=200, blank=True, default="",
                                       help_text="First line or other name people know the song by")
    author = models.CharField(max_length=200, blank=True, default="")
    copyright = models.CharField(max_length=200, blank=True, default="")
    language = models.CharField(max_length=40, blank=True, default="English")
    song_key = models.CharField("key", max_length=10, blank=True, default="")
    tags = models.CharField(max_length=200, blank=True, default="", help_text="Comma-separated, e.g. praise, worship")
    lyrics = models.TextField(help_text="A blank line starts a new slide; a line like [Chorus] names a section.")

    class Meta:
        ordering = ["title"]

    def __str__(self):
        return self.title


class MediaImage(SoftDeleteModel):
    class Kind(models.TextChoices):
        BACKGROUND = "background", "Background"
        SLIDE = "slide", "Picture slide"

    title = models.CharField(max_length=160)
    kind = models.CharField(max_length=12, choices=Kind.choices, default=Kind.BACKGROUND)
    image = models.ImageField(upload_to=RandomName("presentation"), validators=[image_validator], max_length=200)

    class Meta:
        ordering = ["title"]

    def __str__(self):
        return self.title


class ServicePlan(SoftDeleteModel):
    org_unit = models.ForeignKey("organization.OrgUnit", on_delete=models.PROTECT, related_name="service_plans")
    title = models.CharField(max_length=160)
    service_date = models.DateField()
    service_type = models.ForeignKey("configuration.ServiceType", null=True, blank=True, on_delete=models.PROTECT,
                                     related_name="+")
    items = models.JSONField(default=list, blank=True)
    theme = models.JSONField(default=dict, blank=True)
    notes = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-service_date", "title"]
        indexes = [models.Index(fields=["org_unit", "service_date"])]

    def __str__(self):
        return f"{self.title} ({self.service_date})"


class RemoteSession(models.Model):
    """A phone remote paired with one control desk.

    The desk opens a session and shows a QR code holding a random token. A phone that opens that
    link can send button presses (next, back, black …) and read what is on screen, nothing else:
    no sign-in on the phone, no access to church records. Only a hash of the token is stored. The
    desk collects the presses when it polls and applies them itself, so the screens still change
    only through the desk on the media computer.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    token_hash = models.CharField(max_length=64, unique=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)
    # What the desk last published for the phone (titles and words on screen, never church records).
    state = models.JSONField(default=dict, blank=True)
    desk_seen_at = models.DateTimeField(null=True, blank=True)
    phone_seen_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["expires_at"])]

    def __str__(self):
        return f"Phone remote {self.id}"

    @property
    def is_active(self):
        return self.ended_at is None and self.expires_at > timezone.now()


class RemoteCommand(models.Model):
    """One button press from the phone, waiting for the desk to pick it up."""

    id = models.BigAutoField(primary_key=True)
    session = models.ForeignKey(RemoteSession, on_delete=models.CASCADE, related_name="commands")
    action = models.CharField(max_length=20)
    value = models.IntegerField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["id"]


class RemoteSignal(models.Model):
    """WebRTC set-up messages between the phone and the desk (offer, answer, hang-up).

    The picture itself goes straight from the phone to the media computer over the church Wi-Fi
    (or through the internet when they are on different networks); only these short messages
    pass through the server.
    """

    class Sender(models.TextChoices):
        PHONE = "phone", "Phone"
        DESK = "desk", "Desk"

    id = models.BigAutoField(primary_key=True)
    session = models.ForeignKey(RemoteSession, on_delete=models.CASCADE, related_name="signals")
    sender = models.CharField(max_length=5, choices=Sender.choices)
    kind = models.CharField(max_length=10)
    payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["id"]
