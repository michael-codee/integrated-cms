"""Idempotent writes.

Every write the frontend sends carries an ``Idempotency-Key`` (the outbox
change id). If the same user sends the same key again — typically because a
device lost connection before it saw the reply — the stored response is
returned and the change is not applied twice. Only successful responses are
stored; a failed attempt can be retried with the same key.
"""
import json
import logging

from django.db import IntegrityError, transaction
from django.http import JsonResponse

from .models import IdempotencyRecord

logger = logging.getLogger("cmis")
WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
MAX_STORED_BYTES = 200_000


def _authenticated_user(request):
    user = getattr(request, "user", None)
    if user is not None and user.is_authenticated:
        return user
    if not request.META.get("HTTP_AUTHORIZATION"):
        return None
    from apps.accounts.authentication import CMISJWTAuthentication
    from rest_framework.request import Request

    try:
        result = CMISJWTAuthentication().authenticate(Request(request))
    except Exception:  # invalid token: let the view return the proper 401
        return None
    return result[0] if result else None


class IdempotencyMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        key = request.META.get("HTTP_IDEMPOTENCY_KEY", "").strip()
        if not key or request.method not in WRITE_METHODS or not request.path.startswith("/api/") \
                or request.path.startswith("/api/auth/"):
            return self.get_response(request)
        if len(key) > 80:
            return JsonResponse({"detail": "Idempotency-Key is too long."}, status=400)
        user = _authenticated_user(request)
        if user is None:
            return self.get_response(request)

        try:
            with transaction.atomic():
                record = IdempotencyRecord.objects.create(user=user, key=key, method=request.method, path=request.path[:300])
        except IntegrityError:
            existing = IdempotencyRecord.objects.filter(user=user, key=key).first()
            if existing is None:  # pragma: no cover - deleted between the two queries
                return self.get_response(request)
            if existing.method != request.method or existing.path != request.path[:300]:
                return JsonResponse({"detail": "This Idempotency-Key was already used for a different request."},
                                    status=422)
            if existing.status_code == IdempotencyRecord.IN_PROGRESS:
                return JsonResponse({"detail": "This change is still being processed. Try again shortly.",
                                     "code": "in_progress"}, status=409)
            response = JsonResponse(existing.response_body, status=existing.status_code, safe=False) \
                if existing.response_body is not None else JsonResponse({}, status=existing.status_code)
            if existing.status_code == 204:
                response = JsonResponse(None, status=204, safe=False)
                response.content = b""
            response["Idempotent-Replay"] = "true"
            return response

        response = self.get_response(request)
        try:
            if 200 <= response.status_code < 300:
                body = None
                content = getattr(response, "content", b"")
                if content and len(content) <= MAX_STORED_BYTES and \
                        response.get("Content-Type", "").startswith("application/json"):
                    body = json.loads(content)
                record.status_code = response.status_code
                record.response_body = body
                record.save(update_fields=["status_code", "response_body"])
            else:
                record.delete()
        except Exception:  # never let bookkeeping break the response the user is waiting for
            logger.exception("Could not store idempotent response")
            IdempotencyRecord.objects.filter(pk=record.pk).delete()
        return response
