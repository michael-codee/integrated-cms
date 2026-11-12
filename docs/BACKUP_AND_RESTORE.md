# Backup and restore

A complete backup of the CMIS is two files taken at the same moment:

| File | Contains |
|---|---|
| `cmis-db-<timestamp>.dump` | The whole PostgreSQL database (members, finance, assets, reports, audit trail, users, settings), `pg_dump` custom format. |
| `cmis-files-<timestamp>.tar.gz` | All uploaded files: member photos, finance supporting documents, asset photos/documents, logo (`media/`) and *Documents & records* with every version (`private-media/`). |
| `cmis-<timestamp>.sha256` | Checksums of both, used to verify the backup before restoring. |

The secret key in `.env` is **not** in the backup. Store a copy of `.env` separately (for example in the General Overseer's password manager or a sealed envelope in the HQ safe). Without the same `DJANGO_SECRET_KEY`, a restored system works but everybody has to sign in again.

## Automatic nightly backups

The `backup` container runs `deploy/backup.sh` every night at `BACKUP_HOUR` (UTC, default 02:00; Sierra Leone is on UTC). Backups go to the host folder `BACKUP_DIR` (default `./backups`). Backups older than `BACKUP_KEEP_DAYS` (default 30) are deleted.

Run a backup by hand at any time (always do this before an update):

```bash
docker compose exec backup /scripts/backup.sh
ls -lh backups/
```

Backup files are readable only by root on the server (`umask 077`); they contain personal and financial data.

## Off-site copies (required)

A backup that sits only on the same server is lost with the server. At least once a week copy the latest three files somewhere else, for example:

```bash
# to another server over SSH
rsync -a --chmod=F600 backups/ backup-user@backup-host:/srv/rlwm-cmis-backups/

# or encrypted to a USB disk kept at HQ
gpg --symmetric --cipher-algo AES256 backups/cmis-db-20261112-020000.dump
```

Keep at least one monthly copy for a year, and one per financial year end permanently (finance records must remain available for audit).

## Restoring

`deploy/restore.sh` replaces the live database and all uploaded files with a backup. It checks the checksums, asks you to type `RESTORE`, stops the application, restores, and starts it again.

```bash
cd /opt/rlwm-cmis
./deploy/restore.sh backups/cmis-db-20261112-020000.dump backups/cmis-files-20261112-020000.tar.gz
```

After a restore:

1. Sign in and check the most recent members, transactions and reports.
2. Tell users to open the app online and press **Sync now** in the Sync Centre. Offline changes made on devices after the backup was taken are still on those devices and upload normally; changes to records that the restore rolled back appear as conflicts for the user to review.
3. Note the restore (date, which backup, reason) in the church's records; the audit trail itself is restored to the backup's moment.

### Restoring onto a new server

1. Install the server as in [DEPLOYMENT.md](DEPLOYMENT.md) steps 1–3, using the **same `.env`** (same secret key and database password).
2. Copy the backup files into `backups/` and run `./deploy/restore.sh …` as above.
3. Point DNS to the new server.

## Test your backups

Restore the latest backup on a spare machine (or a local trial stack, see DEPLOYMENT.md §9) at least every three months, sign in and check that recent records and documents open. This is the only proof that backups work.

## Without Docker

If the system runs without Docker, the equivalent commands are:

```bash
pg_dump --format=custom --no-owner -d cmis -f cmis-db-$(date -u +%Y%m%d-%H%M%S).dump
tar -czf cmis-files-$(date -u +%Y%m%d-%H%M%S).tar.gz -C /path/to/data media private-media
# restore
pg_restore --clean --if-exists --no-owner -d cmis cmis-db-….dump
tar -xzf cmis-files-….tar.gz -C /path/to/data
python manage.py migrate
```
