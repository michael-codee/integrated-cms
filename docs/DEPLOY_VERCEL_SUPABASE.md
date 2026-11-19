# Deploying on Vercel with Supabase

This is the alternative to the Docker server in [DEPLOYMENT.md](DEPLOYMENT.md). It runs:

| Part | Where |
|---|---|
| The app (screens, offline support) | Vercel, as static files on its global network |
| The API (Django) | Vercel, as one Python function (`api/index.py`) |
| Database | Supabase PostgreSQL |
| Uploaded files and Documents & records | Supabase Storage, two **private** buckets |
| Daily clean-up (`purge_expired`) | Vercel Cron, 03:00 UTC |
| Database updates and the first administrator | A GitHub Actions workflow you start by hand |

Everything is in one Vercel project on one address, so sign-in cookies, offline sync and security headers work exactly as on the Docker server.

## Before you start: plans and costs

- **Vercel**: the free *Hobby* plan is for personal, non-commercial use. A ministry's live system should use **Pro** (about US$20 per month per member of the Vercel team). Hobby is fine for a trial.
- **Supabase**: the *Free* plan pauses a project after a week without activity and has **no backups you can restore**. For live church records use **Pro** (about US$25 per month), which includes daily database backups.
- Choose **London** for both (Supabase region *West EU (London)* `eu-west-2`, Vercel region `lhr1`, already set in `vercel.json`). It is the closest region to Sierra Leone on both platforms, and the API and database must be in the same region to be fast.

## 1. Create the Supabase project

1. At [supabase.com](https://supabase.com) → **New project**. Name `rlwm-cmis`, region **West EU (London)**, and a long random **database password** (save it in a password manager).
2. **Turn off the Data API.** *Project Settings → Data API* → switch off the Data API. The CMIS never uses it; every request goes through the Django API, which checks roles and jurisdiction. (The database setup in step 3 also revokes that API's access and enables Row Level Security on every table, as a second lock.)
3. **Connection strings.** Click **Connect** at the top of the project. Copy two of them, putting your database password in place of `[YOUR-PASSWORD]`:
   - **Transaction pooler** (port **6543**), for Vercel. It looks like
     `postgresql://postgres.abcdefghijkl:PASSWORD@aws-0-eu-west-2.pooler.supabase.com:6543/postgres`
   - **Session pooler** (port **5432**), for the GitHub workflow.
   If the password contains `@`, `:`, `/` or `#`, write it URL-encoded (e.g. `@` as `%40`), or choose a password without them.
4. **Storage buckets.** *Storage → New bucket*, twice, both with **Public bucket switched off**:
   - `cmis-media` — member photos, receipts, asset documents, the logo
   - `cmis-documents` — Documents & records
5. **Storage access keys.** *Storage → S3 Configuration* (or *Project Settings → Storage*): make sure S3 connection is enabled, note the **Endpoint** (`https://abcdefghijkl.storage.supabase.co/storage/v1/s3`) and **Region** (`eu-west-2`), then **New access key**. Copy the **Access key ID** and **Secret access key** now; the secret is shown once. These keys can read every file: they go only into Vercel's environment variables.

## 2. Generate two secrets

Run on any computer with Python (or use a password manager's generator for 60+ characters):

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(64))"   # DJANGO_SECRET_KEY
python3 -c "import secrets; print(secrets.token_urlsafe(32))"   # CRON_SECRET
```

## 3. Set up the database (GitHub)

1. In GitHub: repository → **Settings → Secrets and variables → Actions → New repository secret**:
   - `SUPABASE_DB_URL` = the **Session pooler** string (port 5432)
   - `DJANGO_SECRET_KEY` = the key from step 2 (the same value goes to Vercel)
2. **Actions** tab → **Supabase database** → **Run workflow** → task *Update database (migrate)* → **Run**.
   It creates every table, the church structure and roles (no people, money or assets), and locks the Data API out. It takes about a minute; a green tick means done.

## 4. Create the Vercel project

1. At [vercel.com](https://vercel.com) → **Add New… → Project** → import the GitHub repository `RLWM` (allow Vercel's GitHub app to see it if asked).
2. **Framework Preset: Other.** Leave **Root Directory** as the repository root. Leave the build settings alone: `vercel.json` sets them (it builds the app from `frontend/` and the API from `api/index.py`).
3. **Environment Variables** — add these, and tick **Production only** for every one of them. Preview deployments (built for every branch and pull request) must not get the live database or storage keys.

| Name | Value |
|---|---|
| `DJANGO_SECRET_KEY` | from step 2 |
| `DJANGO_ALLOWED_HOSTS` | `rlwm-cmis.vercel.app` (your project's address; add your own domain later, comma-separated) |
| `CSRF_TRUSTED_ORIGINS` | `https://rlwm-cmis.vercel.app` |
| `FRONTEND_URL` | `https://rlwm-cmis.vercel.app` (used in password-reset emails) |
| `DATABASE_URL` | the **Transaction pooler** string (port 6543) |
| `DB_POOLER` | `transaction` |
| `FILE_STORAGE` | `s3` |
| `S3_ENDPOINT_URL` | the Storage endpoint from step 1.5 |
| `S3_REGION` | `eu-west-2` |
| `S3_ACCESS_KEY_ID` | from step 1.5 |
| `S3_SECRET_ACCESS_KEY` | from step 1.5 |
| `S3_BUCKET_MEDIA` | `cmis-media` |
| `S3_BUCKET_PRIVATE` | `cmis-documents` |
| `CACHE_BACKEND` | `database` |
| `STATIC_MANIFEST` | `false` |
| `CRON_SECRET` | from step 2 (Vercel Cron sends it automatically) |
| `MAX_UPLOAD_MB` | `4` (Vercel refuses uploads over 4.5 MB) |
| `EMAIL_BACKEND`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `DEFAULT_FROM_EMAIL` | your SMTP account, for password-reset emails (optional; administrators can issue reset links without it) |

The address Vercel gives the project is shown after the first deploy. If it differs from what you entered, correct the three address variables and **Redeploy**.

4. **Deploy.** When it finishes, open `https://<your project>.vercel.app/api/health/`; it should show `{"status": "ok"}`.

## 5. Create the first accounts

There are no default accounts.

1. Add a repository secret `ADMIN_INITIAL_PASSWORD`: a temporary password of at least 10 characters, not a common word.
2. **Actions → Supabase database → Run workflow** → task *Create first administrator*, role `system_admin`, and the username, email and full name.
3. **Delete the `ADMIN_INITIAL_PASSWORD` secret.** Sign in at your Vercel address; you must choose a new password at once.
4. Repeat with role `general_overseer` for the General Overseer (set the secret again, run, delete it), or create that account from *Administration → Users* inside the app.

Then follow the checklist in [DEPLOYMENT.md §5](DEPLOYMENT.md#5-after-installation-checklist): logo, financial year, branches, approval rules, users.

## 6. Your own domain (optional)

Vercel → project → **Settings → Domains** → add e.g. `cmis.rlwm.org` and create the DNS record Vercel shows. Then add the domain to `DJANGO_ALLOWED_HOSTS`, put `https://cmis.rlwm.org` in `CSRF_TRUSTED_ORIGINS` and `FRONTEND_URL`, and **Redeploy**.

## 7. Updates

Changes merged into `main` deploy to Vercel automatically. When an update includes database changes (files under `backend/apps/*/migrations/`), run **Actions → Supabase database → Update database (migrate)** straight after the merge. Running it when nothing changed is harmless.

## 8. Backups

- **Database:** Supabase Pro keeps daily backups for 7 days (*Database → Backups*), restorable from the dashboard.
- **Files are not in those backups.** Copy the two buckets regularly, and take your own database copy monthly to keep beyond 7 days. From any computer with the AWS CLI and PostgreSQL 16 client tools:

```bash
export AWS_ACCESS_KEY_ID=…  AWS_SECRET_ACCESS_KEY=…   # the Supabase Storage keys
EP=https://abcdefghijkl.storage.supabase.co/storage/v1/s3
aws s3 sync s3://cmis-media     ./cmis-backup/media     --endpoint-url $EP --region eu-west-2
aws s3 sync s3://cmis-documents ./cmis-backup/documents --endpoint-url $EP --region eu-west-2
pg_dump --format=custom --no-owner "<Session pooler string>" -f ./cmis-backup/cmis-db-$(date -u +%Y%m%d).dump
```

Keep these copies encrypted and off the computer used for daily work, as described in [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md). A restore of the database goes back through `pg_restore --clean --if-exists --no-owner -d "<Session pooler string>" file.dump`, followed by the *Update database* workflow.

## 9. Differences from the Docker server

- Uploads (photos, receipts, documents) are limited to **4 MB** by Vercel.
- The first request after a quiet period takes a few seconds while Vercel starts the API. The app itself loads instantly and works offline after the first visit.
- Exports and reports must finish within 60 seconds (enough for the ministry's size).
- Files are served exactly as before: only through short-lived signed links from the API, never directly from Supabase.

## 10. Troubleshooting

| Symptom | Check |
|---|---|
| Every API call fails with 500 right after deploy | Vercel → project → **Logs**. *Set a strong DJANGO_SECRET_KEY* means the key is missing or short; a database error means `DATABASE_URL` is wrong or not the **Transaction pooler** string. |
| `Bad Request (400)` | The address you used is missing from `DJANGO_ALLOWED_HOSTS`. |
| `prepared statement … does not exist` | `DB_POOLER=transaction` is missing. |
| Uploads fail with *403/AccessDenied* or *NoSuchBucket* | Storage keys, endpoint, region or bucket names. |
| Uploads fail with *413* | The file is over 4 MB. |
| The workflow fails at *Check the secrets* | Add the repository secrets named in the message. |
| Sign-in works but the API answers 403 to admin pages | Expected for `/api/docs/`: see [API.md](API.md). |
