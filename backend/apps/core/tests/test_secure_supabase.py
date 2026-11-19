import io

import pytest
from django.core.management import call_command
from django.db import connection


@pytest.mark.django_db
def test_secure_supabase_locks_api_roles_out_but_app_keeps_working(people):
    with connection.cursor() as c:
        c.execute("SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated')")
        if c.fetchone()[0] < 2:
            c.execute("SELECT rolsuper OR rolcreaterole FROM pg_roles WHERE rolname = current_user")
            if not c.fetchone()[0]:
                pytest.skip("needs the roles anon/authenticated or a user allowed to create them")
        for role in ("anon", "authenticated"):
            c.execute(f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{role}') "
                      f"THEN CREATE ROLE {role} NOLOGIN; END IF; END $$")
            c.execute(f"GRANT USAGE ON SCHEMA public TO {role}")
            c.execute(f"GRANT SELECT ON ALL TABLES IN SCHEMA public TO {role}")
        c.execute("SET CONSTRAINTS ALL IMMEDIATE")  # the test runs inside a transaction
    out = io.StringIO()
    call_command("secure_supabase", stdout=out)
    assert "Revoked access for: anon, authenticated" in out.getvalue()
    with connection.cursor() as c:
        c.execute("SELECT has_table_privilege('anon', 'members_member', 'SELECT'), "
                  "has_table_privilege('authenticated', 'finance_transaction', 'SELECT')")
        assert c.fetchone() == (False, False)
        c.execute("SELECT count(*) FROM pg_tables WHERE schemaname='public' AND NOT rowsecurity")
        assert c.fetchone()[0] == 0
    # The application's own user owns the tables and still reads them.
    from apps.accounts.models import User
    assert User.objects.filter(pk=people["admin"].pk).exists()
