import random

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import models, transaction


class Command(BaseCommand):
    help = "Create clearly-marked FICTIONAL demo data for development/training. Refused in production."

    def add_arguments(self, parser):
        parser.add_argument("--seed", type=int, default=2026)
        parser.add_argument("--purge", action="store_true", help="Remove all demo records instead.")

    def handle(self, *args, **opts):
        if not settings.ALLOW_DEMO_DATA:
            raise CommandError("Demo data is disabled (ALLOW_DEMO_DATA=false). It must never be loaded in production.")
        from apps.core import demo_hooks

        if opts["purge"]:
            with transaction.atomic():
                demo_hooks.purge()
            self.stdout.write(self.style.SUCCESS("Demo records removed."))
            return
        rng = random.Random(opts["seed"])
        with transaction.atomic():
            summary = demo_hooks.generate(rng)
        for k, v in summary.items():
            self.stdout.write(f"  {k}: {v}")
        self.stdout.write(self.style.SUCCESS("Demo data created (all records flagged as demo)."))


def hard_delete(qs):
    """Bypass soft deletion for demo rows only."""
    models.QuerySet.delete(qs)
