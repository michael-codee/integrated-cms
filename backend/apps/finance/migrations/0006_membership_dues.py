"""Monthly membership dues: the months a dues payment covers, protected like
the other figures once submitted, and the income category used for dues."""
from django.db import migrations, models

GUARD = """
CREATE OR REPLACE FUNCTION cmis_finance_txn_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'finance transactions cannot be deleted (use a reversing entry)';
    END IF;
    IF OLD.status IN ('submitted', 'approved', 'reversed') THEN
        IF NEW.amount IS DISTINCT FROM OLD.amount
           OR NEW.kind IS DISTINCT FROM OLD.kind
           OR NEW.account_id IS DISTINCT FROM OLD.account_id
           OR NEW.category_id IS DISTINCT FROM OLD.category_id
           OR NEW.org_unit_id IS DISTINCT FROM OLD.org_unit_id
           OR NEW.currency_id IS DISTINCT FROM OLD.currency_id
           OR NEW.transaction_date IS DISTINCT FROM OLD.transaction_date
           OR NEW.reference IS DISTINCT FROM OLD.reference
           OR NEW.reversal_of_id IS DISTINCT FROM OLD.reversal_of_id
           EXTRA_CONDITIONS
           OR NEW.is_deleted IS DISTINCT FROM OLD.is_deleted THEN
            RAISE EXCEPTION 'transaction % is % and its figures cannot be changed', OLD.reference, OLD.status;
        END IF;
    END IF;
    IF OLD.status = 'approved' AND NEW.status NOT IN ('approved', 'reversed') THEN
        RAISE EXCEPTION 'approved transaction % can only be reversed', OLD.reference;
    END IF;
    IF OLD.status = 'reversed' AND NEW.status <> 'reversed' THEN
        RAISE EXCEPTION 'reversed transaction % cannot change status', OLD.reference;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
"""
DUES_CONDITIONS = (
    "OR (OLD.dues_month IS NOT NULL AND NEW.member_id IS DISTINCT FROM OLD.member_id)\n"
    "           OR NEW.dues_month IS DISTINCT FROM OLD.dues_month\n"
    "           OR NEW.dues_months IS DISTINCT FROM OLD.dues_months"
)
DUES_GUARD = GUARD.replace("EXTRA_CONDITIONS", DUES_CONDITIONS)
PREVIOUS_GUARD = GUARD.replace("           EXTRA_CONDITIONS\n", "")


def add_dues_category(apps, schema_editor):
    FinanceCategory = apps.get_model("configuration", "FinanceCategory")
    FinanceCategory.objects.get_or_create(code="membership-dues", defaults={
        "name": "Monthly membership dues", "kind": "income", "sort_order": 15,
        "description": "Monthly dues paid by members. Recorded with the Monthly dues form."})


class Migration(migrations.Migration):

    dependencies = [
        ("configuration", "0003_alter_assetcategory_sync_seq_and_more"),
        ("finance", "0005_alter_transaction_sync_seq"),
    ]

    operations = [
        migrations.AddField(
            model_name="transaction",
            name="dues_month",
            field=models.DateField(
                blank=True,
                db_index=True,
                help_text="Membership dues: first month paid for (always the 1st of the month)",
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="transaction",
            name="dues_months",
            field=models.PositiveSmallIntegerField(
                blank=True,
                help_text="Membership dues: number of consecutive months paid for",
                null=True,
            ),
        ),
        migrations.RunSQL(DUES_GUARD, PREVIOUS_GUARD),
        migrations.RunPython(add_dues_category, migrations.RunPython.noop),
    ]
