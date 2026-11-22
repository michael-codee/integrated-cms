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

from .models import RemoteCommand, RemoteSession, RemoteSignal

SESSION_HOURS = 8
ACTIONS = {"next", "back", "black", "clear", "logo", "show", "play", "slide", "item"}
MAX_PENDING = 40
MAX_STATE_BYTES = 64_000
TOKEN_HEADER = "HTTP_X_REMOTE_TOKEN"
SEEN_WITHIN = timedelta(seconds=8)
SIGNAL_KINDS = {"offer", "answer", "bye"}
MAX_SIGNAL_BYTES = 40_000
MAX_SIGNALS = 10


def _after(data, key):
    try:
        return max(0, int(data.get(key) or 0))
    except (TypeError, ValueError):
        return 0


def _clean_signal(item):
    """A WebRTC message: offer/answer carry a session description, bye nothing. None if invalid."""
    if not isinstance(item, dict) or item.get("kind") not in SIGNAL_KINDS:
        return None
    payload = item.get("payload") or {}
    if not isinstance(payload, dict) or len(json.dumps(payload)) > MAX_SIGNAL_BYTES:
        return None
    if item["kind"] in ("offer", "answer"):
        sdp = payload.get("sdp")
        if payload.get("type") != item["kind"] or not isinstance(sdp, str) or not sdp.startswith("v="):
            return None
        payload = {"type": item["kind"], "sdp": sdp}
    else:
        payload = {}
    return item["kind"], payload


def _take_signals(session, sender, after):
    """Signals from ``sender`` newer than ``after``; the ones up to ``after`` have been read."""
    if after:
        session.signals.filter(sender=sender, id__lte=after).delete()
    return list(session.signals.filter(sender=sender, id__gt=after).values("id", "kind", "payload")[:MAX_SIGNALS])


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
        after = _after(request.data, "after")
        commands = list(session.commands.filter(id__gt=after).values("id", "action", "value")[:MAX_PENDING])
        # Presses the desk has confirmed are no longer needed.
        if after:
            session.commands.filter(id__lte=after).delete()
        send = request.data.get("send_signals") or []
        if not isinstance(send, list) or len(send) > MAX_SIGNALS:
            return Response({"send_signals": "Too many messages."}, status=status.HTTP_400_BAD_REQUEST)
        for item in send:
            clean = _clean_signal(item)
            if clean is None:
                return Response({"send_signals": "Not a camera set-up message."}, status=status.HTTP_400_BAD_REQUEST)
            RemoteSignal.objects.create(session=session, sender=RemoteSignal.Sender.DESK, kind=clean[0], payload=clean[1])
        signals = _take_signals(session, RemoteSignal.Sender.PHONE, _after(request.data, "signals_after"))
        return Response({"active": True, "commands": commands, "signals": signals,
                         "phone_connected": _recent(session.phone_seen_at), "expires_at": session.expires_at})


class RemoteEndView(APIView):
    permission_classes = [CanRunScreens]

    def post(self, request, pk):
        session = get_object_or_404(RemoteSession, pk=pk, created_by=request.user)
        if session.ended_at is None:
            session.ended_at = timezone.now()
            session.save(update_fields=["ended_at"])
            session.commands.all().delete()
            session.signals.all().delete()
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
        signals = _take_signals(session, RemoteSignal.Sender.DESK, _after(request.query_params, "signals_after"))
        return Response({"state": session.state, "desk_connected": _recent(session.desk_seen_at),
                         "expires_at": session.expires_at, "signals": signals})

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


class PhoneSignalView(PhoneView):
    """POST {kind, payload}: the phone's camera offer, or a hang-up."""

    def get(self, request):  # pragma: no cover - only POST is offered
        return Response(status=status.HTTP_405_METHOD_NOT_ALLOWED)

    def post(self, request):
        session = self._session(request)
        if session is None or not session.is_active:
            return self._gone()
        clean = _clean_signal(request.data)
        if clean is None or clean[0] == "answer":
            return Response({"detail": "Not a camera set-up message."}, status=status.HTTP_400_BAD_REQUEST)
        if session.signals.filter(sender=RemoteSignal.Sender.PHONE).count() >= MAX_SIGNALS:
            return Response({"detail": "The control desk is not answering. Check that it is open."},
                            status=status.HTTP_429_TOO_MANY_REQUESTS)
        if clean[0] == "offer":
            # A new offer replaces any the desk has not read yet.
            session.signals.filter(sender=RemoteSignal.Sender.PHONE).delete()
        sig = RemoteSignal.objects.create(session=session, sender=RemoteSignal.Sender.PHONE, kind=clean[0],
                                          payload=clean[1])
        return Response({"id": sig.id, "desk_connected": _recent(session.desk_seen_at)}, status=status.HTTP_202_ACCEPTED)
