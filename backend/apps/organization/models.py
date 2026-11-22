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
from django.utils import timezone

from apps.core.models import BaseModel, SyncModel


class UnitType(models.TextChoices):
    """Codes of the levels installed by default. The structure itself is
    defined by the administrator as ``StructureLevel`` rows; only
    ``headquarters`` (the root) and ``branch`` are fixed system levels."""

    HEADQUARTERS = "headquarters", "Headquarters"
    REGION = "region", "Region"
    DISTRICT = "district", "District"
    BRANCH = "branch", "Branch"
    CONGREGATION = "congregation", "Congregation / Assembly"


ROOT_LEVEL = UnitType.HEADQUARTERS
SYSTEM_LEVELS = {UnitType.HEADQUARTERS, UnitType.BRANCH}

# (code, name, plural, rank, prefix, holds_members, icon)
DEFAULT_LEVELS = [
    ("headquarters", "Headquarters", "Headquarters", 0, "HQ", False, "landmark"),
    ("region", "Region", "Regions", 10, "RG", False, "globe"),
    ("district", "District", "Districts", 20, "DT", False, "building2"),
    ("branch", "Branch", "Branches", 30, "BR", True, "church"),
    ("congregation", "Congregation / Assembly", "Congregations", 40, "CG", True, "building"),
]


class StructureLevel(BaseModel):
    """One level of the church hierarchy (e.g. Region, District, Branch),
    defined by the administrator. A unit may only sit under a unit of a
    level with a lower ``rank``."""

    code = models.SlugField(max_length=20, unique=True, help_text="Fixed once created, e.g. 'zone'.")
    name = models.CharField(max_length=80)
    plural_name = models.CharField(max_length=80, blank=True, default="")
    rank = models.PositiveSmallIntegerField(help_text="Position in the hierarchy; lower is higher up.")
    code_prefix = models.CharField(max_length=4, help_text="Prefix for generated unit codes, e.g. 'ZN'.")
    holds_members = models.BooleanField(default=False, help_text="Members are registered directly at this level.")
    icon = models.CharField(max_length=20, blank=True, default="building")
    description = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True, help_text="Inactive levels cannot receive new units.")

    class Meta:
        ordering = ["rank", "name"]

    def __str__(self):
        return self.name

    @property
    def is_system(self):
        return self.code in SYSTEM_LEVELS


def levels_by_code():
    return {lvl.code: lvl for lvl in StructureLevel.objects.all()}


def level_rank(code):
    lvl = StructureLevel.objects.filter(code=code).only("rank").first()
    if lvl is None:
        raise ValidationError({"unit_type": f"Unknown structure level '{code}'."})
    return lvl.rank


def level_name(code):
    lvl = StructureLevel.objects.filter(code=code).only("name").first()
    return lvl.name if lvl else (code or "").replace("_", " ").title()


def member_level_codes():
    """Levels at which members can be registered (branches, congregations…)."""
    return list(StructureLevel.objects.filter(holds_members=True).values_list("code", flat=True))


def seed_levels():
    for code, name, plural, rank, prefix, members, icon in DEFAULT_LEVELS:
        StructureLevel.objects.get_or_create(code=code, defaults={
            "name": name, "plural_name": plural, "rank": rank, "code_prefix": prefix,
            "holds_members": members, "icon": icon})


class OrgUnit(SyncModel):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        INACTIVE = "inactive", "Inactive"
        PLANNED = "planned", "Planned / expansion"

    code = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=200)
    unit_type = models.CharField(max_length=20, db_index=True, help_text="Code of the StructureLevel.")
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
        return level_rank(self.unit_type)

    @property
    def level(self):
        return StructureLevel.objects.filter(code=self.unit_type).first()

    def get_unit_type_display(self):
        return level_name(self.unit_type)

    def compute_path(self):
        base = self.parent.path if self.parent_id else "/"
        return f"{base}{self.id.hex}/"

    def clean(self):
        level = StructureLevel.objects.filter(code=self.unit_type).first()
        if level is None:
            raise ValidationError({"unit_type": "Choose a level defined in the church structure."})
        changed_level = self._state.adding or OrgUnit.all_objects.filter(pk=self.pk).exclude(
            unit_type=self.unit_type).exists()
        if not level.is_active and changed_level:
            raise ValidationError({"unit_type": f"The {level.name} level is no longer in use."})
        if self.unit_type == UnitType.HEADQUARTERS:
            if self.parent_id:
                raise ValidationError({"parent": "Headquarters cannot have a parent unit."})
            qs = OrgUnit.all_objects.filter(unit_type=UnitType.HEADQUARTERS).exclude(pk=self.pk)
            if qs.exists():
                raise ValidationError({"unit_type": "Only one national headquarters can exist."})
            return
        if not self.parent_id:
            raise ValidationError({"parent": "This unit must belong to a parent unit."})
        if level_rank(self.parent.unit_type) >= level.rank:
            raise ValidationError(
                {"parent": f"A {level.name} cannot be placed under a {self.parent.get_unit_type_display()}."}
            )
        if not self._state.adding:
            below = OrgUnit.objects.filter(parent_id=self.pk).values_list("unit_type", flat=True).distinct()
            ranks = dict(StructureLevel.objects.filter(code__in=list(below)).values_list("code", "rank"))
            clash = [c for c, r in ranks.items() if r <= level.rank]
            if clash:
                raise ValidationError({"unit_type": f"Units below this one are at the {level_name(clash[0])} "
                                                    f"level, which is not below {level.name}."})
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
        REMOVED = "removed"
        LEADER_ASSIGNED = "leader_assigned"
        LEADER_ENDED = "leader_ended"

    org_unit = models.ForeignKey(OrgUnit, on_delete=models.PROTECT, related_name="history")
    event = models.CharField(max_length=24, choices=Event.choices)
    changes = models.JSONField(default=dict, blank=True)
    note = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-created_at"]


class LeadershipPosition(BaseModel):
    """An office such as Pastor-in-Charge or District Overseer. Optionally
    grants a system role to the appointee for the unit they lead."""

    code = models.SlugField(max_length=60, unique=True)
    title = models.CharField(max_length=120)
    unit_type = models.CharField(max_length=20, blank=True, default="",
                                 help_text="Structure level code this position applies to (blank = any).")
    grants_role = models.ForeignKey("accounts.Role", null=True, blank=True, on_delete=models.PROTECT,
                                    related_name="positions")
    is_head = models.BooleanField(default=False, help_text="Leader-in-charge of the unit (one at a time).")
    sort_order = models.PositiveSmallIntegerField(default=100)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["sort_order", "title"]

    def __str__(self):
        return self.title

    def get_unit_type_display(self):
        return level_name(self.unit_type) if self.unit_type else "Any level"


class LeadershipAppointment(SyncModel):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        ENDED = "ended", "Ended"

    position = models.ForeignKey(LeadershipPosition, on_delete=models.PROTECT, related_name="appointments")
    org_unit = models.ForeignKey(OrgUnit, on_delete=models.PROTECT, related_name="appointments")
    user = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.PROTECT,
                             related_name="appointments")
    member = models.ForeignKey("members.Member", null=True, blank=True, on_delete=models.PROTECT,
                               related_name="appointments")
    person_name = models.CharField(max_length=200, help_text="Name of the appointee as it appears on the letter.")
    starts_on = models.DateField(default=timezone.localdate)
    ends_on = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.ACTIVE, db_index=True)
    appointed_by = models.CharField(max_length=200, blank=True, default="",
                                    help_text="Authorising officer, e.g. the General Overseer.")
    role_assignment = models.OneToOneField("accounts.RoleAssignment", null=True, blank=True,
                                           on_delete=models.SET_NULL, related_name="appointment")
    end_reason = models.TextField(blank=True, default="")
    notes = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-starts_on"]

    def __str__(self):
        return f"{self.position} – {self.person_name} ({self.org_unit.name})"
