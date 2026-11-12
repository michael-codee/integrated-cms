#!/bin/sh
# One backup run: database (pg_dump custom format), uploaded files (public and private),
# checksums, then removal of backups older than BACKUP_KEEP_DAYS.
# Runs in the `backup` container (postgres image) with the upload volumes mounted read-only at /data.
set -eu
STAMP=$(date -u +%Y%m%d-%H%M%S)
DEST=${BACKUP_TARGET:-/backups}
KEEP=${BACKUP_KEEP_DAYS:-30}
export PGPASSWORD="${POSTGRES_PASSWORD}"

mkdir -p "$DEST"
umask 077
pg_dump -h "${POSTGRES_HOST:-db}" -p "${POSTGRES_PORT:-5432}" -U "${POSTGRES_USER:-cmis}" -d "${POSTGRES_DB:-cmis}" \
  --format=custom --no-owner --file="$DEST/cmis-db-$STAMP.dump"
tar -czf "$DEST/cmis-files-$STAMP.tar.gz" -C /data media private-media
( cd "$DEST" && sha256sum "cmis-db-$STAMP.dump" "cmis-files-$STAMP.tar.gz" > "cmis-$STAMP.sha256" )
echo "Backup written: $DEST/cmis-db-$STAMP.dump, $DEST/cmis-files-$STAMP.tar.gz"

find "$DEST" -maxdepth 1 -name 'cmis-*' -type f -mtime "+$KEEP" -print -delete
