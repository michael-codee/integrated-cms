"""
Organisational hierarchy.

Every church structure — national headquarters, regions, districts,
branches and congregations — is an ``OrgUnit`` row in one tree. The
materialised ``path`` (``/<hq>/<region>/<district>/<branch>/``) makes
jurisdiction checks a single indexed ``LIKE 'prefix%'`` query.
"""
import uuid

from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.db.models import F, Value
from django.db.models.functions import Concat, Substr

from apps.core.models import BaseModel, SyncModel


class UnitType(models.TextChoices):
    HEADQUARTERS = "headquarters", "Headquarters"
    REGION = "region", "Region"
    DISTRICT = "district", "District"
    BRANCH = "branch", "Branch"
    CONGREGATION = "congregation", "Congregation / Assembly"


UNIT_RANK = {
    UnitType.HEADQUARTERS: 0,
    UnitType.REGION: 1,
    UnitType.DISTRICT: 2,
    UnitType.BRANCH: 3,
    UnitType.CONGREGATION: 4,
}


class OrgUnit(SyncModel):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        INACTIVE = "inactive", "Inactive"
        PLANNED = "planned", "Planned / expansion"

    code = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=200)
    unit_type = models.CharField(max_length=20, choices=UnitType.choices, db_index=True)
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT, related_name="children")
    path = models.CharField(max_length=600, unique=True, editable=False, db_index=True)
    depth = models.PositiveSmallIntegerField(default=0, editable=False)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.ACTIVE, db_index=True)
    established_on = models.DateField(null=True, blank=True)

    # civil geography (church districts need not match government districts)
    country = models.CharField(max_length=80, default="Sierra Leone")
    province = models.CharField(max_length=80, blank=True, default="")
    civil_district = models.CharField(max_length=80, blank=True, default="")
    chiefdom = models.CharField(max_length=120, blank=True, default="")
    town = models.CharField(max_length=120, blank=True, default="")
    address = models.TextField(blank=True, default="")
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)

    phone = models.CharField(max_length=40, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    notes = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["path"]
        indexes = [models.Index(fields=["unit_type", "status"])]

    def __str__(self):
        return f"{self.name} ({self.code})"

    # ------------------------------------------------------------------ tree
    @property
    def rank(self):
        return UNIT_RANK[self.unit_type]

    def compute_path(self):
        base = self.parent.path if self.parent_id else "/"
        return f"{base}{self.id.hex}/"

    def clean(self):
        if self.unit_type == UnitType.HEADQUARTERS:
            if self.parent_id:
                raise ValidationError({"parent": "Headquarters cannot have a parent unit."})
            qs = OrgUnit.all_objects.filter(unit_type=UnitType.HEADQUARTERS).exclude(pk=self.pk)
            if qs.exists():
                raise ValidationError({"unit_type": "Only one national headquarters can exist."})
            return
        if not self.parent_id:
            raise ValidationError({"parent": "This unit must belong to a parent unit."})
        if UNIT_RANK[self.parent.unit_type] >= UNIT_RANK[self.unit_type]:
            raise ValidationError(
                {"parent": f"A {self.get_unit_type_display()} cannot be placed under a {self.parent.get_unit_type_display()}."}
            )
        if not self._state.adding and self.parent.path.startswith(self.path_before_change or self.path):
            raise ValidationError({"parent": "A unit cannot be moved under itself or one of its descendants."})

    path_before_change = None

    @classmethod
    def from_db(cls, db, field_names, values):
        instance = super().from_db(db, field_names, values)
        instance.path_before_change = instance.__dict__.get("path")
        return instance

    @transaction.atomic
    def save(self, *args, **kwargs):
        if not self.id:
            self.id = uuid.uuid4()
        old_path = self.path_before_change
        self.path = self.compute_path()
        self.depth = self.path.count("/") - 2
        super().save(*args, **kwargs)
        if old_path and old_path != self.path:
            # Move the whole subtree.
            depth_shift = self.path.count("/") - old_path.count("/")
            OrgUnit.all_objects.filter(path__startswith=old_path).exclude(pk=self.pk).update(
                path=Concat(Value(self.path), Substr("path", len(old_path) + 1)),
                depth=F("depth") + depth_shift,
            )
        self.path_before_change = self.path

    def ancestor_ids(self):
        return [uuid.UUID(seg) for seg in self.path.strip("/").split("/")]

    def ancestors(self, include_self=True):
        ids = self.ancestor_ids()
        if not include_self:
            ids = ids[:-1]
        return OrgUnit.objects.filter(id__in=ids).order_by("depth")

    def ancestor_of_type(self, unit_type):
        if self.unit_type == unit_type:
            return self
        return self.ancestors(include_self=False).filter(unit_type=unit_type).first()

    def descendants(self, include_self=False):
        qs = OrgUnit.objects.filter(path__startswith=self.path)
        return qs if include_self else qs.exclude(pk=self.pk)

    def is_within(self, other):
        return self.path.startswith(other.path)


class OrgUnitHistory(BaseModel):
    class Event(models.TextChoices):
        CREATED = "created"
        UPDATED = "updated"
        MOVED = "moved"
        ACTIVATED = "activated"
        DEACTIVATED = "deactivated"
        LEADER_ASSIGNED = "leader_assigned"
        LEADER_ENDED = "leader_ended"

    org_unit = models.ForeignKey(OrgUnit, on_delete=models.PROTECT, related_name="history")
    event = models.CharField(max_length=24, choices=Event.choices)
    changes = models.JSONField(default=dict, blank=True)
    note = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-created_at"]
