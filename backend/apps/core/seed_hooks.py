"""Module-level seed functions run by ``manage.py seed_initial``."""
from importlib import import_module

from django.apps import apps

SEED_FUNCTIONS = [
    # ("app_label", "dotted.path.to.function")
    ("organization", "apps.organization.leadership.seed_positions"),
]


def run_hooks():
    for label, dotted in SEED_FUNCTIONS:
        if not apps.is_installed(f"apps.{label}"):
            continue
        module_path, func = dotted.rsplit(".", 1)
        getattr(import_module(module_path), func)()
