"""Database-level protection of financial records.

Even a bug in the application or a direct SQL session cannot silently alter
approved figures or delete finance rows.
"""
from django.db import migrations

SQL = """
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

DROP TRIGGER IF EXISTS finance_transaction_guard ON finance_transaction;
CREATE TRIGGER finance_transaction_guard
    BEFORE UPDATE OR DELETE ON finance_transaction
    FOR EACH ROW EXECUTE FUNCTION cmis_finance_txn_guard();

CREATE OR REPLACE FUNCTION cmis_finance_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% is append-only (% blocked)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS finance_approval_append_only ON finance_transactionapproval;
CREATE TRIGGER finance_approval_append_only
    BEFORE UPDATE OR DELETE ON finance_transactionapproval
    FOR EACH ROW EXECUTE FUNCTION cmis_finance_append_only();

DROP TRIGGER IF EXISTS finance_reconciliation_append_only ON finance_reconciliation;
CREATE TRIGGER finance_reconciliation_append_only
    BEFORE UPDATE OR DELETE ON finance_reconciliation
    FOR EACH ROW EXECUTE FUNCTION cmis_finance_append_only();
"""

REVERSE = """
DROP TRIGGER IF EXISTS finance_transaction_guard ON finance_transaction;
DROP TRIGGER IF EXISTS finance_approval_append_only ON finance_transactionapproval;
DROP TRIGGER IF EXISTS finance_reconciliation_append_only ON finance_reconciliation;
DROP FUNCTION IF EXISTS cmis_finance_txn_guard();
DROP FUNCTION IF EXISTS cmis_finance_append_only();
"""


class Migration(migrations.Migration):
    dependencies = [("finance", "0002_initial")]
    operations = [migrations.RunSQL(SQL, REVERSE)]
