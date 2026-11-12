# RLWM Church Management Information System

Integrated Church Management Information System (CMIS) for **Rivers of Living
Water Ministries (Holy Ghost Bible Church)**, headquartered in Koidu City, Kono
District, Eastern Province, Sierra Leone.

> *"Let all things be done decently and in order."* — 1 Corinthians 14:40 (KJV)

The system centralises administration for headquarters, regions, districts,
branches and congregations: membership, finances with approval workflows,
assets, programs, attendance, ministries, hierarchical reporting, documents and
notifications. It is an **offline-first Progressive Web App**: officers in
areas with poor connectivity can keep working and synchronise later.

| | |
|---|---|
| Backend | Django 5.2 + Django REST Framework, PostgreSQL 16 |
| Frontend | React 18 + TypeScript (Vite), Tailwind CSS, Recharts, Dexie (IndexedDB), Workbox |
| Docs | [Architecture & database design](docs/ARCHITECTURE.md) · [Deployment](docs/DEPLOYMENT.md) · [Backup & restore](docs/BACKUP_AND_RESTORE.md) · [User manual](docs/USER_MANUAL.md) · [Administrator manual](docs/ADMIN_MANUAL.md) · [API](docs/API.md) · [Development log](DEVELOPMENT_LOG.md) |

## Production (Docker)

```bash
cp .env.example .env            # set the secret key, domain, database password, SMTP
docker compose up -d --build    # PostgreSQL, API, HTTPS web server, housekeeping, nightly backups
docker compose exec api python manage.py provision_admin --role system_admin
```

Full instructions, security notes and troubleshooting: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Quick start (development)

Requirements: Python 3.12+, Node 20+, PostgreSQL 16.

```bash
# 1. Database
createuser cmis --createdb --pwprompt   # password: cmis (dev only)
createdb cmis --owner cmis

# 2. Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
python manage.py migrate
python manage.py seed_initial                    # roles, categories, church structure (no accounts)
python manage.py provision_admin --role system_admin   # prompts for username, email, password
python manage.py runserver                       # http://127.0.0.1:8000  (API docs at /api/docs/)

# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev                                      # http://localhost:5173 (proxies /api to :8000)
```

There are **no default accounts or passwords**. The first System Administrator
and General Overseer are created with `provision_admin` during installation.

## Tests

```bash
cd backend && python -m pytest          # API, permissions, scoping, finance rules…
cd frontend && npx vitest run           # unit tests
cd frontend && npx tsc -b               # type check
cd frontend && npm run build && npx playwright test   # offline end-to-end test (needs the API running)
```

## Repository layout

```
backend/    Django project (config/, apps/<module>/)
frontend/   React PWA (src/app, src/modules/<module>, src/offline, src/components/ui)
docs/       Architecture, deployment, backup, manuals, API
deploy/     Backup and restore scripts
```
