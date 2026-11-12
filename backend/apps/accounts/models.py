"""Users, roles, permissions and jurisdiction-bound role assignments."""
import hashlib
import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.db.models import Q
from django.utils import timezone

from apps.core.models import BaseModel


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, username, email, password, **extra):
        if not username:
            raise ValueError("A username is required.")
        if not email:
            raise ValueError("An email address is required.")
        email = self.normalize_email(email).lower()
        user = self.model(username=username.lower(), email=email, **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, username, email, password=None, **extra):
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create_user(username, email, password, **extra)

    def create_superuser(self, username, email, password=None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        return self._create_user(username, email, password, **extra)

    def get_by_natural_key(self, username):
        return self.get(Q(username__iexact=username) | Q(email__iexact=username))


class User(AbstractBaseUser, PermissionsMixin):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        SUSPENDED = "suspended", "Suspended"
        DEACTIVATED = "deactivated", "Deactivated"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    username = models.CharField(max_length=150, unique=True)
    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=200)
    phone = models.CharField(max_length=40, blank=True, default="")
    title = models.CharField(max_length=60, blank=True, default="", help_text="e.g. Rev., Pastor, Bishop, Deacon")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.ACTIVE, db_index=True)
    status_reason = models.TextField(blank=True, default="")
    is_staff = models.BooleanField(default=False, help_text="May log into the Django admin site (emergency use).")
    must_change_password = models.BooleanField(default=False)
    failed_login_count = models.PositiveSmallIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    password_changed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT, related_name="+")

    objects = UserManager()

    USERNAME_FIELD = "username"
    EMAIL_FIELD = "email"
    REQUIRED_FIELDS = ["email", "full_name"]

    class Meta:
        ordering = ["full_name"]

    def __str__(self):
        return self.full_name or self.username

    @property
    def is_active(self):
        return self.status == self.Status.ACTIVE

    @property
    def is_locked(self):
        return bool(self.locked_until and self.locked_until > timezone.now())

    def set_password(self, raw_password):
        super().set_password(raw_password)
        self.password_changed_at = timezone.now()


class Permission(models.Model):
    """A ``module.action`` capability, e.g. ``finance.approve``."""

    code = models.CharField(max_length=80, unique=True)
    module = models.CharField(max_length=40, db_index=True)
    action = models.CharField(max_length=20)
    description = models.CharField(max_length=200, blank=True, default="")

    class Meta:
        ordering = ["module", "action"]
        constraints = [models.UniqueConstraint(fields=["module", "action"], name="uniq_permission_module_action")]

    def __str__(self):
        return self.code


class Role(BaseModel):
    code = models.CharField(max_length=60, unique=True)
    name = models.CharField(max_length=120)
    level = models.PositiveSmallIntegerField(
        default=6, help_text="1 = System Administrator … 6 = Minister / departmental leader. Lower = more senior."
    )
    description = models.TextField(blank=True, default="")
    is_system = models.BooleanField(default=False, help_text="Built-in roles cannot be deleted.")
    is_active = models.BooleanField(default=True)
    permissions = models.ManyToManyField(Permission, blank=True, related_name="roles")

    class Meta:
        ordering = ["level", "name"]

    def __str__(self):
        return self.name


class RoleAssignmentQuerySet(models.QuerySet):
    def current(self):
        today = timezone.localdate()
        return self.filter(
            is_active=True,
            role__is_active=True,
            starts_on__lte=today,
        ).filter(Q(ends_on__isnull=True) | Q(ends_on__gte=today))


class RoleAssignment(BaseModel):
    """Grants a role to a user *within* an organisational unit (and its subtree)."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="role_assignments")
    role = models.ForeignKey(Role, on_delete=models.PROTECT, related_name="assignments")
    org_unit = models.ForeignKey("organization.OrgUnit", on_delete=models.PROTECT, related_name="role_assignments")
    department_id = models.UUIDField(
        null=True, blank=True, help_text="Restricts a departmental leader to one department (set by ministries module)."
    )
    starts_on = models.DateField(default=timezone.localdate)
    ends_on = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    granted_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    notes = models.TextField(blank=True, default="")

    objects = RoleAssignmentQuerySet.as_manager()

    class Meta:
        ordering = ["role__level", "-starts_on"]
        indexes = [models.Index(fields=["user", "is_active"])]

    def __str__(self):
        return f"{self.user} – {self.role} @ {self.org_unit.name}"


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


class PasswordResetToken(models.Model):
    """Single-use reset token. Only the SHA-256 hash is stored."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="reset_tokens")
    token_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    issued_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    @classmethod
    def issue(cls, user, issued_by=None):
        cls.objects.filter(user=user, used_at__isnull=True).update(used_at=timezone.now())
        raw = secrets.token_urlsafe(32)
        cls.objects.create(
            user=user,
            token_hash=_hash_token(raw),
            expires_at=timezone.now() + timedelta(hours=settings.PASSWORD_RESET_TOKEN_HOURS),
            issued_by=issued_by,
        )
        return raw

    @classmethod
    def consume(cls, raw):
        token = cls.objects.select_related("user").filter(token_hash=_hash_token(raw)).first()
        if not token or token.used_at or token.expires_at < timezone.now():
            return None
        token.used_at = timezone.now()
        token.save(update_fields=["used_at"])
        return token.user
