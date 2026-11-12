#!/bin/sh
# Waits for PostgreSQL, applies migrations (api container only), then runs the command.
set -e
python - <<'PY'
import os, sys, time
import psycopg
for attempt in range(60):
    try:
        psycopg.connect(host=os.environ.get("POSTGRES_HOST", "db"), port=os.environ.get("POSTGRES_PORT", "5432"),
                        dbname=os.environ.get("POSTGRES_DB", "cmis"), user=os.environ.get("POSTGRES_USER", "cmis"),
                        password=os.environ.get("POSTGRES_PASSWORD", ""), connect_timeout=3).close()
        sys.exit(0)
    except psycopg.OperationalError:
        print("Waiting for the database...", flush=True)
        time.sleep(2)
sys.exit("Database not reachable")
PY
if [ "${RUN_MIGRATIONS:-0}" = "1" ]; then
  python manage.py migrate --noinput
  python manage.py seed_initial
fi
exec "$@"
