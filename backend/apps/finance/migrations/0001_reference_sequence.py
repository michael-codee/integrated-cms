from django.db import migrations


class Migration(migrations.Migration):
    initial = True
    dependencies = [("core", "0001_sync_sequence")]
    operations = [
        migrations.RunSQL(
            "CREATE SEQUENCE IF NOT EXISTS cmis_finance_ref_seq START 1;",
            "DROP SEQUENCE IF EXISTS cmis_finance_ref_seq;",
        )
    ]
