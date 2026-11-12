#!/bin/sh
# Runs deploy/backup.sh once a day at BACKUP_HOUR (UTC, default 02). Sierra Leone time is UTC.
set -u
HOUR=${BACKUP_HOUR:-02}
echo "Backup service started; daily backup at ${HOUR}:00 UTC, keeping ${BACKUP_KEEP_DAYS:-30} days."
while true; do
  now=$(date -u +%s)
  next=$(date -u -d "$(date -u +%Y-%m-%d) ${HOUR}:00:00" +%s)
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))
  /scripts/backup.sh || echo "BACKUP FAILED at $(date -u)" >&2
done
