# Deployment guide

This guide installs the RLWM CMIS on one Linux server with Docker. The stack is:

| Container | Purpose |
|---|---|
| `db` | PostgreSQL 16. Not published on the host; only the API containers reach it. |
| `api` | Django API (gunicorn). Applies migrations and the idempotent seed on every start. |
| `web` | Caddy: serves the PWA, proxies `/api`, obtains and renews the HTTPS certificate. |
| `housekeeping` | Runs `purge_expired` daily (data retention, see below). |
| `backup` | Nightly database and file backup into `./backups` (see [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md)). |

## 1. Server requirements

- Ubuntu 22.04/24.04 LTS (or any Linux with Docker Engine 24+ and the Compose plugin).
- 2 vCPU, 4 GB RAM and 40 GB disk are enough for the whole ministry; add disk for uploads and backups.
- A domain name (for example `cmis.rlwm.org`) whose DNS **A record** points to the server.
- Ports **80** and **443** open to the internet (Caddy needs port 80 to obtain the certificate). Close every other port; SSH only with keys.

```bash
# Docker (official convenience script; review it first if your policy requires)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # log out and back in
# Firewall
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443 && sudo ufw enable
```

## 2. Get the code and configure

```bash
git clone https://github.com/michaelstborbor/RLWM.git /opt/rlwm-cmis
cd /opt/rlwm-cmis
cp .env.example .env
chmod 600 .env
```

Edit `.env`. The values that **must** change:

| Variable | What to put |
|---|---|
| `DJANGO_SECRET_KEY` | 50+ random characters: `python3 -c "import secrets;print(secrets.token_urlsafe(64))"`. The API refuses to start with a weak key. Keep it secret and backed up separately; changing it signs everybody out. |
| `DJANGO_ALLOWED_HOSTS`, `CMIS_DOMAIN` | Your domain, e.g. `cmis.rlwm.org`. |
| `CSRF_TRUSTED_ORIGINS`, `FRONTEND_URL` | `https://` + your domain. `FRONTEND_URL` is used in password-reset emails. |
| `POSTGRES_PASSWORD` | A long random password. Set it **before the first start**; the database is created with it. |
| `EMAIL_*`, `DEFAULT_FROM_EMAIL` | An SMTP account for password-reset emails. Without one, administrators can still issue one-time reset links from *Users*. |

Leave `DJANGO_SETTINGS_MODULE=config.settings.prod`. Never set `ALLOW_DEMO_DATA` on a live server.

Prepare the backup folder (the backup container writes to it):

```bash
mkdir -p backups
```

## 3. Start

```bash
docker compose up -d --build
docker compose ps            # api should become "healthy" within a minute
docker compose logs -f api   # Ctrl+C to stop following
```

Open `https://<your domain>`. The first request can take a few seconds while Caddy obtains the certificate.

## 4. Create the first accounts

There are **no default accounts**. Create the System Administrator and the General Overseer on the server:

```bash
docker compose exec api python manage.py provision_admin --role system_admin
docker compose exec api python manage.py provision_admin --role general_overseer
```

Each command asks for username, email, full name and password (validated: at least 10 characters, not common, not similar to the username). The person must change the password at first sign-in. Everyone else is created from *Administration → Users* inside the application and is given roles at a unit (branch, district, region or HQ).

## 5. After installation (checklist)

1. Sign in as the System Administrator. In *System settings*, check the ministry profile, upload the logo, confirm the financial-year start month and currency.
2. In *Church structure*, verify the seeded branches and add congregations, coordinates and addresses.
3. In *Finance → Approval rules*, confirm the thresholds match church policy.
4. Create user accounts for pastors, treasurers and secretaries and assign their roles at the correct unit.
5. Confirm a backup has been written the next morning (`ls backups/`) and copy it off the server (see the backup guide).
6. Do a test restore on a spare machine within the first month.

## 6. Updating to a new version

```bash
cd /opt/rlwm-cmis
docker compose exec backup /scripts/backup.sh     # take a backup first
git pull
docker compose up -d --build                      # migrations run automatically
docker compose ps
```

Users' devices pick up the new version automatically the next time they open the app online; unsynchronised offline changes are kept and uploaded as usual.

## 7. Security notes

- **HTTPS everywhere**: Caddy redirects HTTP to HTTPS and sends HSTS; Django also redirects (`SECURE_SSL_REDIRECT`) and marks cookies `Secure`.
- **Headers**: a strict Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: same-origin` (see `frontend/Caddyfile`). If you add an external service (e.g. another map provider) you must allow it in the CSP.
- **Uploaded files are never served by the web server.** Member photos, receipts and asset documents live in the `media` volume and are delivered only through `/api/files/<signed link>/`. The link is given only to someone allowed to see the record and expires after `FILE_URL_MAX_AGE` seconds (default one hour). *Documents & records* live in the separate `private_media` volume and are downloaded through the API after a permission check; every download is in the audit trail. Do not add a `/media` file server in front of the application.
- **Database** is reachable only from the internal Docker network. Do not publish port 5432.
- **Django admin** (`/django-admin/`) is available only to accounts provisioned with `--django-admin`. Leave it unused in normal operation; everything is managed in the application.
- Rate limits: sign-in 10/min, password reset 5/hour, exports 30/hour per user (adjustable with the `THROTTLE_*` variables). Accounts lock for 15 minutes after 5 failed sign-ins.
- Keep the server updated (`sudo unattended-upgrades`) and rebuild the images monthly (`docker compose build --pull && docker compose up -d`) for operating-system security fixes.

## 8. Data retention

The `housekeeping` container runs `python manage.py purge_expired` every day. It deletes only technical records:

| Record | Kept for |
|---|---|
| Offline-sync idempotency records | `IDEMPOTENCY_KEEP_DAYS` (30) |
| Used or expired password-reset links | 1 day after use/expiry |
| Expired refresh tokens | until expiry |
| Notifications already read | `NOTIFICATION_KEEP_DAYS` (180) |

Members, finance, assets, reports, documents, sync conflicts and the **audit trail are never purged** by the system. Run `docker compose exec api python manage.py purge_expired --dry-run` to see what would be removed.

## 9. Trying the stack without a domain

For a local trial set `CMIS_DOMAIN=:80`, `DJANGO_ALLOWED_HOSTS=localhost`, `CSRF_TRUSTED_ORIGINS=http://localhost`, `FRONTEND_URL=http://localhost` and `SECURE_SSL_REDIRECT=false`, then open `http://localhost`. Never run a live system without HTTPS.

## 10. Troubleshooting

| Symptom | Check |
|---|---|
| `api` restarts with *Set a strong DJANGO_SECRET_KEY* | The key in `.env` is missing or shorter than 40 characters. |
| Browser shows a certificate error | DNS must point to this server and ports 80/443 must be open; `docker compose logs web`. |
| *Bad Request (400)* | Your domain is missing from `DJANGO_ALLOWED_HOSTS`. |
| Sign-in works but every request fails with 403 CSRF | `CSRF_TRUSTED_ORIGINS` must contain `https://<your domain>`. |
| Uploads fail with *413* | Files above 25 MB are refused by Caddy; the application limit is `MAX_UPLOAD_MB`. |
| No backups appear | `docker compose logs backup`; the folder in `BACKUP_DIR` must exist and be writable. |
