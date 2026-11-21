from django.contrib.auth import password_validation
from django.db import transaction
from rest_framework import serializers

from apps.core import scoping
from apps.organization.models import OrgUnit

from .models import Permission, Role, RoleAssignment, User


class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ["id", "code", "module", "action", "description"]


class RoleSerializer(serializers.ModelSerializer):
    permissions = serializers.SlugRelatedField(
        many=True, slug_field="code", queryset=Permission.objects.all(), required=False
    )
    assignment_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Role
        fields = ["id", "code", "name", "level", "description", "is_system", "is_active", "permissions",
                  "assignment_count"]
        read_only_fields = ["is_system"]

    def validate_level(self, value):
        if value < 1:
            raise serializers.ValidationError("Level must be 1 or higher.")
        return value


class OrgUnitBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrgUnit
        fields = ["id", "code", "name", "unit_type", "path"]


class RoleAssignmentSerializer(serializers.ModelSerializer):
    role_name = serializers.CharField(source="role.name", read_only=True)
    role_code = serializers.CharField(source="role.code", read_only=True)
    role_level = serializers.IntegerField(source="role.level", read_only=True)
    org_unit_name = serializers.CharField(source="org_unit.name", read_only=True)
    org_unit_type = serializers.CharField(source="org_unit.unit_type", read_only=True)
    user_name = serializers.CharField(source="user.full_name", read_only=True)

    class Meta:
        model = RoleAssignment
        fields = ["id", "user", "user_name", "role", "role_name", "role_code", "role_level", "org_unit",
                  "org_unit_name", "org_unit_type", "department_id", "starts_on", "ends_on", "is_active", "notes",
                  "created_at"]
        read_only_fields = ["created_at"]

    def validate(self, attrs):
        request = self.context["request"]
        role = attrs.get("role") or getattr(self.instance, "role", None)
        unit = attrs.get("org_unit") or getattr(self.instance, "org_unit", None)
        ends = attrs.get("ends_on")
        starts = attrs.get("starts_on") or getattr(self.instance, "starts_on", None)
        if ends and starts and ends < starts:
            raise serializers.ValidationError({"ends_on": "End date cannot be before the start date."})
        if not scoping.can(request.user, "users.edit", unit):
            raise serializers.ValidationError({"org_unit": "You can only grant roles within your own jurisdiction."})
        granter_level = scoping.senior_level_at(request.user, unit)
        if role.level < granter_level:
            raise serializers.ValidationError(
                {"role": "You cannot grant a role more senior than your own."}
            )
        return attrs


class UserSerializer(serializers.ModelSerializer):
    assignments = RoleAssignmentSerializer(source="role_assignments", many=True, read_only=True)
    password = serializers.CharField(write_only=True, required=False, allow_blank=False,
                                     style={"input_type": "password"})
    initial_role = serializers.PrimaryKeyRelatedField(queryset=Role.objects.filter(is_active=True), write_only=True,
                                                      required=False)
    initial_org_unit = serializers.PrimaryKeyRelatedField(queryset=OrgUnit.objects.all(), write_only=True,
                                                          required=False)

    class Meta:
        model = User
        fields = ["id", "username", "email", "full_name", "title", "phone", "status", "status_reason",
                  "must_change_password", "last_login", "created_at", "assignments", "password", "initial_role",
                  "initial_org_unit", "is_locked"]
        read_only_fields = ["status", "status_reason", "last_login", "created_at", "is_locked"]

    def validate_username(self, value):
        value = value.lower().strip()
        qs = User.objects.filter(username__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("This username is already taken.")
        return value

    def validate_email(self, value):
        value = value.lower().strip()
        qs = User.objects.filter(email__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("This email address is already registered.")
        return value

    def validate(self, attrs):
        if not self.instance:
            if not attrs.get("password"):
                raise serializers.ValidationError({"password": "An initial password is required."})
            if not attrs.get("initial_role") or not attrs.get("initial_org_unit"):
                raise serializers.ValidationError(
                    {"initial_role": "Every new account needs a role and an organisational unit."}
                )
            candidate = User(username=attrs.get("username"), email=attrs.get("email"),
                             full_name=attrs.get("full_name", ""))
            password_validation.validate_password(attrs["password"], candidate)
            assignment = RoleAssignmentSerializer(context=self.context)
            assignment.validate({"role": attrs["initial_role"], "org_unit": attrs["initial_org_unit"]})
        elif "password" in attrs:
            raise serializers.ValidationError({"password": "Use the password reset action to change passwords."})
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        role = validated_data.pop("initial_role")
        unit = validated_data.pop("initial_org_unit")
        password = validated_data.pop("password")
        request_user = self.context["request"].user
        user = User.objects.create_user(password=password, created_by=request_user, must_change_password=True,
                                        **validated_data)
        RoleAssignment.objects.create(user=user, role=role, org_unit=unit, granted_by=request_user,
                                      created_by=request_user)
        return user

    def update(self, instance, validated_data):
        validated_data.pop("initial_role", None)
        validated_data.pop("initial_org_unit", None)
        return super().update(instance, validated_data)


class MeSerializer(serializers.ModelSerializer):
    assignments = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "email", "full_name", "title", "phone", "status", "must_change_password",
                  "last_login", "assignments", "permissions"]

    def get_assignments(self, user):
        qs = RoleAssignment.objects.current().filter(user=user).select_related("role", "org_unit")
        return RoleAssignmentSerializer(qs, many=True).data

    def get_permissions(self, user):
        return sorted(scoping.all_permissions(user))


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(help_text="Username or email address")
    password = serializers.CharField(style={"input_type": "password"})


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField()
    new_password = serializers.CharField()

    def validate(self, attrs):
        user = self.context["request"].user
        if not user.check_password(attrs["current_password"]):
            raise serializers.ValidationError({"current_password": "The current password is incorrect."})
        if attrs["current_password"] == attrs["new_password"]:
            raise serializers.ValidationError({"new_password": "Choose a password different from the current one."})
        password_validation.validate_password(attrs["new_password"], user)
        return attrs


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    token = serializers.CharField()
    new_password = serializers.CharField()


class SetPasswordSerializer(serializers.Serializer):
    password = serializers.CharField(style={"input_type": "password"}, trim_whitespace=False)


class ChangeAssignmentSerializer(serializers.Serializer):
    role = serializers.PrimaryKeyRelatedField(queryset=Role.objects.filter(is_active=True), required=False)
    org_unit = serializers.PrimaryKeyRelatedField(queryset=OrgUnit.objects.all(), required=False)
    ends_on = serializers.DateField(required=False, allow_null=True)
    reason = serializers.CharField(required=False, allow_blank=True, default="")


class StatusChangeSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=User.Status.choices)
    reason = serializers.CharField(required=False, allow_blank=True, default="")
