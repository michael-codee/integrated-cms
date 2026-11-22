# User manual — RLWM Church Management Information System

*"Let all things be done decently and in order."* — 1 Corinthians 14:40

This manual is for pastors, overseers, secretaries, treasurers and ministry leaders. Administrators should also read the [Administrator manual](ADMIN_MANUAL.md).

---

## 1. Getting started

### Signing in
Open the CMIS address your administrator gave you (for example `https://cmis.rlwm.org`) in Chrome, Edge, Safari or Firefox. Sign in with your username or email and password. The first time, you must choose a new password (at least 10 characters, not a common word, not like your name).

After 5 wrong passwords the account is locked for 15 minutes. If you forgot your password, choose **Forgot password?** on the sign-in page; a link is emailed to you and works for 2 hours. If you have no email, ask your administrator for a one-time reset link.

### Installing on a phone or computer
The CMIS is an app you can install from the browser:
- **Android / Chrome**: menu ⋮ → *Install app* (or *Add to Home screen*).
- **iPhone / Safari**: Share → *Add to Home Screen*.
- **Windows / Mac (Chrome or Edge)**: the install icon in the address bar.

Sign in once while online on each device. After that the app opens even without internet.

### What you see
The menu on the left (☰ on phones) shows only the parts you are allowed to use. You only ever see the records of the units you are responsible for: a branch pastor sees their branch and its congregations; a district overseer sees the district; a regional overseer the region; HQ sees everything.

The top bar shows **Online** or **Offline – saving on this device**, the sync indicator, notifications (bell), light/dark mode and your profile menu (profile, change password, sign out).

### Signing out
Profile menu → **Sign out**. Signing out removes the church data stored on that device. If there are changes that have not reached the server yet you are warned first: open the **Sync Centre** and synchronise before signing out. Always sign out on shared computers.

---

## 2. Working offline

You can keep working when the network is poor or absent. These are saved on the device and uploaded automatically when the connection returns:

- registering and editing members,
- attendance head counts,
- income and expenditure entries (as drafts),
- programs, assets, and report drafts.

The member attendance register, uploading photographs and documents, and every **approval** need a connection.

### The Sync Centre
Open **Sync Centre** (menu → Overview). It shows:
- **Waiting to upload** – changes saved on this device. Press **Synchronise now** to send them immediately; **Retry** a failed one; **Discard** removes a change you no longer want (this cannot be undone).
- **History** – what has been uploaded.
- **Conflicts** – when someone else changed the same record while you were offline, nothing is overwritten. You see both versions side by side with the differences highlighted, and choose **Keep server version** or **Apply my change**.

**Finance is protected:** if a finance entry was approved or locked on the server, your device's version can never replace it. Keep the server version and, if a correction is needed, ask for a reversing entry.

- **My devices** – the devices you have used and when each last synchronised.

Synchronise at least once a day when you have a connection, and always before signing out.

---

## 3. Dashboard

The dashboard summarises your jurisdiction: structure, membership, finance, assets, programs, attendance, reports and announcements, plus **Requires your attention** (items waiting for your approval, overdue reports, maintenance due, returned entries). Use the filters at the top to choose a region, district or branch and a financial year or date range. Each chart has a table view and can be exported.

---

## 4. Church structure and leadership

*Church structure* shows Headquarters → regions → districts → branches → congregations, with a map. Open a unit to see its profile, leaders and history. Overseers with the right permission can add units, edit details, move a unit and record **leadership appointments** (e.g. Pastor-in-Charge). Appointing a new head requires explicitly replacing the current holder, so the history is kept.

---

## 5. Membership

- **Register member**: fill in the member's details and branch. The system checks for possible duplicates (same name with the same phone, email or date of birth) and shows them before saving. Membership numbers are issued automatically.
- **Photographs** may only be stored when the member has consented; tick the consent box first. Withdrawing consent removes the photograph.
- **Status**: active, inactive, deceased, withdrawn (with date and reason).
- **Baptism**: record date, place and officiating minister.
- **Discipleship** (*Discipleship register*): record when a member completes the **Foundation Class**, **Discipleship Class** and **Spiritual Growth Class** (date, facilitator, certificate no.), from the register or the member's *Discipleship* tab. When all three are recorded the member receives the **badge of discipleship** automatically, shown beside their name. Removing a class recorded in error withdraws the badge until it is recorded again. Filter the register by progress or by the class still needed, and export it.
- **Transfers** (*Member transfers*): the sending branch requests; the receiving branch approves or rejects.
- **Search, filters and exports** (Excel, CSV, PDF with the church logo). Exports are recorded in the audit trail; handle exported member lists with care.

---

## 6. Finance

### Recording income and expenditure
*Finance → Transactions* → **Record income** (or expenditure). Choose the account (cash box, bank, mobile money), category, amount, date and method, and attach a supporting document (receipt, invoice) where you have one. **Save draft** keeps it for later; **Submit for approval** sends it to the approvers. Each entry gets a reference such as `INC-2026-000123`.

### Approvals
Approvers see waiting items under *Finance → Approvals* and on the dashboard. Open an entry and choose **Approve**, **Return** (for correction, with a reason) or **Reject** (with a reason). Who approves depends on the amount and type (see *Approval rules*); for example, large expenditure also needs the district and HQ. The person who recorded or submitted an entry can never approve it, and nobody approves two steps of the same entry.

### Corrections
Once submitted, the figures cannot be edited, and approved entries can never be deleted — this is enforced by the database. To correct an approved entry, create a **reversing entry**, which is approved like any other. The original stays in its period.

### Receipts, budgets, reconciliation, statements
- **Receipts**: print an official receipt (PDF with the logo) for approved income.
- **Budgets**: prepare income and expenditure lines for the financial year and submit; the level above approves. *Budget vs actual* highlights over-spending.
- **Reconciliation**: record the bank statement or cash count against the book balance.
- **Finance overview**: statement of income and expenditure by month, category and sub-unit, with exports.

---

## 7. Assets and property

Register buildings, land, vehicles, instruments and equipment with location, custodian, condition, cost, documents and photos. Record **maintenance and inspections** (with next due date). **Transfers** to another unit are approved by the receiving unit; **disposal, write-off or loss** is approved one level above. Assets are never deleted; disposed assets become read-only. Depreciation and book value are calculated automatically.

---

## 8. Programs, attendance and ministries

- **Programs & events**: plan services, crusades, conferences and outreach with dates, venue, speakers, expected attendance and budget. Programs are approved by the unit above. After the event, record the **outcome** (decisions for Christ, baptisms, follow-up). Postpone or cancel with a reason.
- **Attendance**: **Record attendance** for each service, including the three weekly services (Tuesday Bible Studies, Friday Prayer and Deliverance Service, Sunday Divine Service; the form picks the right one from the date). Count everyone twice: **by ministry** (Men, Women, Children, Youth, Young adults) and **by gender** (male, female). The two subtotals must match. Also record visitors, first-time guests and new converts. If your branch uses the member register, you can tick the members present instead: each is counted under their men's, women's, youth or children's ministry department, or by age if they have none (under 13 children, 13 to 24 youth, 25 to 35 young adults). One record per service per day. Analysis shows the weekly trend for each service, the ministry and gender breakdown, and attendance against membership.
- **Ministries & departments**: youth, women, men, Sunday school, choir and others, with leaders and members.

---

## 9. Reports and compliance

*Reports & compliance* has these tabs:
- **Due from my unit** – reports your unit owes (e.g. branch monthly report). **Start report**: the figures (membership, attendance, finance, programs) are filled in from the records automatically; add the narrative answers, **Save draft**, then submit. On submission the figures are frozen.
- **To review** – reports from the units directly below you. **Accept this report** or **Return for correction** with what needs correcting.
- **All reports** – every report in your jurisdiction; download any report as PDF.
- **Compliance** – for each period, which units submitted on time, late, are overdue or have not started; exportable.

---

## 10. Documents and records

*Documents & records* → **File a document**: certificates, title deeds, minutes, policies, letters. Choose the category, unit, access level and optional expiry date. **Restricted** documents are visible only to people who can edit documents at that unit. To replace a file, **Upload a new version**; earlier versions are kept and can still be downloaded. Every download is recorded in the audit trail.

---

## 11. Notifications and announcements

The bell shows notifications about items waiting for you and decisions on your entries. *Announcements* are addressed to a unit and every unit below it; important and urgent ones also notify everyone in that audience.

---

## 12. Good practice

- Never share your password or sign in for someone else; every action is recorded under your name.
- Lock your phone with a PIN; the app keeps church data on the device while you are signed in.
- Synchronise daily; sign out on shared devices.
- Report mistakes in approved finance entries to your treasurer for a reversing entry rather than trying to work around the system.
