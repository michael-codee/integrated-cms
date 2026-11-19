"""Scheduled jobs called over HTTP by a hosting platform's scheduler (Vercel Cron).

Vercel sends ``Authorization: Bearer <CRON_SECRET>``. Without a configured secret the
endpoint does not exist; with a wrong one it answers 404, so it reveals nothing.
"""
import hmac
import io

from django.conf import settings
from django.core.management import call_command
from django.http import Http404, JsonResponse
from django.views.decorators.http import require_GET


@require_GET
def housekeeping(request):
    secret = settings.CRON_SECRET
    sent = request.META.get("HTTP_AUTHORIZATION", "")
    if not secret or not hmac.compare_digest(sent.encode(), f"Bearer {secret}".encode()):
        raise Http404
    out = io.StringIO()
    call_command("purge_expired", stdout=out)
    return JsonResponse({"status": "ok", "log": out.getvalue().splitlines()})
