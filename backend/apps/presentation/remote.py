"""Phone remote for the control desk.

The desk (signed in, ``media.view``) opens a session and shows a QR code with a random token. A
phone that opens the link sends button presses with that token; nothing else is reachable with it.
The desk polls ``sync`` about once a second: it publishes what is on screen for the phone and
collects the presses waiting for it, then applies them itself.
"""
import hashlib
import json
import secrets
from datetime import timedelta

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from apps.audit import services as audit
from apps.audit.models import AuditLog
from apps.core import scoping

from .models import RemoteCommand, RemoteSession

SESSION_HOURS = 8
ACTIONS = {"next", "back", "black", "clear", "logo", "show", "play", "slide", "item"}
MAX_PENDING = 40
MAX_STATE_BYTES = 64_000
TOKEN_HEADER = "HTTP_X_REMOTE_TOKEN"
SEEN_WITHIN = timedelta(seconds=8)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _recent(at):
    return bool(at and timezone.now() - at < SEEN_WITHIN)


class CanRunScreens(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and scoping.has_perm_anywhere(request.user, "media.view"))


class RemoteThrottle(SimpleRateThrottle):
    """Per token (the whole congregation may share one public address)."""

    scope = "media_remote"

    def get_cache_key(self, request, view):
        token = request.META.get(TOKEN_HEADER, "")
        ident = _hash(token)[:32] if token else self.get_ident(request)
        return self.cache_format % {"scope": self.scope, "ident": ident}


class RemoteSessionView(APIView):
    """POST: pair a new phone remote with this desk."""

    permission_classes = [CanRunScreens]

    def post(self, request):
        now = timezone.now()
        token = secrets.token_urlsafe(24)
        with transaction.atomic():
            # One remote per person: opening a new one ends the old link.
            RemoteSession.objects.filter(created_by=request.user, ended_at__isnull=True).update(ended_at=now)
            session = RemoteSession.objects.create(token_hash=_hash(token), created_by=request.user,
                                                   expires_at=now + timedelta(hours=SESSION_HOURS))
        audit.record(AuditLog.Action.CREATE, instance=session, message="Phone remote paired with the control desk")
        return Response({"id": str(session.id), "token": token, "expires_at": session.expires_at},
                        status=status.HTTP_201_CREATED)


class RemoteSyncView(APIView):
    """POST {state, after}: publish the desk's state, collect presses newer than ``after``."""

    permission_classes = [CanRunScreens]

    def post(self, request, pk):
        session = get_object_or_404(RemoteSession, pk=pk, created_by=request.user)
        if not session.is_active:
            return Response({"active": False, "commands": []}, status=status.HTTP_410_GONE)
        fields = ["desk_seen_at"]
        session.desk_seen_at = timezone.now()
        state = request.data.get("state")
        if isinstance(state, dict):
            if len(json.dumps(state)) > MAX_STATE_BYTES:
                return Response({"state": "Too much to send to the phone."}, status=status.HTTP_400_BAD_REQUEST)
            session.state = state
            fields.append("state")
        session.save(update_fields=fields)
        try:
            after = int(request.data.get("after") or 0)
        except (TypeError, ValueError):
            after = 0
        commands = list(session.commands.filter(id__gt=after).values("id", "action", "value")[:MAX_PENDING])
        # Presses the desk has confirmed are no longer needed.
        if after:
            session.commands.filter(id__lte=after).delete()
        return Response({"active": True, "commands": commands, "phone_connected": _recent(session.phone_seen_at),
                         "expires_at": session.expires_at})


class RemoteEndView(APIView):
    permission_classes = [CanRunScreens]

    def post(self, request, pk):
        session = get_object_or_404(RemoteSession, pk=pk, created_by=request.user)
        if session.ended_at is None:
            session.ended_at = timezone.now()
            session.save(update_fields=["ended_at"])
            session.commands.all().delete()
            audit.record(AuditLog.Action.UPDATE, instance=session, message="Phone remote ended")
        return Response(status=status.HTTP_204_NO_CONTENT)


class PhoneView(APIView):
    """Used by the phone, which has no account: the token in ``X-Remote-Token`` is the only key."""

    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = [RemoteThrottle]

    def _session(self, request):
        token = request.META.get(TOKEN_HEADER, "")
        if not token or len(token) > 100:
            return None
        return RemoteSession.objects.filter(token_hash=_hash(token)).first()

    def _gone(self):
        return Response({"detail": "This remote has ended. Scan the code on the control desk again."},
                        status=status.HTTP_410_GONE)

    def get(self, request):
        session = self._session(request)
        if session is None or not session.is_active:
            return self._gone()
        RemoteSession.objects.filter(pk=session.pk).update(phone_seen_at=timezone.now())
        return Response({"state": session.state, "desk_connected": _recent(session.desk_seen_at),
                         "expires_at": session.expires_at})

    def post(self, request):
        session = self._session(request)
        if session is None or not session.is_active:
            return self._gone()
        action = request.data.get("action")
        if action not in ACTIONS:
            return Response({"action": "Unknown button."}, status=status.HTTP_400_BAD_REQUEST)
        value = request.data.get("value")
        if action in ("slide", "item"):
            if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value < 1000:
                return Response({"value": "Choose a slide or item."}, status=status.HTTP_400_BAD_REQUEST)
        else:
            value = None
        if session.commands.count() >= MAX_PENDING:
            return Response({"detail": "The control desk is not picking up presses. Check that it is open."},
                            status=status.HTTP_429_TOO_MANY_REQUESTS)
        cmd = RemoteCommand.objects.create(session=session, action=action, value=value)
        RemoteSession.objects.filter(pk=session.pk).update(phone_seen_at=timezone.now())
        return Response({"id": cmd.id, "desk_connected": _recent(session.desk_seen_at)}, status=status.HTTP_202_ACCEPTED)
