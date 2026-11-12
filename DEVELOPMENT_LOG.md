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
