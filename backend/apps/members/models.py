"""Membership: one record per person for life. Transfers move the record;
they never create a second member."""
from django.core.exceptions import ValidationError
from django.db import connection, models
from django.utils import timezone

from apps.core.uploads import RandomName, document_validator, image_validator
from apps.core.models import BaseModel, SyncModel

MEMBER_NO_SEQUENCE = "cmis_member_no_seq"


def next_membership_no(prefix: str) -> str:
    with connection.cursor() as c:
        c.execute(f"SELECT nextval('{MEMBER_NO_SEQUENCE}')")
        n = c.fetchone()[0]
    return f"{prefix}-{n:06d}"


class Gender(models.TextChoices):
    MALE = "male", "Male"
    FEMALE = "female", "Female"


class Member(SyncModel):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        INACTIVE = "inactive", "Inactive"
        DECEASED = "deceased", "Deceased"
        WITHDRAWN = "withdrawn", "Withdrawn / exited"

    class Baptism(models.TextChoices):
        NOT_BAPTIZED = "not_baptized", "Not baptized"
        BAPTIZED = "baptized", "Baptized"

    class Marital(models.TextChoices):
        SINGLE = "single", "Single"
        MARRIED = "married", "Married"
        WIDOWED = "widowed", "Widowed"
        DIVORCED = "divorced", "Divorced / separated"

    membership_no = models.CharField(max_length=32, unique=True, null=True, blank=True)
    first_name = models.CharField(max_length=80)
    middle_name = models.CharField(max_length=80, blank=True, default="")
    last_name = models.CharField(max_length=80)
    gender = models.CharField(max_length=10, choices=Gender.choices)
    date_of_birth = models.DateField(null=True, blank=True)
    phone = models.CharField(max_length=40, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    address = models.TextField(blank=True, default="")
    org_unit = models.ForeignKey("organization.OrgUnit", on_delete=models.PROTECT, related_name="members",
                                 help_text="Current branch / congregation")
    joined_on = models.DateField(default=timezone.localdate)
    previous_affiliation = models.CharField(max_length=200, blank=True, default="",
                                            help_text="Only if voluntarily provided")
    category = models.ForeignKey("configuration.MembershipCategory", null=True, blank=True,
                                 on_delete=models.PROTECT, related_name="members")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.ACTIVE, db_index=True)
    baptism_status = models.CharField(max_length=14, choices=Baptism.choices, default=Baptism.NOT_BAPTIZED,
                                      db_index=True)
    baptism_date = models.DateField(null=True, blank=True)
    baptism_location = models.CharField(max_length=200, blank=True, default="")
    marital_status = models.CharField(max_length=10, choices=Marital.choices, blank=True, default="")
    occupation = models.CharField(max_length=120, blank=True, default="")
    emergency_contact_name = models.CharField(max_length=160, blank=True, default="")
    emergency_contact_phone = models.CharField(max_length=40, blank=True, default="")
    photo = models.ImageField(upload_to=RandomName("members/photos"), null=True, blank=True,
                              validators=[image_validator])
    photo_consent = models.BooleanField(default=False)
    exit_date = models.DateField(null=True, blank=True)
    exit_reason = models.TextField(blank=True, default="")
    notes = models.TextField(blank=True, default="")
    is_demo = models.BooleanField(default=False, db_index=True,
                                  help_text="Fictional demonstration record (never present in production).")
    discipleship_badge_on = models.DateField(
        null=True, blank=True, db_index=True,
        help_text="Date the badge of discipleship was earned: set automatically once all three discipleship "
                  "classes are completed.")

    class Meta:
        ordering = ["last_name", "first_name"]
        indexes = [
            models.Index(fields=["org_unit", "status"]),
            models.Index(fields=["joined_on"]),
            models.Index(fields=["last_name", "first_name"]),
        ]

    def __str__(self):
        return f"{self.full_name} ({self.membership_no or 'pending no.'})"

    @property
    def full_name(self):
        return " ".join(p for p in [self.first_name, self.middle_name, self.last_name] if p)

    @property
    def age(self):
        if not self.date_of_birth:
            return None
        today = timezone.localdate()
        dob = self.date_of_birth
        return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))

    def clean(self):
        from apps.organization.models import member_level_codes

        if self.org_unit_id and self.org_unit.unit_type not in member_level_codes():
            raise ValidationError({"org_unit": "Members belong to a branch or congregation."})
        if self.date_of_birth and self.date_of_birth > timezone.localdate():
            raise ValidationError({"date_of_birth": "Date of birth cannot be in the future."})
        if self.photo and not self.photo_consent:
            raise ValidationError({"photo": "A photograph may only be stored with the member's consent."})

    def save(self, *args, **kwargs):
        if not self.membership_no:
            from apps.configuration.models import SystemSetting

            self.membership_no = next_membership_no(SystemSetting.get().membership_number_prefix)
        super().save(*args, **kwargs)


class MembershipHistory(BaseModel):
    class Event(models.TextChoices):
        REGISTERED = "registered"
        UPDATED = "updated"
        CATEGORY_CHANGED = "category_changed"
        STATUS_CHANGED = "status_changed"
        TRANSFER_REQUESTED = "transfer_requested"
        TRANSFERRED = "transferred"
        BAPTIZED = "baptized"
        EXITED = "exited"
        DEPARTMENT_JOINED = "department_joined"
        DEPARTMENT_LEFT = "department_left"
        CLASS_COMPLETED = "class_completed"
        CLASS_REMOVED = "class_removed"
        BADGE_AWARDED = "badge_awarded"
        BADGE_REVOKED = "badge_revoked"

    member = models.ForeignKey(Member, on_delete=models.PROTECT, related_name="history")
    event = models.CharField(max_length=24, choices=Event.choices, db_index=True)
    changes = models.JSONField(default=dict, blank=True)
    effective_date = models.DateField(default=timezone.localdate)
    org_unit = models.ForeignKey("organization.OrgUnit", on_delete=models.PROTECT, related_name="+")
    note = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-created_at"]
        verbose_name_plural = "membership history"


class BaptismRecord(SyncModel):
    member = models.ForeignKey(Member, on_delete=models.PROTECT, related_name="baptisms")
    org_unit = models.ForeignKey("organization.OrgUnit", on_delete=models.PROTECT, related_name="baptisms")
    date = models.DateField()
    location = models.CharField(max_length=200, blank=True, default="")
    officiated_by = models.CharField(max_length=160, blank=True, default="")
    certificate_no = models.CharField(max_length=60, blank=True, default="")
    notes = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-date"]


class MemberTransfer(SyncModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending approval"
        COMPLETED = "completed", "Completed"
        REJECTED = "rejected", "Rejected"
        CANCELLED = "cancelled", "Cancelled"

    member = models.ForeignKey(Member, on_delete=models.PROTECT, related_name="transfers")
    org_unit = models.ForeignKey("organization.OrgUnit", on_delete=models.PROTECT, related_name="transfers_out",
                                 help_text="Sending branch")
    to_unit = models.ForeignKey("organization.OrgUnit", on_delete=models.PROTECT, related_name="transfers_in")
    reason = models.TextField(blank=True, default="")
    effective_date = models.DateField(default=timezone.localdate)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING, db_index=True)
    decided_by = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["member"], condition=models.Q(status="pending", is_deleted=False),
                                    name="one_pending_transfer_per_member"),
        ]


class DiscipleshipClass(models.TextChoices):
    """The three classes of the discipleship pathway, in the order they are normally taken."""
    FOUNDATION = "foundation", "Foundation Class"
    DISCIPLESHIP = "discipleship", "Discipleship Class"
    SPIRITUAL_GROWTH = "spiritual_growth", "Spiritual Growth Class"


class DiscipleshipCompletion(SyncModel):
    """One row per member per class completed. Completing all three earns the badge of discipleship."""

    member = models.ForeignKey(Member, on_delete=models.PROTECT, related_name="discipleship_completions")
    org_unit = models.ForeignKey("organization.OrgUnit", on_delete=models.PROTECT, related_name="+",
                                 help_text="Branch where the class was completed")
    course = models.CharField(max_length=20, choices=DiscipleshipClass.choices, db_index=True)
    completed_on = models.DateField()
    facilitator = models.CharField(max_length=160, blank=True, default="")
    certificate_no = models.CharField(max_length=60, blank=True, default="")
    notes = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["member", "completed_on"]
        constraints = [
            models.UniqueConstraint(fields=["member", "course"], condition=models.Q(is_deleted=False),
                                    name="one_completion_per_member_per_class"),
        ]

    def __str__(self):
        return f"{self.member.full_name}: {self.get_course_display()} ({self.completed_on})"
