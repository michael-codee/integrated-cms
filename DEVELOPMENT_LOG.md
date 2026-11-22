# Development Log — RLWM CMIS

This log records completed work, technical decisions, outstanding tasks and
known limitations, phase by phase.

---

## Phase 1 — Foundation  ✅

**Completed**

- Architecture, database design, module breakdown and roadmap (`docs/ARCHITECTURE.md`).
- Django 5.2 project with environment-specific settings (dev / test / prod); production settings refuse to start with a weak secret key and enable HSTS, secure cookies, SSL redirect.
- Shared base models: UUID keys, created/updated by/at, **soft deletion** (hard deletes raise), **sync metadata** (`version`, global `sync_seq` cursor from a Postgres sequence, device id, client timestamps).
- **Organisation tree** (`OrgUnit`): headquarters → region → district → branch → congregation, materialised path, safe subtree moves, hierarchy validation, unit history, activation/deactivation.
- **Jurisdiction scoping engine** (`apps/core/scoping.py`): every list query and every write is filtered/checked against the user's role assignments at server and query level.
- **Accounts & RBAC**: custom user (username or email login, statuses active/suspended/deactivated), roles with levels, `module.action` permissions (18 modules × 9 actions), role assignments bound to an org unit and dates; 19 seeded roles (all editable). Guards: cannot grant/edit a role more senior than your own; cannot manage more senior users; cannot change your own assignments; System Administrator role cannot be weakened.
- **Authentication**: Argon2 hashing, 15-min JWT access token held in memory + rotating 7-day refresh token in an httpOnly SameSite=Strict cookie (blacklisted on rotation/logout), custom-header CSRF guard on cookie endpoints, rate limits, account lockout after repeated failures, generic error messages, timing equalisation, tokens invalidated by password change and by suspension.
- **Password reset** by email (hashed single-use tokens, expiry) and administrator-issued one-time reset links for officers without email.
- **Audit log**: append-only (model guard + PostgreSQL trigger blocking UPDATE/DELETE), field-level before/after diffs, IP, user agent, device id; scoped viewer.
- **System settings & configuration**: ministry profile/logo, default currency SLE (+USD/GBP/EUR), configurable financial year start month with automatic financial-year creation, data/audit retention settings, editable categories (membership, finance income/expense, asset with depreciation defaults, program, service types, document).
- **Seed** (`manage.py seed_initial`, idempotent, production-safe): roles, permissions, currencies, categories, and the known structure — National HQ (Koidu City); Eastern Region (Kono District: Kono District HQ Church, Lei Chiefdom, Mafindor; Kenema District: Kenema); Southern Region (Bo, Moyamba); Western Area (Freetown); Northern Region with Bombali District (Makeni) marked *planned*. No accounts, members, money or assets are seeded.
- **Secure provisioning** (`manage.py provision_admin`): interactive or secret-from-environment password, validated, forced change at first sign-in.
- **Frontend shell**: branded login (logo, royal blue & gold, scripture), responsive sidebar layout with mobile drawer, light/dark mode, online/offline indicator, breadcrumbs, toasts, confirmation dialogs, data tables; pages for church structure (tree, profile, history, add/edit/move/activate), users (create, roles, suspend, reset link, unlock), roles & permission matrix, system settings (profile, logo, financial years, categories), audit trail, my profile & password change (forced on first sign-in).
- PWA foundation: manifest + icons from the ministry logo, Workbox service worker precaching the app shell, IndexedDB schema (records / outbox / meta), offline session cache bound to the user and wiped on sign-out.
- CI workflow (GitHub Actions): backend tests on PostgreSQL 16, migration drift check, frontend type-check, unit tests and build.

**Tests:** 44 backend tests (authentication, lockout, token rotation/revocation, password reset, RBAC and jurisdiction isolation for GO / regional / district / pastor, hierarchy rules, subtree moves, audit immutability at DB level, settings permissions, seed idempotency, provisioning) + 5 frontend unit tests. Manual browser check of every Phase 1 page.

**Technical decisions**

- *Single `org_unit` table with materialised paths* instead of separate region/district/branch tables: new levels or international units need no schema change, and jurisdiction checks are one indexed prefix query.
- *Vite SPA instead of Next.js*: offline-first PWA, static hosting, no server rendering cost.
- *JWT + httpOnly refresh cookie* rather than Django sessions: the same API serves future mobile apps; the refresh token is never readable by JavaScript.
- *Sync cursor from a Postgres sequence* (`sync_seq`) rather than timestamps: monotonic and immune to device clock skew.

**Known limitations / outstanding**

- Offline sign-in uses the cached profile for up to 7 days after the last online sign-in on that device; there is no offline PIN yet (Phase 6 review).
- The service worker is disabled in `npm run dev`; test offline behaviour with `npm run build && npm run preview`.

---

## Phase 2 — Membership, leadership & executive dashboard  ✅

**Completed**

- **Membership register** (`apps/members`): full member profile (personal, contact, marital status, occupation, emergency contact, branch, category, previous affiliation, notes), automatic membership numbers from a PostgreSQL sequence with a configurable prefix, photograph upload with explicit consent flag, statuses active / inactive / deceased / withdrawn with exit date and reason.
- **Membership history** for every registration, edit, status change, baptism and transfer; **duplicate detection** (name + phone/email/date of birth) before registration.
- **Baptism records** (date, place, officiating minister) — recording one updates the member's baptism status.
- **Member transfers** between branches: request at the sending branch, approval or rejection at the receiving branch (requires `members.approve` there), cancellation, at most one pending transfer per member, auto-completion when the requester may approve at the destination.
- Search and filters (branch subtree, status, category, gender, age group, baptism, join date), CSV / Excel / PDF exports with the ministry logo (permission-checked, rate-limited and audited).
- **Membership analytics**: totals, new members per month, 12-month growth, gender, age groups, categories, baptism rate, roll-up by region/district/branch.
- **Leadership appointments**: configurable positions (Pastor-in-Charge, District Overseer, etc.), appointment history per unit; head positions require explicitly replacing the current holder.
- **Executive dashboard** with pluggable, permission-gated sections (structure, membership, "requires your attention"), filters by region / district / branch, financial year or date range; out-of-jurisdiction units are refused (403). Later phases add finance, assets, programs, attendance and compliance sections without touching the page.
- **Branch map** (OpenStreetMap) and branch directory endpoint used for cross-jurisdiction transfer destinations (name and code only).
- Shared infrastructure: export engine, domain-event publisher (consumed by notifications in Phase 4), demo-data generator (`manage.py seed_demo`, refused unless `ALLOW_DEMO_DATA=true`; demo rows flagged and purgeable).
- **Offline**: member register and profiles cached in IndexedDB; registrations and edits made offline go to the outbox with a "pending sync" badge; dashboard last result cached for offline viewing.
- Charts use a validated colour-blind-safe palette with light and dark variants, and every chart has a table view.

**Tests:** 74 backend tests (Phase 1 plus member CRUD and numbering, jurisdiction isolation of members, duplicate detection, status changes, baptism, transfer approval rules, exports, leadership appointments, dashboard scoping and figures) + 5 frontend unit tests. Browser check of dashboard, register, analytics, member profile, transfers, structure map and leadership panel.

**Known limitations / outstanding**

- Offline edits are queued but the full conflict-resolution engine (server idempotency keys, version conflicts, Sync Centre) lands in Phase 5; until then queued changes replay in order when the device reconnects.
- Map tiles need internet access; branches without coordinates are listed under the map rather than plotted.

---

## Phase 3 — Finance & assets  ✅

**Completed — finance (`apps/finance`)**

- **Accounts** per unit (cash box, bank, mobile money) with currency, opening balance and live balance from approved entries; accounts with history cannot change unit, currency or opening figures, only be closed.
- **Income and expenditure** entries with category, account, member (optional, jurisdiction-checked), method, external reference, supporting document, program/project. Server-issued references (`INC-/EXP-/REV-YYYY-nnnnnn`). Future dates, wrong-kind categories, other units' accounts, currency mismatches and closed financial years are refused.
- **Configurable approval workflow** (`ApprovalPolicy` + steps): thresholds by amount, entry type and unit type; each step names the hierarchy level that approves (own unit, district, region, headquarters). Initial rules (editable in *Finance → Approval rules*): income — 1 step; expenditure < SLE 5,000 — Pastor-in-Charge; 5,000–25,000 — + District; ≥ 25,000 — + Headquarters; reversals — Pastor + District. Steps are snapshotted at submission.
- **Segregation of duties**: the recorder and the submitter can never approve; nobody approves two steps of the same entry. Approvers can approve, return for correction or reject (reason required). Approvers see only entries whose *current* step they may act on.
- **Immutability**: submitted/approved figures are locked in the service layer *and* by PostgreSQL triggers (no UPDATE of figures, no DELETE of transactions; approval log and reconciliations append-only). Corrections are made with an approved **reversing entry**; the original keeps counting in its period and the reversal counts negative in its own, so closed periods never change.
- **Official receipts** (PDF with logo, approver, reversed watermark) for approved income; printing is audited.
- **Budgets** per unit and financial year with income/expenditure lines; approved by the level above (branch → district → region → HQ), never by the preparer; returned budgets can be revised and resubmitted; **budget vs actual** with over-budget highlighting.
- **Reconciliation** of statement/cash count against book balance at a date, with history.
- **Statement of income and expenditure**: totals, by month, by category, by sub-unit, pending approvals, account balances; filters by unit, financial year or dates; export to PDF/Excel/CSV.
- Dashboard finance section and "requires your attention" items (entries and budgets awaiting approval, entries returned to the recorder).
- **Offline**: entries can be recorded offline as drafts with a client UUID; they upload as drafts and are submitted for approval online. Approval actions are online-only by design.

**Completed — assets (`apps/assets`)**

- **Asset register** with category, unit, location, custodian, condition, status, acquisition details, cost, funding source, supplier, serial/registration/title-deed numbers, warranty and insurance dates, photo and ownership document; server-issued asset numbers.
- **Straight-line depreciation** (category default or per-asset rate), book value and year-by-year schedule; land is not depreciated.
- **Maintenance and inspections** with cost, provider, condition after, next due date; overdue items surface on the dashboard.
- **Transfers** between units approved at the receiving unit (requester cannot approve); **disposal / write-off / loss** approved one level above the holding unit; disposed assets are read-only. Assets are never deleted.
- Register export, analysis (value by category, condition, maintenance due) and dashboard section.

**Security addition**

- Central upload validation (`apps/core/uploads.py`) on every file field: extension allow-list, size limits, content-signature check (renamed executables/HTML refused, SVG never accepted) and random server-side file names.

**Tests:** 104 backend tests (adds 14 finance, 7 assets, 9 upload-safety tests: multi-level approvals, segregation, HQ step, DB-level immutability, reversal netting, return-and-resubmit, validation rules, jurisdiction isolation, budget workflow and performance, reconciliation, policy permissions, offline client IDs, asset transfer/disposal approvals, depreciation, maintenance rules). Browser check of every Phase 3 screen and the dashboard.

**Decisions**

- Approval routing by *hierarchy level* rather than by named role, so it keeps working when people change post: whoever holds `finance.approve` at that level approves.
- Reversal instead of edit/delete for approved money, enforced in the database.

**Known limitations / outstanding**

- Income/expenditure is single-entry by category (church treasury practice), not a full double-entry general ledger. Inter-unit remittances are recorded as expenditure (*Remittance to higher office*) at the sender and income at the receiver.
- Maintenance costs and sale proceeds are recorded under Finance separately (the asset screens remind the user); they are not posted automatically.
- Offline replays of the same draft are refused as duplicates; full idempotent replay and conflict handling arrive with the Phase 5 sync engine.

## Phase 4 — Ministries, programs, attendance & communication  ✅

**Completed — ministries & departments (`apps/departments`)**

- Departments per unit (youth, women, men, children, choir, evangelism, prayer, ushering, media, welfare, other) with leader, meeting schedule and active flag; names unique per unit.
- Department membership with roles (member, leader, assistant, secretary, treasurer); leaving keeps the history and a member can rejoin later. Only members of the department's unit (or its congregations) can join.
- **Department-restricted leaders**: a role assignment can be limited to one department. Such a leader sees and manages only that department's record, programs and attendance; pastors and overseers see every department in their jurisdiction.

**Completed — programs & events (`apps/programs`)**

- Calendar (month view) and list of services, crusades, conferences, revivals, outreach and fellowship meetings with category, organising unit, optional department, venue, coordinator, speakers, expected attendance and budget.
- **Approval** at the unit above the organiser; the planner cannot approve their own program; returning requires a reason. Programs can be postponed (reason), cancelled (reason; then read-only), reinstated, and marked completed only after they start.
- **Outcome report**: summary, decisions for Christ, baptisms and follow-up plan; attendance per day of the program.
- Programs marked *open to every unit* (e.g. a national convention) are visible everywhere but editable only by the organising unit.
- Export to PDF/Excel/CSV; dashboard section (upcoming programs, programs held, decisions and baptisms this year) and attention items (programs awaiting your approval; past programs without an outcome report).

**Completed — attendance (`apps/attendance`)**

- Head counts (men, women, boys, girls, visitors, first-time guests, new converts) per service type, program day or department meeting; one record per gathering per day (checked in the serializer and by a database constraint); no future dates; visitors cannot exceed the total.
- Optional **member register** (setting *allow individual attendance*): members marked present are counted by gender and age (under 13 counts as a child) and visitors are added on top; members from other units are refused.
- Analysis: average Sunday attendance, weekly Sunday trend, composition, average by service type, branch comparison with attendance as a share of active members; export; dashboard section.
- **Offline**: head counts are saved on the device with a client UUID and upload later; the member register needs a connection.

**Completed — notifications & announcements (`apps/notifications`)**

- In-app notifications generated from domain events after the transaction commits: approvers are notified when finance entries, budgets, asset transfers/disposals and programs await them; recorders are notified of decisions. The actor is never notified of their own action. Header bell with unread count, notifications page, mark read / mark all read.
- Announcements addressed to a unit and every unit below it, with priority, scheduled publishing, expiry and pinning. Important and urgent announcements also notify everyone in the audience. Overseers also see what their branches were told. Latest announcements appear on the dashboard.

**Hardening**

- Database integrity errors (e.g. two devices recording the same service at the same moment) now return *409 Conflict* with a plain message instead of a server error.

**Tests:** 119 backend tests (adds program approval at the parent unit, creator segregation, status rules, public programs, department-restricted visibility, attendance uniqueness and validation, register-derived counts, offline client IDs, attendance stats by jurisdiction, notification targeting and privacy, announcement audience and permissions, urgent-announcement notifications, department membership rules). Browser check of the calendar, program detail, attendance entry and analysis, departments, announcements, notifications and dashboard.

**Known limitations / outstanding**

- Notifications are in-app only. E-mail/SMS delivery can subscribe to the same domain events later (SMTP is already configurable).
- Recurring programs (e.g. every Sunday) are not generated automatically; regular services are captured through attendance records by service type.

## Phase 5 — Offline sync, reporting & documents  ✅

**Completed — offline synchronisation (`apps/sync`, `frontend/src/offline`)**

- Every change made on a device goes into an on-device outbox with a client-generated ID and an `Idempotency-Key`. The server stores the response per user and key, so a request replayed after a dropped connection is answered from the stored result and never creates a second record.
- Updates carry the version the device last saw (`If-Match`). If someone changed the record in the meantime the server refuses with *409 version conflict*, returns its copy and records a conflict. The Sync Centre shows both versions field by field; the user keeps the server copy or re-applies their change. Re-applying is blocked for finance entries that are approved or locked, so synchronisation can never overwrite approved financial data.
- Pull feed (`/api/sync/pull/`) per entity with a cursor, limited to the user's jurisdiction, including deletions, so devices keep an up-to-date local copy.
- Header indicator (pending changes, last sync, failures); Sync Centre with queue, history, conflicts and registered devices; retry and discard per change; sign-out warns before discarding unsynchronised changes.
- Bugs found and fixed along the way: the outbox failed to save while offline (a read happened inside the IndexedDB transaction); lazily loaded screens failed offline on the first visit (the service worker now takes control immediately); rows created in bulk had no sync cursor and were missing from the pull feed (cursor now assigned by default, existing rows backfilled by migration).
- End-to-end browser test (`frontend/e2e/offline.spec.ts`): record attendance while offline, reconnect, confirm exactly one record on the server.

**Completed — hierarchical reporting & compliance (`apps/reports`)**

- Configurable report templates (frequency, unit types, due days, narrative questions). Seeded: branch monthly, district monthly, regional quarterly and annual reports.
- Figures (members, attendance, finance, programs) are computed from the records for the period and **frozen on submission**; narrative answers are added by the unit. The unit above reviews: accept, or return with a reason.
- Compliance view per period: submitted on time, late, overdue or not started for every unit below; export to PDF/Excel/CSV; PDF of each report with the church logo. Dashboard section and attention items for due and awaiting reports.

**Completed — documents & records (`apps/documents`)**

- Documents (certificates, title deeds, minutes, policies, letters…) stored **outside the web root** and served only through the API after a permission check. Each upload is a new immutable version with its SHA-256 checksum; downloads are audited and sent with a sandboxing content policy. Restricted documents are visible only to holders of `documents.edit` in that unit. Expiry dates and archiving.
- Uploads are limited by size and extension (`MAX_UPLOAD_MB`, `ALLOWED_UPLOAD_EXTENSIONS`).

**Tests:** 134 backend tests (adds idempotent replay, version conflicts, conflict resolution permissions, pull-feed jurisdiction and tombstones, report figures, submission freezing, review at the parent unit, compliance, documents access, versions and private download) plus the offline browser test.

**Known limitations / outstanding**

- The member register and document uploads need a connection; head counts, members, finance entries and assets work offline.

---

## Phase 6 — Security review, deployment, backups & documentation  ✅

**Security review — findings and fixes**

- *Uploaded files were reachable by URL.* Member photos, finance supporting documents and asset documents lived under `/media/` with random names but no access check. They are now never served by the web server: serializers return short-lived signed links (`/api/files/<token>/`, `FILE_URL_MAX_AGE`, default 1 hour) that are only issued to someone allowed to see the record; responses carry `nosniff`, a sandboxing CSP and `Cross-Origin-Resource-Policy`. Documents & records were already in separate private storage with permission-checked, audited downloads.
- *API documentation was public.* In production `/api/docs/` and `/api/schema/` now require a staff session unless `API_DOCS_PUBLIC=true`. The schema now declares the JWT scheme and response types for summary endpoints.
- *No retention for technical records.* New `purge_expired` command (run daily by the `housekeeping` container) removes old idempotency records, used/expired password-reset links, expired refresh tokens and old read notifications. Church records, finance, sync conflicts and the audit trail are never purged.
- Reviewed and confirmed: server-side permission and jurisdiction checks on every endpoint (out-of-jurisdiction records return 404); Argon2 hashing; lockout and rate limits; refresh token in an httpOnly SameSite=Strict cookie with a custom-header CSRF guard; generic answers on sign-in and password reset; database-level immutability of approved finance and the audit trail; upload content checks; `manage.py check --deploy` clean apart from HSTS preload (deliberately not enabled).
- Web server headers (Caddy): HSTS, strict Content-Security-Policy (self only, plus OpenStreetMap tiles), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`; request size limit; no-cache for the service worker and app shell so updates reach devices.

**Deployment**

- `docker-compose.yml`: PostgreSQL 16 (not published on the host), API (gunicorn, non-root user, migrations and idempotent seed on start, health check), Caddy web server with automatic HTTPS, `housekeeping` and `backup` containers. Named volumes for the database, public uploads and private documents.
- `deploy/backup.sh`: nightly `pg_dump` (custom format) + archive of all uploads + SHA-256 checksums, retention by `BACKUP_KEEP_DAYS`. `deploy/restore.sh`: verifies checksums, asks for confirmation, restores database and files, restarts.
- **Verified locally:** the stack builds and starts; first administrator provisioned with `provision_admin`; sign-in through Caddy; member photo upload served only via signed link (`/media/...` not reachable); Django admin static files; backup written; restore round trip (a member created after the backup disappeared after restore, the photo file came back with the right owner, sign-in still worked).

**Documentation**

- `docs/DEPLOYMENT.md` (server, configuration, first accounts, updates, security notes, retention, troubleshooting), `docs/BACKUP_AND_RESTORE.md`, `docs/USER_MANUAL.md` (by task, including offline work and the Sync Centre), `docs/ADMIN_MANUAL.md` (roles and jurisdiction, users, settings, approval rules, audit, security routine), `docs/API.md` (authentication, sync protocol, conventions, resources).

**Tests:** 139 backend tests (adds signed-link serving, tampered/expired/traversal links refused, `/media` not served, photos returned as signed links, retention keeps recent records and the audit trail) + 5 frontend unit tests + the offline end-to-end browser test.

**Known limitations / outstanding (whole system)**

- Offline sign-in relies on the cached session for up to 7 days after the last online sign-in on that device; there is no separate offline PIN, so devices must have a screen lock. A lost device should have its account suspended at once.
- Notifications are in-app only (no email/SMS delivery yet); recurring programs are not generated automatically.
- Finance is single-entry income/expenditure by category, not a double-entry general ledger.
- The member attendance register, uploads and all approvals need a connection.
- Backups are written on the same server; copying them off-site is a manual step described in the backup guide.
- The Docker stack was verified on a single test machine with plain HTTP; HTTPS certificate issuance depends on the real domain and DNS at installation.

---

## Deployment option — Vercel + Supabase  ✅

**Completed**

- Settings: `DATABASE_URL` (Supabase connection string, SSL required); `DB_POOLER=transaction` for Supabase's transaction pooler (no persistent connections, server-side cursors or prepared statements); `FILE_STORAGE=s3` keeps uploads and Documents & records in two private S3-compatible buckets (Supabase Storage) through `django-storages`; database-backed cache so rate limits hold across serverless instances; admin static files served without a collect step.
- Export logos are read from object storage when the logo is not on local disk.
- `api/index.py` (Django as one Vercel Python function) and `vercel.json`: app build, `/api`, `/django-admin` and `/static` rewrites, the same security headers as the Caddy server, London region, daily Vercel Cron to `/api/cron/housekeeping/` (protected by `CRON_SECRET`; 404 without it).
- `manage.py secure_supabase`: revokes the Supabase Data API roles (`anon`, `authenticated`) from every table, sequence and function and enables Row Level Security on every table, so the church data is reachable only through the Django API.
- GitHub Actions workflow *Supabase database* (run by hand): migrate + seed + lock-down, and creating the first administrator from a temporary secret.
- Guide: `docs/DEPLOY_VERCEL_SUPABASE.md`.

**Verified locally:** `vercel build` (CLI 50.4.0) completes and produces the expected routes, function and cron; the API run through the Vercel entry point, a PgBouncer transaction pooler and an S3-compatible store (moto) passed a smoke test: sign-in, member photo to bucket and back through a signed link, idempotent replay, document upload and download from the private bucket, logo from the bucket in PDF and Excel exports, sync pull, cron with and without the secret, admin static files, API docs hidden; both with the original request path and with the rewritten one. The offline end-to-end browser test passed against that setup. 141 backend tests.

**Not verified here:** a real Vercel deployment and a real Supabase project (no access from this environment). The first real deploy is the remaining check.

**Known limitations:** uploads limited to 4 MB by Vercel; Supabase daily backups cover the database only, so buckets must be copied separately; cold start of a few seconds after idle periods.

---

## Admin-defined church structure and branch removal  ✅

**Completed**

- `StructureLevel` model: the levels of the hierarchy (name, plural, position, unit-code prefix, icon, whether members register there, in use). The five original levels are installed by migration, so existing units keep working. Headquarters (root) and Branch are system levels: renamable, not removable.
- `OrgUnit.unit_type` and `LeadershipPosition.unit_type` now hold a level code instead of a fixed choice; placement rules, code generation, member/transfer checks, finance approval routing, report templates, the branch directory and the dashboard read the levels instead of hard-coded lists.
- API `/api/structure-levels/` (read: anyone signed in; change: `settings.edit`). Moving a level is refused if existing units would end up under a lower level; a level with units cannot be deleted, only taken out of use.
- `GET /api/org-units/{id}/dependencies/` lists what still belongs to a unit. `DELETE` only removes (soft-deletes) a unit with nothing attached and returns 409 `unit_in_use` otherwise; it records a `removed` history event. Headquarters can be neither closed nor removed. The unit delete previously always returned 403; it now works for `org.delete` holders.
- UI: *Church structure → Structure levels* tab; counts and "Add <level>" follow the defined levels; *Close* (with reason) / *Reopen*; *Remove* dialog that lists attached records and offers to close instead.

**Verified:** 169 backend tests (17 new), type check, unit tests and production build; flows checked in a browser.

---

## Monthly membership dues  ✅

**Completed**

- *Finance → Monthly dues*: a register of members × months for a year (paid and approved, awaiting approval, not paid) and a **Record dues** form (member, first month, 1–12 months, amount per month, account, method, reference). Works offline as a draft like other finance entries; choosing a member needs a connection.
- A dues payment is an ordinary income `Transaction` in the new *Monthly membership dues* category with `dues_month` (first month) and `dues_months`. It therefore follows the existing income approval policy, the *income approval* setting, segregation of duties, receipts, reversal and closed-year rules unchanged.
- Rules (in `services.validate_dues`, applied on save and again on submit): dues entries need a member and a first month; 1–12 months; at most 12 months ahead; a month cannot be paid twice for a member while another payment for it is awaiting approval or approved (rejected and reversed payments free the month). Submissions for the same member are serialised with a row lock.
- The database guard trigger now also blocks changes to `dues_month`, `dues_months` and (on dues entries) `member_id` once an entry is submitted.
- `GET /api/finance/dues/members/` gives treasurers a member picker (name, number, unit only) scoped to `finance.create`, since treasurers do not hold `members.view`. `GET /api/finance/dues/register/` is scoped to `finance.view`.
- The generic *Record income* form no longer offers the dues category, so dues always carry their months.

**Tests:** 8 new backend tests (approval flow, auto-approval setting, required fields, duplicate months, rejection/reversal freeing months, database guard, jurisdiction, payments spanning two years).

---

## Media presentation, phase 1 — songs, scripture and slides on the screens  ✅

**Completed**

- Backend app `apps.presentation` (permission module `media`): church-wide **song library** (lyrics as plain text, blank line = new slide, `[Chorus]` = section name, full-text search) and **picture library** (backgrounds and picture slides, same upload checks and signed links as other files); **service plans** (order of service) per unit with an ordered list of items (song, scripture, text, picture, blank) and a look (theme), validated on the server. Soft delete and audit trail as everywhere else.
- New default role **Media Team**; media permissions for branch pastors and worship leaders; a data migration grants them to roles that already exist in a live database (`seed_initial` only fills new roles).
- Frontend: **Media presentation** control desk (order of service, slide grid, live screen, Back/Next, Black, Clear words, Logo, keyboard shortcuts, quick scripture, quick song, five looks with background picture, text size, alignment) and a **projector window** (`/presentation/output`) that opens on the second screen where the browser allows it. Desk and projector talk through a `BroadcastChannel` on the same computer, so the screens do not depend on the internet; pictures travel as Blobs, so no signed link expires on the projector.
- **King James Version** (public domain, 31,102 verses) ships as `/bible/kjv.json` (1.2 MB compressed), cached by the service worker on first use; references such as `jn 3:16-18`, `Ps 23`, `II Kings 2:9` are understood.
- The desk keeps a local copy of the plans and songs it opened (cleared on sign-out) for use if the connection drops mid-service.

**Tests:** 12 backend tests (library sharing and search, permissions, uploads, plan scoping, item and theme validation, permission migration) + 3 frontend unit tests (scripture lookup, song slides); an end-to-end browser run covered adding a song, building an order of service, opening the projector window, going live, moving across items with the keyboard, black screen, changing the look, quick scripture and reloading the projector window.

**Next phases (not built):** video files and live camera or HDMI-capture feeds, video backgrounds, lower thirds, countdown timer, stage display for the preacher; then phone remote and other Bible translations (licence needed). Streaming to YouTube or Facebook is left to OBS.

---

## Media presentation, phase 2 — video, live camera, captions, countdown, stage display  ✅

**Completed**

- **Videos on the media computer**: files are copied into the browser's own storage (IndexedDB `rlwm-media-local`, persistent storage requested, 1.5 GB per file) instead of uploaded, so a service never waits on the connection. Plans store only a local id and the file name; another computer with the same file name plays it. Kept on sign-out (church media, not personal records).
- **Video items and player**: the projector window plays the file with sound; desk and projector follow one transport (position + time it was set, same clock), so pause, seek, start again, repeat and volume stay in step and a reloaded projector resumes in place. The projector reports progress back for the desk's time bar and the stage display. If the browser blocks sound, the video plays muted and the desk says to click the projector window once.
- **Moving backgrounds**: a local video looping silently behind the words (`theme.background_video`, with the file name).
- **Live camera / HDMI capture** as a plan item or a one-click **Show**; device chosen on the desk and remembered on that computer (by id and name, since Chrome gives each window its own device ids); optional sound from the capture card's own audio input (echo cancellation off). Errors show on the desk preview only, never on the projector.
- **Name captions** (lower thirds) over anything, with a list of recent captions; **countdown** to a number of minutes or a clock time, full screen or in the corner, on the screen, the stage display or both.
- **Stage display** (`/presentation/stage`): what is on screen, the next slide (carrying on into the next item), notes for the current item, clock, countdown (turns red when over time) and flashing messages from the desk. Items of any kind can carry notes (`notes`, at most 2,000 characters) that never reach the projector.
- **Camera permission for the media pages only**: the media pages are served from their own copy of the app shell (`presentation.html`, a second Vite entry) with `Permissions-Policy: camera=(self), microphone=(self)`; the rest of the app keeps `camera=()`. The service worker serves `presentation.html` for `/presentation/*` navigations so the header holds offline too, and the sidebar links to the media pages load the page afresh when the current page has the camera switched off. `media-src 'self' blob:` added to the CSP. Same rules in `vercel.json` and the Caddyfile.
- No database migration: video, camera and notes live in the plan's existing JSON fields; the server validates them.

**Tests:** 1 new backend test and 3 new validation cases (video/camera/notes items, background video), 6 new frontend unit tests (transport timing, finding a video by name, time formats, video/camera slides, next slide for the stage display); a browser run with a fake camera and a sample video covered adding a video, video and camera items with notes, saving, projector and stage windows, play/pause by keyboard, camera on the projector, caption, corner and full-screen countdown, stage message, moving background and reloading the projector.

**Known limitations:** videos must be added on each media computer; the camera picture is not mixed with slides (a caption is the only overlay). Phone remote and other Bible translations remain for a later phase.

