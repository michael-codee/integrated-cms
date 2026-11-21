# Administrator manual

For the System Administrator and senior leaders who manage accounts, roles and configuration. Installation, updates and backups are in [DEPLOYMENT.md](DEPLOYMENT.md) and [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md).

## 1. How access works

Access has two parts, and both are checked **on the server** for every request:

1. **Role** – what someone may do, as `module.action` permissions (e.g. `finance.approve`, `members.export`). There are 18 modules and 9 actions (view, create, edit, delete, approve, reject, export, print, submit).
2. **Unit** – where. A role is assigned **at a unit**; it applies to that unit and every unit below it. A Pastor-in-Charge assigned at *Bo Branch* has no access to *Kenema*. A role assigned at HQ applies everywhere.

A person may hold several assignments (e.g. Treasurer at a branch and Youth Coordinator at the district). Assignments can have start and end dates.

### Default roles
The system starts with 19 roles: System Administrator, General Overseer, National/Regional Overseer, District Overseer, Pastor-in-Charge/Branch Pastor, Minister/Departmental Leader, Church Secretary, Treasurer, Financial Secretary, Accountant, Asset/Property Manager, Membership Officer, and coordinators for youth, women, men, Sunday school, worship, evangelism and projects. All are editable in *Roles & permissions*.

Safeguards built in:
- You cannot grant or edit a role more senior than your own, or manage users more senior than you.
- You cannot change your own role assignments.
- The System Administrator role cannot be weakened.
- Finance segregation of duties is enforced regardless of role: the recorder/submitter of an entry never approves it.

## 2. User accounts

*Administration → Users*:
- **Create user**: username, full name, email (optional but needed for self-service password reset), phone, title. Then **assign a role at a unit**.
- **Suspend / deactivate**: takes effect immediately; the person's sessions stop working. Prefer this to deletion (accounts are never deleted, so history stays attributable).
Click a user to open their account. It has four tabs:

- **Account & password**
  - **Set password**: type a temporary password, or press **Generate**, then **Set password**. The person's open sessions end at once, any lockout is cleared, and they must choose their own password at the next sign-in. Tell them the temporary password in person or by phone.
  - **Issue reset link**: the alternative, a one-time link that expires after `PASSWORD_RESET_TOKEN_HOURS` (2).
  - **Suspend / Reactivate / Deactivate**, and **Unlock** after repeated wrong passwords.
- **Details**: correct the name, title, username, email or phone.
- **Roles & jurisdiction**
  - **Change** on a role moves it to another unit (for example a pastor transferred from Bo to Kenema) or swaps it for another role. The old assignment ends today and the new one starts today, so the history stays visible under *Show past roles*. A reason entered here goes into the audit trail.
  - **End** removes a role.
  - **Add another role** gives the person an extra role at any unit.
- **Access review**: what the person can do today, module by module, and which role gives each permission (hover over a tick). To change what a role allows for everyone who holds it, use *Roles & permissions*.

Every one of these actions is recorded in the audit trail. You can only manage people at or below your own level and within your jurisdiction, and never your own account.

When someone leaves a post, end their assignment (or suspend the account) the same day. Review the user list every quarter.

## 3. Church structure

*Church structure*: add regions, districts, branches and congregations; record addresses and map coordinates; move a unit under a different parent (its whole subtree moves and access follows automatically); deactivate units that close (history is kept). Units marked *planned* (e.g. Makeni) can be activated when they open.

## 4. System settings

*Administration → System settings*:
- **Ministry profile and logo** (the logo appears on exports, receipts and report PDFs; PNG/JPG/WebP).
- **Financial year** start month; financial years are created automatically and can be closed, after which no entries can be dated in them.
- **Currency** (default SLE; USD, GBP, EUR available).
- **Categories**: membership, income/expenditure, asset (with depreciation rates), program, service types, document categories.
- **Individual attendance**: allow branches to record attendance by ticking members present.
- **Retention settings** for data and audit.

## 5. Finance approval rules

*Finance → Approval rules* define how many approval steps an entry needs and at which level (own unit, district, region, HQ), by entry type, amount and unit type. The initial rules are: income — 1 step; expenditure below SLE 5,000 — Pastor-in-Charge; 5,000–25,000 — plus District; 25,000 and above — plus Headquarters; reversals — Pastor plus District. Change them only on a leadership decision; entries already submitted keep the steps they were submitted with.

## 6. Reports

*Reports & compliance → Templates* (needs `settings.edit`): set the frequency, which unit types report, how many days after the period they are due, and the narrative questions. Four templates are seeded: branch monthly, district monthly, regional quarterly, annual. The compliance tab shows who is late.

## 7. Audit trail

*Administration → Audit trail* lists every create, change, approval, export, print, sign-in, failed sign-in, password reset and document download, with who, when, from which IP/device and the before/after values. The trail is append-only: the database itself refuses changes or deletions. Use it to answer "who changed this?" and for periodic financial audits.

## 8. Offline sync oversight

Users with `sync.approve` can see and resolve sync conflicts of other users in their jurisdiction (Sync Centre → Conflicts). Conflicts are kept as a record after resolution.

## 9. Demo data

Never load demo data on the live system. `seed_demo` refuses to run unless `ALLOW_DEMO_DATA=true`, which production settings force off.

## 10. Server tasks (command line)

Run from the installation folder (`/opt/rlwm-cmis`):

| Task | Command |
|---|---|
| Create first administrator / General Overseer | `docker compose exec api python manage.py provision_admin --role system_admin` |
| Backup now | `docker compose exec backup /scripts/backup.sh` |
| Restore | `./deploy/restore.sh backups/cmis-db-….dump backups/cmis-files-….tar.gz` |
| Retention clean-up preview | `docker compose exec api python manage.py purge_expired --dry-run` |
| Logs | `docker compose logs -f api` |
| Status | `docker compose ps` |

## 11. Security routine

- Daily: check the dashboard *attention* items and failed sign-ins in the audit trail.
- Weekly: copy backups off the server.
- Monthly: rebuild images for security updates; review users and role assignments.
- Quarterly: test a restore.
- Immediately when a device is lost: suspend the account (the device can no longer reach the server or upload anything), then reactivate it with a new password on the person's new device. Data already cached on the lost device stays readable to anyone who can unlock it until its offline session expires (7 days after the last online sign-in). This is why every device used for the CMIS must have a screen lock.
