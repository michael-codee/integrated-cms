"""Media & presentation: what the media team puts on the screens during service.

* ``Song``        – a church-wide song library (lyrics in plain text; a blank line starts a new slide,
                    a line such as ``[Chorus]`` starts a new section).
* ``MediaImage``  – church-wide images used as backgrounds or as picture slides.
* ``ServicePlan`` – the order of service for one meeting of one unit: an ordered list of items
                    (songs, scripture passages, text slides, pictures, blank screens) and a look (theme).

Scripture text itself is not stored here: the King James Version ships with the web app as a
static file so it works without a connection.
"""
from django.db import models

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
