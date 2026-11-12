"""Give rows created by bulk inserts (which skipped ``save()``) a pull-feed cursor.

Rows with ``sync_seq = 0`` were invisible to the pull feed. This assigns each a
position from the global sequence; future bulk inserts get one from the field
default.
"""
from django.db import migrations

DEPENDS = [
    ("assets", "0004_alter_asset_sync_seq"),
    ("attendance", "0004_alter_attendancerecord_sync_seq"),
    ("configuration", "0003_alter_assetcategory_sync_seq_and_more"),
    ("finance", "0005_alter_transaction_sync_seq"),
    ("members", "0004_alter_baptismrecord_sync_seq_alter_member_sync_seq_and_more"),
    ("organization", "0003_alter_leadershipappointment_sync_seq_and_more"),
    ("programs", "0002_alter_program_sync_seq"),
    ("reports", "0002_alter_reportsubmission_sync_seq"),
]


def backfill(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        for app_label, _ in DEPENDS:
            for model in apps.get_app_config(app_label).get_models():
                if any(f.name == "sync_seq" for f in model._meta.fields):
                    cursor.execute(f'UPDATE "{model._meta.db_table}" SET sync_seq = nextval(\'cmis_sync_seq\') '
                                   "WHERE sync_seq = 0")


class Migration(migrations.Migration):
    dependencies = [("sync", "0001_initial"), *DEPENDS]
    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
