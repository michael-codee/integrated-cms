from django.db import migrations

SQL = """
CREATE OR REPLACE FUNCTION cmis_audit_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_auditlog is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_auditlog_immutable ON audit_auditlog;
CREATE TRIGGER audit_auditlog_immutable
    BEFORE UPDATE OR DELETE ON audit_auditlog
    FOR EACH ROW EXECUTE FUNCTION cmis_audit_immutable();
"""

REVERSE = """
DROP TRIGGER IF EXISTS audit_auditlog_immutable ON audit_auditlog;
DROP FUNCTION IF EXISTS cmis_audit_immutable();
"""


class Migration(migrations.Migration):
    dependencies = [("audit", "0001_initial")]
    operations = [migrations.RunSQL(SQL, REVERSE)]
