from django.db import migrations


class Migration(migrations.Migration):
    initial = True
    dependencies = []

    operations = [
        migrations.RunSQL(
            "CREATE SEQUENCE IF NOT EXISTS cmis_sync_seq START 1;",
            "DROP SEQUENCE IF EXISTS cmis_sync_seq;",
        ),
    ]
