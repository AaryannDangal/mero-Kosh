# Mero Kosh · मेरो कोष

A transparent, bilingual (English / नेपाली) record-keeping app for Nepali rotating savings groups (ढुकुटी / ROSCA).

> **No money is moved by this app.** Mero Kosh never receives, holds or transfers funds. Members pay each other directly (cash, bank transfer, eSewa, Khalti). The app only **records** payments, stores **proof**, and **calculates** balances, payouts, late fees and reconciliations.

---

## Contents

1. [Features](#features)
2. [Tech stack & structure](#tech-stack--structure)
3. [Quick start (local)](#quick-start-local)
4. [Seed data & demo logins](#seed-data--demo-logins)
5. [Tests](#tests)
6. [Accounting model](#accounting-model)
7. [API reference](#api-reference)
8. [Deployment (Vercel + Railway/Render)](#deployment)
9. [Security](#security)
10. [Replacing local uploads with S3 / Cloudinary](#replacing-local-uploads-with-s3--cloudinary)
11. [Licences & attribution](#licences--attribution)

User guide (EN + NE): [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md)

---

## Features

| Area | What it does |
|---|---|
| **Groups** | Name, currency (NPR default), contribution, member count, start date, monthly / biweekly / weekly frequency, due day, fixed rotation, admin selection by visible member requests, or bidding, late fee (none / fixed / percentage / daily, optional cap) + grace period, "keep contributing after receiving the pot", missed-payment and early-exit rules, early-exit penalty. Rules are generated in **English and Nepali** from the configuration and the organizer **must confirm them before round 1**. |
| **Roles** | Organizer (full control, can delete the group) · Co-organizer (everything except deleting) · Member (own data, upload proof, bid, dispute, shared ledger) · Viewer (read-only ledger/reports). |
| **Members** | Name, international phone (stored in E.164), optional email, payment method + identifier (eSewa/Khalti ID or masked account — card numbers are rejected), optional photo, join date, role, status (active, waiting, received pot, exited, suspended, defaulted). Organizers can share a short group code plus a password they set; each join request needs organizer approval and links to a matching pre-added phone seat or an open seat. Single-use, 14-day personal invitations remain available. Early-exit quote: amount owed by/to the member, settlement by payment, approved replacement or refund at cycle end. |
| **Rounds** | Number, period, due date, full pot, recipient, bid discount, payout, discount share, expected/actual collection, late fees, opening/closing balance, reconciliation status. Statuses: upcoming → collecting → payout pending → completed (or disputed). |
| **Fixed rotation** | Recipient = next waiting member by rotation order; receives the full pot. |
| **Admin selection** | Eligible members can request an open round's pot; the request list is visible to the group, and only the organizer or co-organizer selects the recipient. A request is not a promise of selection. |
| **Bidding** | Sealed bids (= discount accepted). Min/max limits, tie-break by earliest bid or random draw, bids revealed after selection, last eligible member auto-assigned, organizer override with mandatory reason (audit-logged). |
| **Ledger** | Contribution, pot payout, bid discount, late fee, penalty, refund, correction, manual adjustment. Pending → verified / rejected. Verification requires proof, except organizers can explicitly confirm cash received in person; that confirmation is audit-logged and visible in the ledger. **Verified entries are immutable** (DB trigger); fixes are correction entries. Disputes with recorded resolutions. |
| **Late fees** | Assessed automatically after the grace period (fixed, % of the amount due, or per day, optionally capped). Missed payments become arrears; members with arrears cannot win or bid. |
| **Dashboards** | Organizer: expected / collected / outstanding, overdue members (WhatsApp reminder deep link), next payout, fund balance, pending verifications, open disputes. Member: next payment, status, payment history, net position and all totals. |
| **Reports** | Monthly round, full cycle, member statement, arrears, late payments, cash/bank reconciliation. **CSV and PDF** with bilingual headers. Charts: collection rate, net positions, arrears, payout schedule. |
| **Notifications** | In-app reminders: 3 days before due, on the due date, and overdue after the grace period; plus winner, payout, payment verification, and dispute updates. Email copies are off by default and require a verified address plus explicit account opt-in. WhatsApp deep links (no paid SMS). |
| **Audit log** | Append-only (DB trigger): timestamp, user, action, old value, new value, IP, reason. |
| **UI** | Mobile-first, EN/NE toggle (Devanagari digits in Nepali mode), status colours: green = paid/completed, yellow = pending/partial, red = overdue/defaulted. |

## Tech stack & structure

* **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS v4 (no chart library – small SVG charts)
* **Backend:** Node 20 + Express + TypeScript, Zod validation, JWT auth (+ optional Google Sign-In), bcrypt, multer, pdfkit, nodemailer, node-cron
* **Database:** PostgreSQL + Prisma (CHECK constraints and triggers in a raw-SQL migration)
* **Tests:** Vitest + Supertest against a real PostgreSQL test database

```
dhukuti-manager/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/            # init + constraints_and_triggers (CHECKs, immutability, append-only audit)
│   │   └── seed.ts                # one 5-member bidding group with 3 rounds of history
│   ├── src/
│   │   ├── domain/                # pure money/calculation/rules code (unit-tested)
│   │   ├── services/              # groups, rounds, ledger, state (balances), notifications
│   │   ├── routes/                # Express routers + Zod schemas + serializers (privacy)
│   │   ├── reports/               # report builders + CSV/PDF renderer
│   │   ├── middleware/            # auth/RBAC, validation, rate limits, uploads, errors
│   │   ├── lib/                   # prisma, storage, mailer, audit, clock, errors
│   │   └── jobs/reminders.ts      # daily reminder job
│   ├── assets/fonts/              # Mukta (Latin + Devanagari) for PDFs
│   └── tests/{unit,integration}/
├── frontend/
│   └── src/{pages,components,lib}/
├── docs/USER_GUIDE.md
└── render.yaml
```

All money is stored and exchanged as **integer paisa** (`1 NPR = 100 paisa`); percentages are **basis points** (`500 bp = 5 %`). No floating point arithmetic touches money.

## Quick start (local)

Requirements: Node ≥ 20, PostgreSQL ≥ 14. International phone numbers are accepted; enter a country code (`+977…`, `+1…`). Nepal local formats remain accepted and are normalized to E.164.

```bash
# 1. Database
createuser -P dhukuti            # password: dhukuti
createdb -O dhukuti dhukuti
createdb -O dhukuti dhukuti_test # used by the integration tests

# 2. Backend
cd backend
cp .env.example .env             # adjust DATABASE_URL / JWT_SECRET
npm install
npx prisma migrate dev           # applies migrations + generates the client
npm run seed                     # optional demo data (use `npx tsx prisma/seed.ts --reset` to wipe & reseed)
npm run dev                      # http://localhost:4000/api/health

# 3. Frontend (second terminal)
cd frontend
cp .env.example .env
npm install
npm run dev                      # http://localhost:5173  (proxies /api → :4000)
```

## Seed data & demo logins

`npm run seed` creates **"Kathmandu Saathi Dhukuti"**: bidding, NPR 10,000 × 5 members, monthly on the 10th, starting 2026-08-01, fixed late fee NPR 500 after 3 grace days, minimum bid NPR 1,000, 5 % early-exit penalty. History is replayed through the real services:

The demo group join password is `DemoDhukutiJoin2026!`; the organizer can see the short group code on the Members page.

* Round 1 – Gita wins with a NPR 4,000 discount, paid out via Khalti, closed balanced.
* Round 2 – Hari wins (NPR 3,500); Maya pays late + NPR 500 late fee; Maya's dispute was dismissed; closed.
* Round 3 – Ram wins a NPR 3,000 tie by earliest bid; still collecting: Ram's proof awaits verification, Maya is overdue.

All passwords: **`Password123!`**

| Email | Name | Role |
|---|---|---|
| organizer@dhukuti.test | Sita Shrestha | Organizer |
| gita@dhukuti.test | Gita Karki | Co-organizer |
| ram@dhukuti.test | राम बहादुर थापा | Member |
| hari@dhukuti.test | Hari Adhikari | Member |
| maya@dhukuti.test | माया गुरुङ | Member |
| viewer@dhukuti.test | Auditor Dai | Viewer |

## Tests

```bash
cd backend
npm test                 # everything (65 tests)
npm run test:unit        # database-independent pot, bidding, late fee, net position, misc (51)
npm run test:integration # full 5-member fixed-rotation cycle, full 5-member bidding cycle,
                         # missing payment → reconciliation mismatch (+ disputes/corrections) (14)
```

Integration tests reset `TEST_DATABASE_URL` before running. The default target is the local `dhukuti_test` database. Reset is refused unless the database name contains `test`, the target differs from `DATABASE_URL`, and the host is local; remote resets require `ALLOW_REMOTE_TEST_RESET=true` for disposable CI databases only.

## Accounting model

**Pot.** `full_pot = contribution × active contributing members`.

**Fixed rotation.** `payout = full_pot`.

**Bidding.** The bid is the discount the bidder accepts.
`payout = full_pot − discount`; `discount_share = discount ÷ members who have not received the pot yet` (excluding the winner). Shares are exact in paisa; remainder paisa go to the earliest members in rotation order (e.g. 4,000.00 ÷ 3 → 1,333.34 / 1,333.33 / 1,333.33). A share is delivered as a **credit** that reduces that member's contribution due in the same round (`BID_DISCOUNT` ledger entry, non-cash).

**Eligibility.** A member can win once per cycle; members with unpaid contributions (arrears) cannot win or bid; suspended/defaulted/exited members cannot win. The payout can only be recorded after the recipient's own contribution is verified.

**Admin selection.** Select this method when the group wants recipients chosen by the organizer instead of a preset turn order. Members submit or withdraw a request from the round page. Requests are visible to everyone in the group; organizers choose the recipient manually and the choice is recorded in the audit log.

**Net position** (per member, verified entries only):
```
net = contributions + late_fees + penalties + manual_adjustments − pot_received − refunds
```
Bid discounts are not added (they are already reflected in the smaller cash contribution and the smaller payout). Corrections count in the category of the entry they correct.
`Σ net (all members) = fund balance` — the money currently held by the group. **At the end of the cycle Σ net must be exactly 0**; otherwise a validation error is shown and the group cannot be completed. Late fees collected during the cycle are distributed back via the settlement step (refunds) so that Σ net reaches 0. Mid-cycle a non-zero Σ net is normal.

**Round reconciliation.**
```
opening_balance + total_contributions + late_fees (+ penalties) − payout_to_winner (± adjustments/refunds) = calculated_closing_balance
```
The organizer enters the actual balance held; any difference marks the round **MISMATCH**, shows a warning and requires a written reason to close. The next round opens with the calculated closing balance.

**Database guarantees** (migration `constraints_and_triggers`): verified entries cannot be updated or deleted, ledger rows cannot be deleted, the audit log is append-only, verified entries must have proof (except system-generated discount/correction/adjustment entries), rejected entries need a reason, `payout = pot − discount`, a member wins at most one round per group. Payouts, bid closing and round closing run inside database transactions with row locks (`SELECT … FOR UPDATE`).

## API reference

Base URL: `/api`. JSON in/out unless noted. Authenticate with `Authorization: Bearer <JWT>`.
**Amounts are integer paisa.** Dates are ISO strings (`YYYY-MM-DD` accepted for date fields).

Errors: `{"error": {"code": "VALIDATION_ERROR" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "UNPROCESSABLE" | ..., "message": "...", "details": ...}}` with HTTP 400/401/403/404/409/422/429.

Role legend: **O** organizer, **C** co-organizer, **M** member, **V** viewer. `G` = `/groups/:groupId` (non-members get 404).

### Auth

| Method & path | Roles | Body / notes |
|---|---|---|
| `POST /auth/register` | public | `{email?, password (≥8), fullName, phone, preferredLanguage?: "en"\|"ne"}` → `{token, user}` (rate-limited); phone is required, globally valid and unique; email is optional |
| `POST /auth/login` | public | `{identifier, password}` where identifier is email or phone → `{token, user}` (rate-limited) |
| `POST /auth/google` | public | `{credential, phone?}` (Google ID token; phone required for new accounts) → `{token, user}`; 501 if not configured |
| `GET /auth/config` | public | `{googleClientId, emailConfigured}` |
| `GET /auth/me` · `PATCH /auth/me` | any | profile `{fullName?, phone?, email?, preferredLanguage?, emailNotificationsEnabled?}`; email must be verified before email notifications |
| `POST /auth/verify-email/request` · `POST /auth/verify-email/confirm` | any / public | email verification link; SMTP must be configured |
| `POST /auth/password-reset/request` · `POST /auth/password-reset/confirm` | public | generic response prevents account enumeration; requires a verified email and SMTP; resets invalidate prior JWT sessions |
| `POST /auth/delete-account` | authenticated | requires password (or fresh Google sign-in) plus account identifier and typed confirmation; removes credentials/contact/profile photos, anonymizes the member seat, transfers any unfinished organizer role to a linked co-organizer, and preserves financial records and audit history |

### Groups

| Method & path | Roles | Notes |
|---|---|---|
| `GET /groups` | any | my groups with `myRole`, `myMemberId`, `myStatus` |
| `POST /groups` | any | create (caller becomes organizer). Body: `name, description?, currency="NPR", contributionAmount, memberCount, startDate, frequency: MONTHLY\|BIWEEKLY\|WEEKLY, collectionDueDay (1–28 monthly, 0–6 weekday otherwise), selectionMethod: FIXED_ROTATION\|BIDDING, lateFeeType: NONE\|FIXED\|PERCENTAGE\|DAILY, lateFeeValue (paisa, or bp for PERCENTAGE), lateFeeCap?, gracePeriodDays, continueAfterPot, minBidDiscount, bidWinRule="HIGHEST_DISCOUNT", tieBreakRule: EARLIEST\|RANDOM, missedPaymentRules?, earlyExitRules?, earlyExitPenaltyBp, organizerParticipates=true, joinPassword (12+ chars)`; returns the short group code to the organizer |
| `POST /groups/join` | authenticated | `{code, password}`; creates a pending request for a DRAFT group. Manager approval is required before membership. |
| `GET /invitations/:token` | public | safe group/member preview; token is high-entropy and stored hashed |
| `POST /invitations/:token/accept` | authenticated | accepts a single-use invitation for one pre-added member seat |
| `GET G` | O C M V | group, `myRole`, `rules {en[], ne[]}`; contact matches alone never link an account |
| `POST G/join-password` | O C | `{password}`; set or rotate the shared group password (12+ chars) |
| `GET G/join-requests` · `POST G/join-requests/:id/approve` · `POST G/join-requests/:id/reject` | O C | review join requests; approval links a matching unclaimed phone seat or creates a member in an open seat |
| `PATCH G` | O C | partial update; financial fields only while DRAFT (changing them resets rule confirmation) |
| `DELETE G` | O | `{reason}` – soft delete |
| `GET G/rules` | all | `{rules, confirmedAt}` |
| `POST G/confirm-rules` | O C | required before start |
| `POST G/start` | O C | needs confirmed rules and all seats filled; creates rounds, opens round 1 |
| `GET G/dashboard` | all | current round figures, totals, overdue members, next payout, `cycleValidation`, counts |
| `GET G/me` | all | my member record, balance, history |
| `GET G/validation` | all | Σ net positions check |
| `GET G/settlement/preview` · `POST G/settlement` | O C | distribute remaining fund as PENDING refunds (status SETTLEMENT) |
| `POST G/complete` | O C | requires no pending entries, no open disputes and Σ net = 0 |
| `POST G/reminders/run` | O C | run the reminder job now for this group |

### Members

| Method & path | Roles | Notes |
|---|---|---|
| `GET G/members` | all | private fields (contact, payment ID, net, arrears) only for O/C or self |
| `POST G/members` | O C | `{fullName, phone, email?, paymentMethod?, paymentIdentifier?, bankName?, role="MEMBER", rotationOrder?}`; phone required, email optional; contributors only while DRAFT |
| `POST G/members/:id/invitation` | O C | issues a one-use invitation link for an unlinked seat; expires in 14 days; share it privately |
| `PATCH G/members/:id` | O C, self | self may edit own contact/payment details only |
| `DELETE G/members/:id` | O C | `{reason}`; DRAFT only / members without ledger entries |
| `POST G/members/:id/status` | O C | `{status: ACTIVE\|WAITING\|SUSPENDED\|DEFAULTED, reason}` |
| `GET G/members/:id/balance` | O C, self | full balance breakdown |
| `GET G/members/:id/exit-quote` | O C, self | remaining contributions, penalty, owed by/to member, explanation |
| `POST G/members/:id/exit` | O C | `{settlement: PAY_REMAINING\|REPLACEMENT\|REFUND_AT_CYCLE_END, reason, replacement?}` |
| `POST G/members/:id/photo` | O C, self | multipart `photo` (JPEG/PNG/WEBP) |
| `GET G/members/:id/photo` | all | image (authenticated) |

### Rounds & bidding

| Method & path | Roles | Notes |
|---|---|---|
| `GET G/rounds` | all | all rounds with recipient, collected amount |
| `GET G/rounds/:rid` | all | round, checklist, bids (sealed until closed – only your own amount is visible), payout, reconciliation preview, eligible winners |
| `PUT G/rounds/:rid/bids/me` | M O C | `{discountAmount}` – submit/replace sealed bid (min ≤ bid ≤ max) |
| `DELETE G/rounds/:rid/bids/me` | M O C | withdraw |
| `POST G/rounds/:rid/bids/close` | O C | select winner (tie-break), reveal bids, credit discount shares |
| `POST G/rounds/:rid/winner-override` | O C | `{memberId, reason (≥5 chars), bidDiscount?}` – audit-logged `MANUAL_OVERRIDE` |
| `POST G/rounds/:rid/payout` | O C | multipart: `amount, method, paidAt, referenceNumber?, proofUrl?, notes?, verify?` + file `receipt`. Amount must equal the computed payout |
| `GET G/rounds/:rid/reconciliation?actualClosingBalance=` | all | preview |
| `POST G/rounds/:rid/close` | O C | `{actualClosingBalance, mismatchReason?}` → 409 with `details.reconciliation` if mismatched without reason |

### Transactions (ledger) & disputes

| Method & path | Roles | Notes |
|---|---|---|
| `GET G/transactions?memberId&roundId&type&status&from&to&page&pageSize` | all | shared ledger; other members' references/notes/receipts are hidden from members |
| `POST G/transactions` | M (self) O C | multipart: `memberId, roundId?, type, amount, method, paidAt, referenceNumber?, proofUrl?, notes?, verify?` + `receipt`. Members: CONTRIBUTION/LATE_FEE/PENALTY with proof required. O/C also REFUND/MANUAL_ADJUSTMENT |
| `GET G/transactions/:eid` | all | entry + corrections + disputes |
| `GET G/transactions/:eid/receipt` | O C, owner | file stream |
| `POST G/transactions/:eid/proof` | O C, owner | attach proof to a PENDING entry |
| `POST G/transactions/:eid/verify` | O C | proof required unless `{cashReceivedInPerson:true}` confirms a cash contribution, late fee, or penalty received in person; confirmation is audit-logged |
| `POST G/transactions/:eid/reject` | O C | `{reason}`; PENDING only (verified entries → 409) |
| `POST G/transactions/:eid/corrections` | O C | `{amount (signed), reason}` → new VERIFIED CORRECTION entry |
| `POST G/transactions/:eid/disputes` | owner, O C | `{reason}` – marks an open round DISPUTED |
| `GET G/disputes` | all (members: own) | |
| `POST G/disputes/:did/resolve` | O C | `{outcome: UPHELD\|DISMISSED, resolution, correctionAmount?}` |

### Reports & audit

`?format=json|csv|pdf` (default json). CSV/PDF headers are bilingual.

| Path | Roles |
|---|---|
| `GET G/reports/charts` | all (other members anonymised for members) |
| `GET G/reports/rounds/:rid` | all |
| `GET G/reports/cycle` | all |
| `GET G/reports/members/:mid` | O C V, self |
| `GET G/reports/arrears` · `late-payments` · `reconciliation` | O C V |
| `GET G/audit?action&entityType&userId&page&pageSize` | O C V |

### Notifications

`GET /notifications` → `{unread, notifications[]}` · `POST /notifications/read-all` · `POST /notifications/:id/read`

## Deployment

The frontend is a static SPA (Vercel); the API and PostgreSQL run on Railway **or** Render.

Before taking real member data public, complete [`docs/PUBLIC_LAUNCH_CHECKLIST.md`](docs/PUBLIC_LAUNCH_CHECKLIST.md) and replace every placeholder in [`docs/PRIVACY_POLICY_TEMPLATE.md`](docs/PRIVACY_POLICY_TEMPLATE.md). The privacy document is a draft, not a published policy. Production startup rejects wildcard CORS, non-HTTPS public origins, short JWT secrets, and disabled rate limiting.

### Backend on Railway

1. New project → **Deploy from GitHub repo** → set the service **Root Directory** to `backend` (`backend/railway.json` sets build/start commands: `npm ci && npm run build` / `npm run start:prod`, which runs `prisma migrate deploy` before starting).
2. Add a **PostgreSQL** plugin; reference its `DATABASE_URL` in the service variables.
3. Add a **Volume** mounted at e.g. `/data/uploads` and set `UPLOAD_DIR=/data/uploads` (container disks are ephemeral).
4. Set variables: `NODE_ENV=production`, `JWT_SECRET` (`openssl rand -base64 48`), `CORS_ORIGINS=https://<your-app>.vercel.app`, `APP_URL=https://<your-app>.vercel.app`, `TRUST_PROXY=1`, optional `GOOGLE_CLIENT_ID`, `SMTP_*`, `EMAIL_FROM`.
5. Generate a public domain and check `https://<api-domain>/api/ready` (checks PostgreSQL too; `/api/health` is liveness only).

### Backend on Render

Use the included **`render.yaml`** blueprint (New → Blueprint → select the repo). It creates the PostgreSQL database, the web service (`rootDir: backend`), a persistent disk for uploads and a generated `JWT_SECRET`. Fill in `CORS_ORIGINS`, `APP_URL` and optional Google/SMTP variables when prompted.

The blueprint selects a paid persistent PostgreSQL plan in Frankfurt alongside the API and restricts public database IP access. Review Render's current prices and the blueprint's resource changes in the dashboard before provisioning; creating these resources incurs charges.

### Frontend on Vercel

1. Import the repo → **Root Directory** `frontend` → framework preset **Vite** (build `npm run build`, output `dist`).
2. Environment variable: `VITE_API_URL=https://<api-domain>` (no trailing slash, without `/api`).
3. `frontend/vercel.json` rewrites all paths to `index.html` for client-side routing.
4. Add the Vercel URL to the API's `CORS_ORIGINS`.

Never seed a production database. `npm run seed` now refuses to run whenever `NODE_ENV=production`; public demo credentials make seeded accounts unsafe for real deployments.

### Google Sign-In (optional)

Create an OAuth 2.0 **Web application** client in Google Cloud Console, add your Vercel URL (and `http://localhost:5173`) as *Authorised JavaScript origins*, set `GOOGLE_CLIENT_ID` on the API. The login page shows the Google button automatically when configured.

### Email

Any SMTP provider (Brevo, Mailgun, SES, Gmail app password…). Without `SMTP_HOST`, in-app reminders continue, while verification/recovery email links cannot be delivered. Email alert copies remain off until a user verifies an email and opts in from **Account settings**. No email address or message is written to server logs when SMTP is absent.

### Backups and recovery

Before using real group records, enable automated PostgreSQL backups and retain copies outside the database provider. Back up the persistent uploads volume as well as the database because receipt/photo paths in the database refer to those files. Encrypt backups, restrict access, set a retention period, and periodically restore a copy into a separate staging database and storage volume. Do not test restores against the live database.

## Security

* Passwords hashed with bcrypt (12 rounds); JWT (HS256) expires after 12 hours by default; a successful password reset invalidates earlier JWTs.
* Role-based access control on every route; members only see their own private data (contacts, receipts, references, balances of others are hidden).
* Zod validation on every body/query; card-number-like payment identifiers are rejected (Luhn check).
* Rate limiting on login/register, password recovery, verification requests, uploads and the API in general.
* Phone numbers are normalized to E.164. Phone/email matches never auto-attach a pending member; access requires an organizer-issued single-use invitation link.
* Email alerts default off, require a verified email, and are sent only after a user opts in. Password recovery is available by verified email; phone-only recovery needs a phone verification provider and is not available yet.
* Uploads: JPEG/PNG/WEBP/PDF only, size limit, magic-byte sniffing, random file names, served only through authenticated endpoints.
* Helmet security headers, CORS allow-list.
* Database transactions + row locks for payouts, bid closing and round closing; DB triggers make verified entries and the audit log immutable.

## Replacing local uploads with S3 / Cloudinary

All file access goes through the `FileStorage` interface in `backend/src/lib/storage.ts`:

```ts
interface FileStorage {
  save(buffer: Buffer, originalName: string, mimeType: string, folder: string): Promise<{ key: string }>;
  open(key: string): NodeJS.ReadableStream;
  exists(key: string): Promise<boolean>;
}
```

Implement it with the AWS SDK (`PutObject` / `GetObject().Body` / `HeadObject`) or Cloudinary and switch the exported `storage` instance. The database only stores the opaque `key`, so no schema change is needed.

## Licences & attribution

* PDF/UI font **Mukta** by Ek Type, licensed under the SIL Open Font License 1.1 (`backend/assets/fonts/OFL.txt`, `frontend/public/fonts/OFL.txt`).
