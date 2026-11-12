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
