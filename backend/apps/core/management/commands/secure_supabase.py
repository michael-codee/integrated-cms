"""
Close Supabase's automatic Data API (PostgREST) over the CMIS tables.

Supabase exposes tables in the ``public`` schema to its ``anon`` and ``authenticated`` roles
through a REST API. The CMIS never uses that API: all access goes through the Django API,
which enforces roles and jurisdiction. This command, run after every ``migrate``:

* revokes every privilege of ``anon`` and ``authenticated`` on the schema's tables,
  sequences and functions, and on objects created later;
* enables Row Level Security on every table, with no policies, so even a mistaken grant
  returns nothing. The Django connection user owns the tables and is not affected.

It does nothing on a database without those roles (local PostgreSQL, Docker).
Also switch off the Data API in Supabase (Project Settings -> Data API).
"""
from django.core.management.base import BaseCommand
from django.db import connection

ROLES = ("anon", "authenticated")


class Command(BaseCommand):
    help = "Revoke Supabase API roles' access to the CMIS tables and enable Row Level Security."

    def handle(self, *args, **options):
        with connection.cursor() as c:
            c.execute("SELECT rolname FROM pg_roles WHERE rolname = ANY(%s)", [list(ROLES)])
            present = [r[0] for r in c.fetchall()]
            c.execute("SELECT current_schema()")
            schema = c.fetchone()[0]
            q = connection.ops.quote_name
            if present:
                who = ", ".join(q(r) for r in present)
                for kind in ("TABLES", "SEQUENCES", "FUNCTIONS"):
                    c.execute(f"REVOKE ALL ON ALL {kind} IN SCHEMA {q(schema)} FROM {who}")
                    c.execute(f"ALTER DEFAULT PRIVILEGES IN SCHEMA {q(schema)} REVOKE ALL ON {kind} FROM {who}")
                c.execute(f"REVOKE USAGE ON SCHEMA {q(schema)} FROM {who}")
                self.stdout.write(f"Revoked access for: {', '.join(present)}")
            else:
                self.stdout.write("No Supabase API roles in this database; privileges unchanged.")
            c.execute("SELECT tablename FROM pg_tables WHERE schemaname = %s AND NOT rowsecurity", [schema])
            tables = [r[0] for r in c.fetchall()]
            for t in tables:
                c.execute(f"ALTER TABLE {q(schema)}.{q(t)} ENABLE ROW LEVEL SECURITY")
            self.stdout.write(f"Row Level Security enabled on {len(tables)} table(s).")
