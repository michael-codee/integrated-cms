from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication


class CMISJWTAuthentication(JWTAuthentication):
    """JWT auth that also rejects suspended/deactivated accounts and tokens
    issued before the user's last password change."""

    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        if not user.is_active:
            raise AuthenticationFailed("This account is not active.", code="user_inactive")
        issued = validated_token.get("iat")
        if issued and user.password_changed_at and int(user.password_changed_at.timestamp()) > int(issued):
            raise AuthenticationFailed("Session expired after a password change. Please sign in again.")
        return user
