from django.core.management.base import BaseCommand

from apps.configuration.seed import seed_all


class Command(BaseCommand):
    help = ("Seed roles, permissions, currencies, categories and the initial church structure. "
            "Idempotent and production-safe: creates no user accounts and no member/financial data.")

    def handle(self, *args, **options):
        seed_all(self.stdout)
        self.stdout.write(self.style.SUCCESS("Initial configuration is in place."))
