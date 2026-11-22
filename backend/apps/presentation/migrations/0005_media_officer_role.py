"""Add the Media Officer role to databases that already exist.

``seed_initial`` creates it on new installations and on the next database update; this makes it
appear as soon as migrations run, so administrators can give it to new accounts straight away.
An existing role with the same code is left as it is.
"""
from django.db import migrations

from apps.accounts.registry import DEFAULT_ROLES, MODULES, expand


def add_role(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    spec = next(r for r in DEFAULT_ROLES if r["code"] == "media_officer")
    if Role.objects.filter(code=spec["code"]).exists():
        return
    perms = []
    for code in sorted(expand(spec["permissions"])):
        module, action = code.split(".")
        perm, _ = Permission.objects.get_or_create(
            code=code, defaults={"module": module, "action": action,
                                 "description": f"{action.title()} — {MODULES[module]}"})
        perms.append(perm)
    role = Role.objects.create(code=spec["code"], name=spec["name"], level=spec["level"],
                               description=spec.get("description", ""), is_system=True)
    role.permissions.set(perms)


class Migration(migrations.Migration):
    dependencies = [
        ("presentation", "0004_phone_camera"),
        ("accounts", "0002_initial"),
    ]

    operations = [migrations.RunPython(add_role, migrations.RunPython.noop)]
