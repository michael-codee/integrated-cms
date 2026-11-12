#!/bin/sh
# Restore a CMIS backup into the Docker stack. REPLACES the current database and uploaded files.
#
#   ./deploy/restore.sh backups/cmis-db-20261112-020000.dump backups/cmis-files-20261112-020000.tar.gz
#
# Run from the repository root (where docker-compose.yml is). See docs/BACKUP_AND_RESTORE.md.
set -eu

DB_DUMP=${1:?"Usage: $0 <cmis-db-*.dump> <cmis-files-*.tar.gz>"}
FILES=${2:?"Usage: $0 <cmis-db-*.dump> <cmis-files-*.tar.gz>"}
[ -f "$DB_DUMP" ] || { echo "Not found: $DB_DUMP"; exit 1; }
[ -f "$FILES" ] || { echo "Not found: $FILES"; exit 1; }

STAMP=$(basename "$DB_DUMP" | sed -e 's/^cmis-db-//' -e 's/\.dump$//')
SUMS="$(dirname "$DB_DUMP")/cmis-$STAMP.sha256"
if [ -f "$SUMS" ]; then
  echo "Verifying checksums..."
  ( cd "$(dirname "$DB_DUMP")" && sha256sum -c "cmis-$STAMP.sha256" )
else
  echo "WARNING: no checksum file ($SUMS); the backup cannot be verified."
fi

echo
echo "This REPLACES the live database and all uploaded files with the backup from $STAMP."
printf "Type RESTORE to continue: "
read -r answer
[ "$answer" = "RESTORE" ] || { echo "Cancelled."; exit 1; }

set -a; . ./.env; set +a

echo "Stopping the application..."
docker compose stop web api housekeeping backup

echo "Restoring the database..."
docker compose exec -T db pg_restore --clean --if-exists --no-owner \
  -U "${POSTGRES_USER:-cmis}" -d "${POSTGRES_DB:-cmis}" < "$DB_DUMP"

echo "Restoring uploaded files..."
docker compose run --rm --no-deps --user 0 --entrypoint sh -v "$(cd "$(dirname "$FILES")" && pwd):/restore:ro" api -c \
  "rm -rf /data/media/* /data/private-media/* && tar -xzf /restore/$(basename "$FILES") -C /data && chown -R 10001:10001 /data/media /data/private-media"

echo "Starting the application (migrations run automatically)..."
docker compose up -d
echo "Restore complete. Sign in and check recent records, then tell users to synchronise their devices."
