"""Ministries and departments (youth, women, men, Sunday school, choir, …).

A department belongs to one org unit. Departmental leaders get role
assignments restricted to their department (``RoleAssignment.department_id``)
so they see and manage only their own department's programs, attendance and
members, while pastors and overseers see all departments in their unit(s).
"""
from django.db import models
from django.utils import timezone

from apps.core.models import BaseModel, SoftDeleteModel


class Department(SoftDeleteModel):
    class Kind(models.TextChoices):
        YOUTH = "youth", "Youth ministry"
        WOMEN = "women", "Women's ministry"
        MEN = "men", "Men's ministry"
        CHILDREN = "children", "Children / Sunday school"
        WORSHIP = "worship", "Choir / worship"
        EVANGELISM = "evangelism", "Evangelism & missions"
        PRAYER = "prayer", "Prayer ministry"
        USHERING = "ushering", "Ushering & protocol"
        MEDIA = "media", "Media & technical"
        WELFARE = "welfare", "Welfare & benevolence"
        OTHER = "other", "Other"

    org_unit = models.ForeignKey("organization.OrgUnit", on_delete=models.PROTECT, related_name="departments")
    name = models.CharField(max_length=120)
    kind = models.CharField(max_length=12, choices=Kind.choices, default=Kind.OTHER)
    description = models.TextField(blank=True, default="")
    leader = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.PROTECT, related_name="+",
                               help_text="User account of the leader (optional)")
    leader_name = models.CharField(max_length=160, blank=True, default="")
    meeting_schedule = models.CharField(max_length=160, blank=True, default="", help_text="e.g. Saturdays 4pm")
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["org_unit__name", "name"]
        constraints = [models.UniqueConstraint(fields=["org_unit", "name"], condition=models.Q(is_deleted=False),
                                               name="department_unique_name_per_unit")]

    def __str__(self):
        return f"{self.name} ({self.org_unit.name})"


class DepartmentMember(BaseModel):
    class Role(models.TextChoices):
        MEMBER = "member", "Member"
        LEADER = "leader", "Leader"
        ASSISTANT = "assistant", "Assistant leader"
        SECRETARY = "secretary", "Secretary"
        TREASURER = "treasurer", "Treasurer"

    department = models.ForeignKey(Department, on_delete=models.PROTECT, related_name="memberships")
    member = models.ForeignKey("members.Member", on_delete=models.PROTECT, related_name="department_memberships")
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.MEMBER)
    joined_on = models.DateField(default=timezone.localdate)
    left_on = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["member__last_name", "member__first_name"]
        constraints = [models.UniqueConstraint(fields=["department", "member"], condition=models.Q(left_on__isnull=True),
                                               name="one_active_membership_per_department")]
