from django.apps import AppConfig


class ProgramsConfig(AppConfig):
    name = "apps.programs"
    label = "programs"
    default_auto_field = "django.db.models.BigAutoField"

    def ready(self):
        from . import hooks  # noqa: F401
