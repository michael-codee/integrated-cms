# API reference

The CMIS frontend is a client of a documented REST API; future mobile apps or integrations use the same API and the same server-side permission checks.

- **Interactive documentation (OpenAPI / Swagger UI):** `https://<your domain>/api/docs/`
- **Machine-readable schema (OpenAPI 3):** `https://<your domain>/api/schema/` (YAML; add `?format=json` for JSON)

On a production server both are shown only to staff signed in at `/django-admin/` (accounts provisioned with `provision_admin --django-admin`), unless `API_DOCS_PUBLIC=true` is set. Anyone with server access can generate the schema with `docker compose exec api python manage.py spectacular --file /tmp/schema.yml`.

## Conventions

- Base path `/api/`. JSON request and response bodies; `multipart/form-data` for file uploads.
- IDs are UUIDs. Clients may supply the `id` when creating offline-capable records (members, attendance, finance entries, assets, programs) so that a replay cannot create a duplicate.
- Lists are paginated: `?page=2&page_size=50` (max 200) → `{"count", "next", "previous", "results"}`. Most lists accept `search=`, `ordering=` and field filters (see the schema).
- Every list and every write is limited to the caller's **jurisdiction** (the units where they hold a role, and the units below). Records outside it return 404, not 403, so their existence is not revealed.
- Errors: `{"detail": "...", "code": "..."}` or, for validation, `{"field": ["message", ...]}` with status 400. 401 = not signed in / token expired; 403 = no permission; 404 = not found or outside jurisdiction; 409 = conflict (duplicate, version conflict, record in use); 429 = rate limited.
- Exports: list endpoints that support it have `…/export/?file_format=xlsx|csv|pdf` (rate limited, audited).
- Uploaded files are returned as short-lived signed links (`/api/files/<token>/`). Do not store these links; fetch the record again for a fresh one.

## Authentication

```http
POST /api/auth/login/            {"username": "...", "password": "..."}
→ 200 {"access": "<JWT>", "user": {...}}  + httpOnly cookie cmis_refresh (path /api/auth/)
```

Send the access token on every request: `Authorization: Bearer <JWT>`. It expires after 15 minutes. Renew it with:

```http
POST /api/auth/refresh/          (cookie sent automatically; header X-CMIS-Client: web)
→ 200 {"access": "<new JWT>", "user": {...}}  (refresh token rotated; the old one is blacklisted)
```

`/api/auth/refresh/` and `/api/auth/logout/` require the `X-CMIS-Client` header, which a cross-site form cannot send (CSRF protection for the cookie). Other endpoints: `GET /api/auth/me/`, `POST /api/auth/change-password/`, `POST /api/auth/password-reset/` (always answers the same, whether or not the email exists), `POST /api/auth/password-reset/confirm/`.

Tokens stop working immediately when the user is suspended or changes password.

## Offline synchronisation protocol

**Idempotent writes.** Send `Idempotency-Key: <uuid>` on POST/PUT/PATCH/DELETE. The first successful response is stored for that user and key; a repeat of the same request returns the stored response with header `Idempotent-Replay: true` and does nothing else. Reusing a key for a different request → 422; a repeat while the first is still running → 409 `in_progress` (retry shortly). Failed requests are not stored, so they can be retried with the same key.

**Optimistic concurrency.** Send `If-Match: <version>` (the `version` field you last saw) on updates. If the record has changed since, the server answers **409** with `code: "version_conflict"` and the current server copy, records a conflict, and changes nothing.

**Device identity.** Send `X-Device-ID: <stable id>` so devices and conflicts are attributed.

**Pull feed.**

```http
GET /api/sync/pull/?entity=members&cursor=0&limit=200
→ {"entity": "members", "results": [...], "deleted": ["<id>", ...], "cursor": 18233, "more": true}
```

Entities: `members`, `attendance`, `programs`, `transactions`, `assets`. Store `cursor` and pass it next time; repeat while `more` is true. The cursor is a server sequence, independent of device clocks. Rows are limited to the caller's jurisdiction; `deleted` lists records removed since the cursor.

Other sync endpoints: `GET /api/sync/status/`, `/api/sync/conflicts/` (list, `POST …/{id}/resolve/` with `{"resolution": "keep_server" | "use_mine"}`), `/api/sync/devices/`.

Approved or locked finance entries cannot be changed through any endpoint; corrections are reversing entries.

## Resources

| Area | Endpoints |
|---|---|
| Accounts & access | `users`, `roles`, `permissions`, `role-assignments` |
| Structure | `org-units`, `leadership-positions`, `appointments` |
| Configuration | `settings`, `currencies`, `financial-years`, `lookups/<category type>` |
| Membership | `members`, `baptisms`, `member-transfers` |
| Finance | `finance/accounts`, `finance/transactions`, `finance/approval-policies`, `finance/budgets`, `finance/reconciliations`, `finance/summary` |
| Assets | `assets`, `asset-movements`, `asset-maintenance`, `asset-disposals` |
| Ministry | `departments`, `department-members`, `programs`, `attendance`, `attendance/stats` |
| Reporting | `report-templates`, `reports`, `reports/compliance`, `reports/due` |
| Documents | `documents` (with `versions`, `upload-version`, `download` actions) |
| Communication | `notifications`, `announcements` |
| Oversight | `dashboard`, `audit-logs`, `assets/summary`, `org-units/directory` |
| Sync | `sync/pull`, `sync/status`, `sync/conflicts`, `sync/devices` |
| Health | `health` (no authentication; used by the container health check) |

Workflow actions (approve, return, reject, submit, review, transfer…) are `POST` actions on the record, e.g. `POST /api/finance/transactions/{id}/approve/`. The exact list, request bodies and permissions for each are in the interactive documentation.

## Rate limits

| Scope | Default | Variable |
|---|---|---|
| Anonymous | 60/min | `THROTTLE_ANON` |
| Signed-in user | 1200/min | `THROTTLE_USER` |
| Sign-in | 10/min | `THROTTLE_LOGIN` |
| Password reset | 5/hour | `THROTTLE_PASSWORD_RESET` |
| Exports | 30/hour | `THROTTLE_EXPORT` |
