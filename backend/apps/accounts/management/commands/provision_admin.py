"""
Controlled provisioning of the first privileged accounts.

There are no default accounts or passwords. Run once during installation:

    python manage.py provision_admin --role system_admin
    python manage.py provision_admin --role general_overseer

Passwords are typed interactively (never shown, never on the command line) or
read from the environment variable named by --password-env for automated,
secret-managed installs. The account is forced to change its password at first
sign-in unless --no-force-change is given.
"""
import getpass
import os

from django.contrib.auth import password_validation
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import Role, RoleAssignment, User
from apps.audit import services as audit
from apps.audit.models import AuditLog
from apps.organization.models import OrgUnit, UnitType


class Command(BaseCommand):
    help = "Securely create a System Administrator or General Overseer account at Headquarters."

    def add_arguments(self, parser):
        parser.add_argument("--role", choices=["system_admin", "general_overseer"], required=True)
        parser.add_argument("--username")
        parser.add_argument("--email")
        parser.add_argument("--full-name")
        parser.add_argument("--password-env", help="Name of an environment variable holding the password.")
        parser.add_argument("--no-force-change", action="store_true")
        parser.add_argument("--django-admin", action="store_true",
                            help="Also allow emergency access to the Django admin site.")

    def _ask(self, value, prompt):
        while not value:
            value = input(f"{prompt}: ").strip()
        return value

    def handle(self, *args, **opts):
        hq = OrgUnit.objects.filter(unit_type=UnitType.HEADQUARTERS).first()
        role = Role.objects.filter(code=opts["role"]).first()
        if not hq or not role:
            raise CommandError("Run `python manage.py seed_initial` first.")

        username = self._ask(opts["username"], "Username").lower()
        email = self._ask(opts["email"], "Email address").lower()
        full_name = self._ask(opts["full_name"], "Full name")
        if User.objects.filter(username=username).exists() or User.objects.filter(email=email).exists():
            raise CommandError("A user with that username or email already exists.")

        if opts["password_env"]:
            password = os.environ.get(opts["password_env"], "")
            if not password:
                raise CommandError(f"Environment variable {opts['password_env']} is empty.")
        else:
            password = getpass.getpass("Password: ")
            if password != getpass.getpass("Password (again): "):
                raise CommandError("Passwords do not match.")
        try:
            password_validation.validate_password(password, User(username=username, email=email, full_name=full_name))
        except ValidationError as exc:
            raise CommandError("; ".join(exc.messages))

        with transaction.atomic():
            user = User.objects.create_user(
                username=username, email=email, password=password, full_name=full_name,
                must_change_password=not opts["no_force_change"],
                is_staff=opts["django_admin"], is_superuser=opts["django_admin"],
            )
            RoleAssignment.objects.create(user=user, role=role, org_unit=hq, notes="Provisioned at installation")
            audit.record(AuditLog.Action.CREATE, instance=user, actor=None, org_unit=hq,
                         message=f"Provisioned via provision_admin as {role.name}")
        self.stdout.write(self.style.SUCCESS(f"Created {role.name} account '{username}'."))
