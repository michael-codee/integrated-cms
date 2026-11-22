"""Give roles that already exist in a live database the new ``media.*`` permissions.

``seed_initial`` only sets a role's permissions when it first creates the role, so roles
created before this module existed would otherwise never see it. Roles the administrator
has customised keep everything they had; this only adds.
"""
from django.db import migrations

ACTIONS = ["view", "create", "edit", "delete", "approve", "reject", "export", "print", "submit"]
OPERATE = ["view", "create", "edit", "export", "print", "submit"]
GRANTS = {
    "system_admin": ACTIONS,
    "general_overseer": ACTIONS,
    "branch_pastor": OPERATE + ["delete"],
    "worship_leader": OPERATE,
}


def grant(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    perms = {}
    for action in ACTIONS:
        perms[action], _ = Permission.objects.get_or_create(
            code=f"media.{action}",
            defaults={"module": "media", "action": action,
                      "description": f"{action.title()} — Media & presentation (songs, scripture, screens)"})
    for role in Role.objects.filter(code__in=GRANTS):
        role.permissions.add(*[perms[a] for a in GRANTS[role.code]])


class Migration(migrations.Migration):
    dependencies = [
        ("presentation", "0001_initial"),
        ("accounts", "0002_initial"),
    ]

    operations = [migrations.RunPython(grant, migrations.RunPython.noop)]
