# RLWM CMIS — Architecture, Database Design and Roadmap

> *"Let all things be done decently and in order."* — 1 Corinthians 14:40

Integrated Church Management Information System for **Rivers of Living Water
Ministries (Holy Ghost Bible Church)**, headquartered in Koidu City, Kono
District, Eastern Province, Sierra Leone.

---

## 1. Architecture overview

```
 ┌──────────────────────────── Browser / Android / Tablet ───────────────────────────┐
 │  React + TypeScript PWA (Vite, Tailwind, Recharts)                                 │
 │   ├─ UI modules (dashboard, members, finance, assets, programs …)                  │
 │   ├─ Data layer: TanStack Query  ⇄  Offline repository (Dexie / IndexedDB)         │
 │   ├─ Outbox (sync queue)  — every offline write is a queued, idempotent request    │
 │   └─ Service Worker (Workbox): app-shell precache, runtime cache, Background Sync  │
 └───────────────────────────────┬───────────────────────────────────────────────────┘
                                 │ HTTPS (JSON REST, JWT access token + httpOnly refresh cookie)
 ┌───────────────────────────────▼───────────────────────────────────────────────────┐
 │  Caddy (TLS termination, static files, compression)                                │
 ├────────────────────────────────────────────────────────────────────────────────────┤
 │  Django 5 + Django REST Framework (gunicorn)                                       │
 │   ├─ accounts   – users, roles, permissions, role assignments, auth, lockout       │
 │   ├─ organization – org-unit tree, leadership appointments, branch history         │
 │   ├─ configuration – system settings, financial years, lookup categories           │
 │   ├─ members · finance · assets · programs · attendance · ministries               │
 │   ├─ reports (hierarchical submissions) · documents · notifications                │
 │   ├─ dashboard (aggregation queries only, never hard-coded figures)                │
 │   ├─ sync (devices, pull feed, idempotency, conflicts) · audit (append-only log)   │
 │   └─ core – scoping engine, base models, permissions, exports (PDF/XLSX/CSV)       │
 ├────────────────────────────────────────────────────────────────────────────────────┤
 │  PostgreSQL 16  (+ DB triggers guarding approved financial records)               │
 │  Media storage (local volume, S3-compatible later) · nightly pg_dump backups       │
 └────────────────────────────────────────────────────────────────────────────────────┘
```

### Technology decisions

| Concern | Choice | Why |
|---|---|---|
| Backend | **Django 5.2 LTS + DRF** | Mature, secure defaults (CSRF, XSS escaping, ORM parameterised SQL), migrations, admin for emergency ops, long-term support until 2028. |
| Database | **PostgreSQL 16** | Relational integrity, transactions, row-level triggers for financial immutability, sequences for sync cursors. |
| Auth | **SimpleJWT** (15-min access token in memory, 7-day rotating refresh token in an httpOnly, SameSite=Strict cookie) + **Argon2** password hashing | Works for the web PWA *and* future mobile apps; refresh token never exposed to JavaScript. |
| Frontend | **React 18 + TypeScript + Vite** (not Next.js) | An offline-first PWA is a client-rendered app; SSR adds server cost and complicates offline caching. Vite gives a small static bundle that any web server can host. |
| Styling / UI | **Tailwind CSS** + small in-house component kit (Radix primitives for dialogs/menus), **lucide** icons | No paid UI dependency; consistent royal-blue / gold brand theme; light & dark mode. |
| Charts | **Recharts** | As requested; declarative, responsive. |
| Offline | **Workbox** service worker (via vite-plugin-pwa), **Dexie** over IndexedDB, custom outbox + pull-feed sync | See §5. |
| Exports | **ReportLab** (PDF), **openpyxl** (Excel), stdlib CSV | Pure-Python, no system libraries, cheap to host. |
| Tests | **pytest + pytest-django** (backend), **Vitest** (frontend units), **Playwright** (end-to-end incl. offline) | |
| Deployment | **Docker Compose**: postgres, backend, caddy (serves built PWA + proxies `/api`), backup job | Runs on a single US$10–20/month VPS, or self-hosted on a local server. |
| API docs | **drf-spectacular** — OpenAPI 3 at `/api/schema/`, Swagger UI at `/api/docs/` | API-first; future SMS/email/mobile/payment integrations. |

---

## 2. Organisational hierarchy & data isolation

All structure lives in **one self-referencing table, `org_unit`**, with a
`unit_type` (`HEADQUARTERS → REGION → DISTRICT → BRANCH → CONGREGATION`) and a
materialised `path` (e.g. `/0001/0003/0012/0045/`).

* New regions, districts or branches (including international ones) are rows,
  never code changes.
* **Scoping rule:** a user holds one or more **role assignments**, each tied
  to an org unit. A record is visible when its `org_unit.path` *starts with*
  the path of an assignment whose role grants the needed permission. The
  General Overseer and System Administrator are assigned at Headquarters, so
  they naturally see everything; a Regional Overseer assigned to the Eastern
  Region sees only Eastern districts and branches; a Pastor sees only their
  branch.
* This filter is applied in **every queryset on the server** (`ScopedQuerySet.for_user(user, perm)`),
  and object-level checks repeat it on create/update/approve. The frontend
  only hides menu items for convenience; it is never the security boundary.
* Departmental leaders get role assignments that are additionally restricted
  to a `department`, so they only see their own department's records.
* Civil geography (province, government district, chiefdom, town, GPS
  coordinates) are attributes of each org unit, because church districts
  need not match government districts.

### Roles (seeded, editable, plus custom roles)

| Level | Role | Typical scope |
|---|---|---|
| 1 | System Administrator | Headquarters (technical config) |
| 2 | General Overseer | Headquarters (whole ministry) |
| 3 | National / Regional Overseer | Region |
| 4 | District Overseer | District |
| 5 | Pastor-in-Charge / Branch Pastor | Branch |
| 6 | Minister / Departmental Leader | Branch or department |
| — | Church Secretary, Treasurer, Financial Secretary, Accountant, Asset/Property Manager, Membership Officer, Youth / Women's / Men's / Sunday School Coordinators, Choir Leader, Evangelism Coordinator, Project Coordinator | Any unit |

Permissions are `module.action` codes, e.g. `members.view`, `finance.approve`,
`assets.export`, `reports.submit`. Actions: **view, create, edit, delete,
approve, reject, export, print, submit**. Role → permission mapping is data
and can be changed in Settings.

---

## 3. Database design (normalised, PostgreSQL)

Conventions on every business table:

* `id UUID PK` (client-generatable, so offline records keep their identity).
* `created_at, updated_at, created_by, updated_by` — who/when.
* `is_deleted, deleted_at, deleted_by` — **soft deletion** for institutional records.
* Offline-capable tables also carry `version INT` (optimistic concurrency),
  `sync_seq BIGINT` (from a global Postgres sequence, bumped on every write —
  the cursor for the pull feed), `device_id`, `client_created_at`, `client_updated_at`.
* `org_unit_id` on every jurisdiction-owned record (the isolation key), indexed.

### Entity list

**Identity & access**
- `accounts_user` (email unique, username unique, password hash, status *active / suspended / deactivated*, failed_login_count, locked_until, last_login, must_change_password)
- `accounts_role` (code unique, name, level, is_system)
- `accounts_permission` (code unique = module.action, module, action, description)
- `accounts_role_permissions` (role ↔ permission, unique pair)
- `accounts_role_assignment` (user, role, org_unit, department NULL, starts_on, ends_on, is_active, granted_by) — **the jurisdiction grant**
- `accounts_password_reset` (token hash, expires_at, used_at)

**Organisation**
- `org_unit` (code unique e.g. `BR-KON-001`, name, unit_type, parent, path, depth, status *active/inactive*, established_on, address, province, civil_district, chiefdom, town, latitude, longitude, phone, email)
- `org_unit_history` (unit, event *created/renamed/moved/activated/deactivated*, before/after JSON, by, at)
- `leadership_position` (code, title, applies_to unit_type, grants_role)
- `leadership_appointment` (position, org_unit, user NULL, member NULL, starts_on, ends_on, status, appointed_by, appointment_letter document) — creating/ending an appointment grants/revokes the linked role assignment

**Configuration**
- `system_setting` (singleton: ministry name, logo, HQ address, contacts, default currency `SLE`, financial-year start month, branding)
- `financial_year` (name, start, end, is_closed)
- `currency` (code, name, symbol, is_active)
- lookup tables: `membership_category`, `finance_category` (income/expense), `asset_category`, `program_category`, `service_type`, `document_category`
- `report_schedule` (report_type, frequency, applies_to unit_type, due_days_after_period)
- `notification_preference` (user, event_type, channel in-app/email/SMS)

**Membership**
- `member` (membership_no unique e.g. `RLWM-KON-000123`, names, gender, date_of_birth, phone, email, address, current org_unit, joined_on, previous_affiliation, category, status *active/inactive/transferred/deceased/withdrawn*, marital_status, occupation, emergency contact, photo + photo_consent, is_demo)
- `membership_history` (member, event *registered/updated/category_changed/status_changed/transferred/baptized/exited*, from/to values, effective_date, by)
- `baptism` (member, date, location, officiating minister, certificate_no)
- `member_transfer` (member, from_unit, to_unit, requested_by, status *pending/approved/rejected/completed*, approved_by, dates) — completing a transfer **moves** `member.org_unit`; no duplicate member row is ever created
- `member_exit` (member, reason, date, notes)

**Finance**
- `fin_account` (org_unit, name, type *cash/bank/mobile money*, bank details, currency, opening balance, is_restricted_project_fund)
- `fin_project_fund` (org_unit, name, target, restricted flag, status)
- `fin_transaction` (reference unique e.g. `INC-BR-KON-001-2026-000045`, kind *income/expense*, date, amount `NUMERIC(18,2)`, currency, category, account, org_unit, project_fund NULL, description, payment_method, payee / payer, member NULL (tithe payer, optional), requested_by, recorded_by, status *draft/pending/approved/rejected/returned/paid/cancelled*, reverses_transaction NULL, financial_year)
- `fin_attachment` (transaction, file, uploaded_by)
- `approval_policy` (kind, category NULL, min_amount, max_amount NULL, is_active)
- `approval_policy_step` (policy, sequence, approver unit_type, permission required)
- `fin_approval_step` (transaction, sequence, approver_unit, status, decided_by, decided_at, comment)
- `fin_receipt` (transaction, receipt_no unique, issued_at, issued_by)
- `fin_budget` + `fin_budget_line` (org_unit, financial_year, category, amount) — budget vs actual
- `fin_reconciliation` (account, period, statement balance, system balance, difference, notes, reconciled_by)
- **DB trigger**: rows in `approved` or `paid` status cannot have amount/category/account/date/org_unit changed, and no transaction row can be hard-deleted. Corrections are made with a **reversal entry** (`reverses_transaction`) plus a new corrected entry, both going through approval.

**Assets**
- `asset` (asset_no unique, name, category, description, acquired_on, acquisition_cost, current_value, depreciation method & rate, location, org_unit, funding_source, supplier, serial_no, condition *new/good/fair/poor/damaged/lost/disposed*, custodian (user/member), status)
- `asset_photo`, `asset_document`
- `asset_movement` (asset, kind *acquired/assigned/transferred/disposed/lost/damaged*, from_unit, to_unit, from/to custodian, date, by, notes) — the asset's movement history
- `asset_maintenance` (asset, date, type, description, cost, vendor, next_due)
- `asset_inspection` (asset, date, condition, inspector, notes)

**Programs, attendance, ministries**
- `program` (title, description, category, org_unit, department NULL, starts_at, ends_at, venue, coordinator, estimated_budget, status *planned/ongoing/completed/cancelled*, outcome_report)
- `program_participating_unit` (program, org_unit); `program_attachment`
- `program.actual_expenditure` is **derived** from linked `fin_transaction`s (no double entry)
- `attendance_record` (org_unit, date, service_type, program NULL, department NULL, adult_males, adult_females, children, visitors, total (computed + check constraint), recorded_by) — unique per (org_unit, date, service_type, program)
- `member_attendance` (attendance_record, member) — optional individual roll-call
- `department` (name, code, org_unit (level at which it exists), leader member/user, responsibilities, annual allocation)
- `department_membership` (department, member, role, joined_on, left_on)
- `department_report` (department, period, narrative)

**Reporting, documents, communication, audit, sync**
- `report_submission` (schedule, org_unit, period_start, period_end, report_type, status *draft/submitted/under_review/approved/returned*, snapshot JSON (figures auto-computed at submission), narrative, submitted_by/at, reviewed_by/at, reviewer_comment, parent_submission (consolidation))
- `document` (title, category, org_unit, access level *public-internal / unit-restricted / leadership-only*, current_version) + `document_version` (file, checksum, uploaded_by, at, notes)
- `notification` (recipient, type, title, body, link, read_at) + `announcement` (title, body, audience org_unit, published_by, starts/ends)
- `audit_log` (**append-only**; actor, action *create/update/delete/approve/reject/login/export…*, entity, entity_id, org_unit, changes JSON {field: [old, new]}, ip, user_agent, device, at)
- `sync_device` (device_id, user, label, user agent, last_seen, last_sync_at)
- `sync_idempotency` (key unique, user, method, path, response status/body, created_at) — prevents duplicate records when a queued request is replayed
- `sync_conflict` (entity, entity_id, device, user, client_payload, server_snapshot, reason, status *open/resolved*, resolution)

---

## 4. Financial integrity & approval workflow

1. A treasurer/pastor records income or expenditure → status `pending` (or `draft` when saved for later).
2. The system picks the **approval policy** matching kind, category and amount (thresholds editable in Settings, in SLE).
   Default example: expenses ≤ 5,000 → Branch Pastor; ≤ 50,000 → + District Overseer; ≤ 200,000 → + Regional Overseer; above → + General Overseer. Income is verified at branch level by default.
3. Each step is resolved to the **ancestor org unit** of that type and can only be decided by a user who holds `finance.approve` **in that unit** and **is not the person who recorded the transaction** (segregation of duties).
4. Decisions: approve, reject, return for correction — each with comments, stored in `fin_approval_step` and the audit log.
5. Approved expenses are marked **paid** with a payment method; receipts are generated with unique numbers.
6. Approved/paid rows are immutable (application rule **and** DB trigger). Corrections = reversal + replacement.
7. Balances, statements and dashboards are always computed from approved/paid transactions, so summaries reconcile with the ledger by construction (and there is a test asserting it).

---

## 5. Offline-first design

* **App shell** precached by the service worker → the app opens with no internet.
* **Local database (IndexedDB via Dexie)** holds the records the user is authorised to see, fetched through `GET /api/sync/pull?cursor=` (records changed since the last `sync_seq`, already filtered by the user's jurisdiction).
* **Writes** (members, attendance, finance, assets, programs, report drafts) are saved locally first with a client UUID, `version`, timestamps, user id and device id, flagged **"Saved on this device"**, and appended to the **outbox**.
* The outbox replays each change to the normal REST endpoint with an `Idempotency-Key` header (and `If-Match: <version>` for updates). The server stores the outcome per key, so a retried request never creates a duplicate.
* **Conflicts:** if the server version moved on, the server returns `409` with its copy; a `sync_conflict` is recorded and the user resolves it in the Sync Centre. **Financial records are never auto-merged**, and an offline edit can never overwrite an approved transaction (server rejects it outright).
* Replay triggers: Background Sync API where supported, plus `online` events, app start, and a periodic timer (Safari/iOS fallback).
* **Sync Centre** page: pending, synced, failed (with retry), conflicts, last successful sync time.
* Local data is cleared on logout; the offline session is bound to the last authenticated user and expires with the refresh token.

---

## 6. Module breakdown

| # | Module | Key screens / endpoints |
|---|---|---|
| 1 | Executive dashboard & analytics | Role-adaptive KPI cards, membership growth, regional distribution, branch comparison, income vs expenditure, asset distribution, attendance trends, program stats; filters: date range, region, district, branch, financial year, department |
| 2 | Church structure & branches | Org tree visualisation, CRUD for regions/districts/branches, appointments, activation history, branch map (Leaflet + OpenStreetMap, no API key cost) |
| 3 | Membership | Register, profile, history timeline, baptisms, transfers, exits, searchable register, analytics, PDF/Excel |
| 4 | Finance | Income, expenditure, approvals inbox, receipts, accounts, project funds, budgets vs actual, reconciliation, statements (daily → annual, branch → national) |
| 5 | Assets | Register, movements, transfers, maintenance, inspections, depreciation, disposal, inventory reports |
| 6 | Programs & events | Program register, calendar, post-event report & expenditure reconciliation |
| 7 | Attendance | Aggregate counts & optional roll-call, trends, comparisons |
| 8 | Ministries & departments | Departments, members, leaders, allocations, departmental reports |
| 9 | Reporting & accountability | Schedules, submissions, review/return/approve, consolidation upward, compliance dashboard |
| 10 | Documents | Categorised repository, access levels, version history, search |
| 11 | Notifications | In-app notification centre, announcement board, pluggable channels (email now, SMS later) |
| — | Settings & administration | Ministry profile, logo, financial year, currency, categories, roles & permissions, approval thresholds, report schedules, users |
| — | Sync Centre | Offline queue status & conflict resolution |

---

## 7. Repository layout

```
backend/                 Django project
  config/                settings (base/dev/test/prod), urls, wsgi
  apps/<module>/         models, serializers, views, permissions, services, tests
frontend/                Vite React TS PWA
  src/app/               routing, layout, auth provider
  src/modules/<module>/  pages & components per module
  src/offline/           Dexie DB, outbox, sync engine
  src/components/ui/     design-system components
deploy/                  Caddyfile, backup scripts
docker-compose.yml
docs/                    architecture, API, admin manual, user guides, deployment, backup
DEVELOPMENT_LOG.md
```

---

## 8. Implementation roadmap

| Phase | Scope | Exit criteria |
|---|---|---|
| **1 Foundation** | Project scaffolding, base models, org-unit tree, users/roles/permissions/assignments, JWT auth, lockout & rate limits, password reset, audit log, system settings & lookups, secure provisioning command, initial seed, frontend shell (login, layout, theme, settings) | Auth & scoping tests pass; GO sees all, regional user sees only their region |
| **2 Core administration** | Branch management + map + tree, leadership appointments, membership (registration, history, baptisms, transfers, exits), dashboard v1 | Transfers don't duplicate; dashboard figures equal DB counts |
| **3 Finance & assets** | Accounts, income/expense, approval engine, receipts, reversals, budgets, reconciliation, statements; asset register, movements, maintenance, depreciation | Approval & immutability tests; summaries reconcile with ledger |
| **4 Programs & ministries** | Programs, calendar, attendance, departments, department reports | Attendance totals & program expenditure derive from records |
| **5 Reporting & offline** | Hierarchical report submissions, compliance dashboard, PDF/Excel/CSV, PWA, IndexedDB, outbox, pull feed, conflicts, Sync Centre | Playwright: open offline, register member offline, reconnect, synced once |
| **6 Security & deployment** | Security review, performance (indexes, query counts), Docker, Caddy HTTPS, backups/restore, CI, manuals & guides | Full test suite green in CI; deployment guide verified |

Each phase is delivered as a pull request with tests and an updated `DEVELOPMENT_LOG.md`.
