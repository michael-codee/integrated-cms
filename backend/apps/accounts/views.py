import logging

from django.conf import settings
from django.contrib.auth import password_validation
from django.contrib.auth.hashers import make_password
from django.core.mail import send_mail
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from django.utils.decorators import method_decorator
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit import services as audit
from apps.audit.models import AuditLog
from apps.core import scoping
from apps.core.views import ModulePermission, ScopedViewMixin
from apps.organization.models import OrgUnit

from .signals import account_created
from .models import PasswordResetToken, Permission, Role, RoleAssignment, User
from .serializers import (
    ChangePasswordSerializer,
    LoginSerializer,
    MeSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    PermissionSerializer,
    RoleAssignmentSerializer,
    RoleSerializer,
    StatusChangeSerializer,
    UserSerializer,
)
from .throttles import LoginThrottle, PasswordResetThrottle

logger = logging.getLogger("cmis.auth")
_DUMMY_HASH = make_password("timing-equaliser-password")


def _set_refresh_cookie(response, refresh):
    response.set_cookie(
        settings.REFRESH_COOKIE_NAME,
        str(refresh),
        max_age=int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds()),
        httponly=True,
        secure=settings.REFRESH_COOKIE_SECURE,
        samesite=settings.REFRESH_COOKIE_SAMESITE,
        path=settings.REFRESH_COOKIE_PATH,
    )


def _clear_refresh_cookie(response):
    response.delete_cookie(settings.REFRESH_COOKIE_NAME, path=settings.REFRESH_COOKIE_PATH,
                           samesite=settings.REFRESH_COOKIE_SAMESITE)


def _require_client_header(request):
    # A custom header cannot be sent cross-site without a CORS preflight, which
    # protects the cookie-authenticated refresh/logout endpoints from CSRF.
    if request.META.get("HTTP_X_CMIS_CLIENT") is None:
        raise PermissionDenied("Missing X-CMIS-Client header.")


@method_decorator(transaction.non_atomic_requests, name="dispatch")
class LoginView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = [LoginThrottle]

    @extend_schema(request=LoginSerializer, responses={200: MeSerializer})
    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        identifier = serializer.validated_data["username"].strip()
        password = serializer.validated_data["password"]
        user = User.objects.filter(Q(username__iexact=identifier) | Q(email__iexact=identifier)).first()
        generic = Response({"detail": "Invalid username or password."}, status=status.HTTP_401_UNAUTHORIZED)

        if user is None:
            from django.contrib.auth.hashers import check_password

            check_password(password, _DUMMY_HASH)  # equalise timing
            audit.record(AuditLog.Action.LOGIN_FAILED, entity="accounts.User", message=f"Unknown user '{identifier[:80]}'")
            return generic

        if user.is_locked:
            minutes = max(1, int((user.locked_until - timezone.now()).total_seconds() // 60) + 1)
            return Response(
                {"detail": f"Too many failed attempts. The account is locked; try again in about {minutes} minute(s)."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if not user.check_password(password):
            user.failed_login_count += 1
            if user.failed_login_count >= settings.LOGIN_MAX_FAILURES:
                user.locked_until = timezone.now() + timezone.timedelta(minutes=settings.LOGIN_LOCKOUT_MINUTES)
                user.failed_login_count = 0
            user.save(update_fields=["failed_login_count", "locked_until"])
            audit.record(AuditLog.Action.LOGIN_FAILED, instance=user, actor=None, message="Wrong password")
            return generic

        if not user.is_active:
            audit.record(AuditLog.Action.LOGIN_FAILED, instance=user, actor=None, message=f"Account {user.status}")
            return Response({"detail": f"This account is {user.status}. Contact your administrator."},
                            status=status.HTTP_403_FORBIDDEN)

        user.failed_login_count = 0
        user.locked_until = None
        user.last_login = timezone.now()
        user.save(update_fields=["failed_login_count", "locked_until", "last_login"])
        refresh = RefreshToken.for_user(user)
        audit.record(AuditLog.Action.LOGIN, instance=user, actor=user)
        response = Response({"access": str(refresh.access_token), "user": MeSerializer(user).data})
        _set_refresh_cookie(response, refresh)
        return response


class RefreshView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        _require_client_header(request)
        raw = request.COOKIES.get(settings.REFRESH_COOKIE_NAME)
        if not raw:
            return Response({"detail": "Not signed in."}, status=status.HTTP_401_UNAUTHORIZED)
        try:
            old = RefreshToken(raw)
            user = User.objects.get(pk=old["user_id"])
            if not user.is_active:
                raise TokenError("inactive")
            if user.password_changed_at and int(user.password_changed_at.timestamp()) > int(old["iat"]):
                raise TokenError("password changed")
            old.blacklist()
            new = RefreshToken.for_user(user)
        except (TokenError, User.DoesNotExist, KeyError):
            response = Response({"detail": "Session expired. Please sign in again."},
                                status=status.HTTP_401_UNAUTHORIZED)
            _clear_refresh_cookie(response)
            return response
        response = Response({"access": str(new.access_token), "user": MeSerializer(user).data})
        _set_refresh_cookie(response, new)
        return response


class LogoutView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        _require_client_header(request)
        raw = request.COOKIES.get(settings.REFRESH_COOKIE_NAME)
        if raw:
            try:
                token = RefreshToken(raw)
                user = User.objects.filter(pk=token["user_id"]).first()
                token.blacklist()
                if user:
                    audit.record(AuditLog.Action.LOGOUT, instance=user, actor=user)
            except TokenError:
                pass
        response = Response(status=status.HTTP_204_NO_CONTENT)
        _clear_refresh_cookie(response)
        return response


class MeView(APIView):
    @extend_schema(responses=MeSerializer)
    def get(self, request):
        return Response(MeSerializer(request.user).data)

    @extend_schema(request=MeSerializer, responses=MeSerializer)
    def patch(self, request):
        allowed = {k: v for k, v in request.data.items() if k in ("full_name", "phone", "title")}
        serializer = MeSerializer(request.user, data=allowed, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class ChangePasswordView(APIView):
    @extend_schema(request=ChangePasswordSerializer, responses={204: None})
    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = request.user
        user.set_password(serializer.validated_data["new_password"])
        user.must_change_password = False
        user.save()
        audit.record(AuditLog.Action.PASSWORD_CHANGE, instance=user)
        refresh = RefreshToken.for_user(user)
        response = Response({"access": str(refresh.access_token)})
        _set_refresh_cookie(response, refresh)
        return response


class PasswordResetRequestView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = [PasswordResetThrottle]

    @extend_schema(request=PasswordResetRequestSerializer, responses={200: None})
    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = User.objects.filter(email__iexact=serializer.validated_data["email"]).first()
        if user and user.is_active:
            raw = PasswordResetToken.issue(user)
            link = f"{settings.FRONTEND_URL}/reset-password?token={raw}"
            try:
                send_mail(
                    "CMIS password reset",
                    f"Dear {user.full_name},\n\nUse the link below to set a new password. It expires in "
                    f"{settings.PASSWORD_RESET_TOKEN_HOURS} hour(s).\n\n{link}\n\n"
                    "If you did not request this, you can ignore this message.\n",
                    settings.DEFAULT_FROM_EMAIL,
                    [user.email],
                )
            except Exception:  # pragma: no cover - mail server outage
                logger.exception("Password reset email could not be sent")
            audit.record(AuditLog.Action.PASSWORD_RESET, instance=user, actor=None, message="Reset requested")
        return Response({"detail": "If the email address is registered, a reset link has been sent."})


class PasswordResetConfirmView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = [PasswordResetThrottle]

    @extend_schema(request=PasswordResetConfirmSerializer, responses={200: None})
    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = PasswordResetToken.consume(serializer.validated_data["token"])
        if user is None or not user.is_active:
            return Response({"detail": "This reset link is invalid or has expired."},
                            status=status.HTTP_400_BAD_REQUEST)
        password_validation.validate_password(serializer.validated_data["new_password"], user)
        user.set_password(serializer.validated_data["new_password"])
        user.must_change_password = False
        user.failed_login_count = 0
        user.locked_until = None
        user.save()
        audit.record(AuditLog.Action.PASSWORD_RESET, instance=user, actor=user, message="Password reset completed")
        return Response({"detail": "Your password has been changed. You can now sign in."})


# ---------------------------------------------------------------------------- management


def can_manage_user(actor, target, perm="users.edit"):
    """Actor must hold ``perm`` over every unit where the target holds a role,
    and must not be junior to the target."""
    if actor.pk == target.pk:
        return False
    assignments = list(target.role_assignments.filter(is_active=True).select_related("org_unit", "role"))
    if not assignments:
        hq = OrgUnit.objects.filter(unit_type="headquarters").first()
        return bool(hq and scoping.can(actor, perm, hq))
    for a in assignments:
        if not scoping.can(actor, perm, a.org_unit):
            return False
        if a.role.level < scoping.senior_level_at(actor, a.org_unit):
            return False
    return True


class UserViewSet(ScopedViewMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                  mixins.UpdateModelMixin, viewsets.GenericViewSet):
    module = "users"
    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated, ModulePermission]
    action_permissions = {"set_status": "edit", "reset_link": "edit", "unlock": "edit"}
    search_fields = ["full_name", "username", "email", "phone"]
    filterset_fields = ["status"]
    ordering_fields = ["full_name", "created_at", "last_login"]

    def get_queryset(self):
        user = self.request.user
        q = scoping.scope_q(user, "users.view", "role_assignments__org_unit__path")
        base = User.objects.prefetch_related("role_assignments__role", "role_assignments__org_unit")
        if q is None:
            return base.filter(pk=user.pk)
        visible = Q(created_by=user) | Q(pk=user.pk) | q
        hq = OrgUnit.objects.filter(unit_type="headquarters").first()
        if hq and scoping.can(user, "users.view", hq):
            visible |= Q(role_assignments__isnull=True)
        unit = self.request.query_params.get("org_unit")
        qs = base.filter(visible).distinct()
        if unit:
            qs = qs.filter(role_assignments__org_unit_id=unit)
        return qs

    def perform_create(self, serializer):
        user = serializer.save()
        audit.record(AuditLog.Action.CREATE, instance=user, changes={"username": [None, user.username]})
        account_created.send(sender=User, user=user, created_by=self.request.user)

    def perform_update(self, serializer):
        if not can_manage_user(self.request.user, serializer.instance) and serializer.instance != self.request.user:
            raise PermissionDenied("You cannot modify this account.")
        before = audit.snapshot(serializer.instance)
        user = serializer.save()
        audit.record(AuditLog.Action.UPDATE, instance=user, changes=audit.diff(before, audit.snapshot(user)))

    @action(detail=True, methods=["post"], url_path="status")
    def set_status(self, request, pk=None):
        target = self.get_object()
        if not can_manage_user(request.user, target):
            raise PermissionDenied("You cannot change the status of this account.")
        serializer = StatusChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        before = target.status
        target.status = serializer.validated_data["status"]
        target.status_reason = serializer.validated_data["reason"]
        target.save(update_fields=["status", "status_reason", "updated_at"])
        audit.record(AuditLog.Action.STATUS_CHANGE, instance=target, changes={"status": [before, target.status]},
                     message=target.status_reason)
        return Response(UserSerializer(target, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="reset-link")
    def reset_link(self, request, pk=None):
        """Issue a one-time reset link for users without email access."""
        target = self.get_object()
        if not can_manage_user(request.user, target):
            raise PermissionDenied("You cannot reset this account's password.")
        raw = PasswordResetToken.issue(target, issued_by=request.user)
        target.must_change_password = True
        target.save(update_fields=["must_change_password"])
        audit.record(AuditLog.Action.PASSWORD_RESET, instance=target, message="Administrator issued reset link")
        return Response({"link": f"{settings.FRONTEND_URL}/reset-password?token={raw}",
                         "expires_in_hours": settings.PASSWORD_RESET_TOKEN_HOURS})

    @action(detail=True, methods=["post"])
    def unlock(self, request, pk=None):
        target = self.get_object()
        if not can_manage_user(request.user, target):
            raise PermissionDenied("You cannot unlock this account.")
        target.failed_login_count = 0
        target.locked_until = None
        target.save(update_fields=["failed_login_count", "locked_until"])
        audit.record(AuditLog.Action.OTHER, instance=target, message="Account unlocked")
        return Response({"detail": "Account unlocked."})


class RoleViewSet(ScopedViewMixin, viewsets.ModelViewSet):
    module = "roles"
    serializer_class = RoleSerializer
    permission_classes = [permissions.IsAuthenticated, ModulePermission]
    search_fields = ["name", "code"]

    def get_required_permission(self):
        # Every signed-in user may read the role catalogue (needed for forms).
        if self.action in ("list", "retrieve"):
            return None
        return super().get_required_permission()

    def get_queryset(self):
        return Role.objects.annotate(
            assignment_count=Count("assignments", filter=Q(assignments__is_active=True))
        ).prefetch_related("permissions").order_by("level", "name")

    def _my_level(self):
        levels = [a.role.level for a in RoleAssignment.objects.current().filter(user=self.request.user)
                  .select_related("role")]
        return min(levels) if levels else 99

    def perform_create(self, serializer):
        if serializer.validated_data.get("level", 6) < self._my_level():
            raise PermissionDenied("You cannot create a role more senior than your own.")
        role = serializer.save(created_by=self.request.user, is_system=False)
        audit.record(AuditLog.Action.CREATE, instance=role)

    def perform_update(self, serializer):
        role = serializer.instance
        if role.code == "system_admin":
            raise PermissionDenied("The System Administrator role always holds every permission.")
        if role.level < self._my_level() or serializer.validated_data.get("level", role.level) < self._my_level():
            raise PermissionDenied("You cannot modify a role more senior than your own.")
        before = {"permissions": sorted(serializer.instance.permissions.values_list("code", flat=True)),
                  **audit.snapshot(serializer.instance)}
        role = serializer.save(updated_by=self.request.user)
        after = {"permissions": sorted(role.permissions.values_list("code", flat=True)), **audit.snapshot(role)}
        audit.record(AuditLog.Action.UPDATE, instance=role, changes=audit.diff(before, after))

    def perform_destroy(self, instance):
        if instance.is_system:
            raise ValidationError("Built-in roles cannot be deleted; deactivate them instead.")
        if instance.assignments.exists():
            raise ValidationError("This role is assigned to users. Remove the assignments first.")
        audit.record(AuditLog.Action.DELETE, instance=instance)
        instance.permissions.clear()
        instance.delete()


class PermissionViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = PermissionSerializer
    queryset = Permission.objects.all()
    pagination_class = None


class RoleAssignmentViewSet(ScopedViewMixin, viewsets.ModelViewSet):
    module = "users"
    serializer_class = RoleAssignmentSerializer
    permission_classes = [permissions.IsAuthenticated, ModulePermission]
    filterset_fields = ["user", "role", "org_unit", "is_active"]

    def get_queryset(self):
        return self.scope(RoleAssignment.objects.select_related("user", "role", "org_unit"))

    def perform_create(self, serializer):
        a = serializer.save(granted_by=self.request.user, created_by=self.request.user)
        audit.record(AuditLog.Action.CREATE, instance=a, org_unit=a.org_unit,
                     changes={"role": [None, a.role.code], "user": [None, a.user.username]})

    def perform_update(self, serializer):
        if serializer.instance.user_id == self.request.user.pk:
            raise PermissionDenied("You cannot change your own role assignments.")
        before = audit.snapshot(serializer.instance)
        a = serializer.save(updated_by=self.request.user)
        audit.record(AuditLog.Action.UPDATE, instance=a, org_unit=a.org_unit,
                     changes=audit.diff(before, audit.snapshot(a)))

    def perform_destroy(self, instance):
        """Assignments are ended, not deleted, so the history is kept."""
        if instance.user_id == self.request.user.pk:
            raise PermissionDenied("You cannot remove your own role assignments.")
        if not scoping.can(self.request.user, "users.edit", instance.org_unit):
            raise PermissionDenied("Outside your jurisdiction.")
        instance.is_active = False
        instance.ends_on = timezone.localdate()
        instance.save(update_fields=["is_active", "ends_on", "updated_at"])
        audit.record(AuditLog.Action.UPDATE, instance=instance, org_unit=instance.org_unit, message="Assignment ended")
