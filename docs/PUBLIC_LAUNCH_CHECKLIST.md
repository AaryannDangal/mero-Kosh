# Public launch readiness

This checklist describes the work still required before inviting real groups. A public URL is not a production-ready service by itself.

## Already prepared in this repository

- Render backend/Postgres and Vercel SPA deployment configuration.
- Production startup checks reject wildcard or non-HTTPS CORS origins, an insecure public app URL, a short JWT secret, and disabled rate limits.
- Render's example database uses a paid persistent plan, is placed in Frankfurt with the API, and has no public IP allow-list entries. Provisioning it creates paid resources and must be reviewed in the provider dashboard before confirmation.
- CI workflow builds both applications and runs database-independent backend unit tests.
- Readiness endpoint checks PostgreSQL. Production migrations run on backend startup; never run the seed command in production.

## Required owner decisions before the first public deployment

- Create a private GitHub repository, inspect the staged files, and push the project. There is currently no remote configured. Confirm `.env`, uploads, local databases, and demo credentials are excluded; rotate any secret that was ever committed or shared.
- Choose the final app URL, API URL, hosting region, plan, and monthly budget. Do not deploy the Render blueprint without confirming its current cost.
- The public, bilingual `/privacy` page and self-service account deletion are implemented. Before launch, add the chosen hosting/database/storage/email providers and their processing locations to `PRIVACY_POLICY_TEMPLATE.md`, check every statement against the production setup, and have the final policy reviewed for the countries where the app will be offered.
- Account deletion removes sign-in credentials, direct contact details from group seats, profile photos, and personal notifications; it anonymizes the current member label while preserving financial records, receipts, and immutable audit history. Historical audit values and uploaded receipts may still contain names or contact/payment details recorded at the time; this is disclosed in the policy. Confirm this retention approach is acceptable for your intended regions and groups.
- Deleting an organizer account transfers unfinished groups to an already linked co-organizer. The app blocks deletion if an unfinished group has no linked co-organizer; add one first.
- Add a support channel and a process for compromised invitations, account recovery, privacy requests, and security reports. Phone ownership is not verified (no SMS/OTP provider); invitation URLs are bearer credentials. Share each invitation privately with its intended member.
- Choose a production email provider and sender domain if password recovery/email verification should work. In-app notifications work without SMTP; users cannot recover a phone-only account yet.
- Configure and test database backups plus a separate backup for receipt/photo uploads. Restore into a staging database/volume before the first real cycle. Keep API at one instance initially: uploaded files are on a persistent local volume, and the reminder scheduler runs in each API process.
- Set production `DATABASE_URL`, a generated unique `JWT_SECRET` (32+ characters), `CORS_ORIGINS` (exact frontend HTTPS origin), `APP_URL` (frontend HTTPS origin), `UPLOAD_DIR` (persistent volume), and `TRUST_PROXY` according to the host. Keep `RATE_LIMIT_DISABLED` unset/false. Set `VITE_API_URL` to the API origin on the frontend build.
- Create a fresh empty production database. Never copy the local demo database or seed accounts into it. Apply migrations and verify `/api/ready`, registration/login, invitation acceptance, receipt uploads, in-app reminders, email recovery if configured, and mobile install over HTTPS.
- Run a security and privacy review with real people before broad promotion. This app records sensitive group financial activity even though it does not move or hold money.

## Launch and recovery checks

- Confirm frontend/API origins, HTTPS certificates, DNS, and provider health checks.
- Confirm PostgreSQL is private to the API where supported; use least-privilege provider access and a separate staging environment.
- Confirm the production build contains no local API URL, local credentials, demo login copy, or development-only settings.
- Test one invited group end-to-end with consenting pilot members; verify role access, payment proof permissions, accounting reconciliation, notifications, and the cash-received audit trail.
- Document who can access production, how secrets are rotated, how incidents are handled, and how backups are restored.
- Set provider billing alerts/spend limits where available and review actual costs before confirming paid resources.
