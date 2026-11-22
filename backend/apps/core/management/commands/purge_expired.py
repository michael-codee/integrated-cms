"""
Data retention: delete short-lived technical records once they are no longer needed.

Never touches church records, finance entries, the audit trail or sync conflicts.
Run daily (the Docker deployment's backup container does this; see docs/DEPLOYMENT.md).
"""
from datetime import timedelta

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone


class Command(BaseCommand):
    help = "Delete expired idempotency records, password reset links, phone remote links, refresh tokens and old read notifications."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Only report what would be deleted.")

    def handle(self, *args, dry_run=False, **options):
        from apps.accounts.models import PasswordResetToken
        from apps.notifications.models import Notification
        from apps.presentation.models import RemoteSession
        from apps.sync.models import IdempotencyRecord

        now = timezone.now()
        targets = {
            "idempotency records": IdempotencyRecord.objects.filter(
                created_at__lt=now - timedelta(days=settings.IDEMPOTENCY_KEEP_DAYS)),
            "password reset links": PasswordResetToken.objects.filter(
                Q(expires_at__lt=now - timedelta(days=1)) | Q(used_at__lt=now - timedelta(days=1))),
            "phone remote links": RemoteSession.objects.filter(expires_at__lt=now - timedelta(days=1)),
            "read notifications": Notification.objects.filter(
                read_at__isnull=False, created_at__lt=now - timedelta(days=settings.NOTIFICATION_KEEP_DAYS)),
        }
        for label, qs in targets.items():
            n = qs.count() if dry_run else qs.delete()[0]
            self.stdout.write(f"{'Would delete' if dry_run else 'Deleted'} {n} {label}")
        if not dry_run:
            call_command("flushexpiredtokens", verbosity=0)
            self.stdout.write("Flushed expired refresh tokens")
