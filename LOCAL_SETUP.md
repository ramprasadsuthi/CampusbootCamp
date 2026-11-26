# Local account and workspace setup

Stages 3 and 4 add local authentication, college workspace boundaries, and persistent tenant-scoped learning workflows on top of the existing MySQL database.

## One-time database setup

1. Create the database schema from `talentEdge.sql` in your local MySQL instance.
2. Add the DB connection values and a unique `AUTH_BOOTSTRAP_TOKEN` to `.env`. Keep the token private; the initial administrator setup turns off after the first password-backed account exists.
3. Apply the authentication, workspace, and tenant workflow migration:

   ```powershell
   npm run db:migrate-auth
   npm run db:migrate-billing
   npm run db:migrate-email
   ```

   The migration creates workspace student profiles, trainer assignments, per-student curriculum progress, learning-material catalog and student material progress, workspace subscription and AI usage records, adds workspace ownership to batches, assessments, submissions, and interview records, creates workspace interview panelists, linked panelist accounts and schedule-linked evaluations, personal in-app notifications, platform-admin identity/session/invitation/audit tables, and workspace lifecycle states. It also copies the sample assessment catalog into each existing workspace. A `SchemaMigrations` ledger records completed versions and checksums of the executed migration bundles, and a MySQL advisory lock prevents concurrent migration runs. Applied migration versions are immutable; future schema changes must use a new version. The migration is safe to rerun and does not remove existing records. If a multi-workspace database has unscoped batches, notifications, assessments, submissions, or interview records, it stops before altering application tables so those rows can be assigned explicitly.

   Workspace subscription entitlements are checked on protected college APIs. `not_configured` workspaces use the Pilot plan as a compatibility default; active and trialing plans are subject to configured end dates. Past-due subscriptions are read-only for product workflows, while billing management and subscription status reads remain available. Canceled, suspended, or expired subscriptions are blocked from workspace features, with account and billing access retained for recovery. Plan features gate their corresponding workflows, student/staff/batch quotas are checked on membership and batch activation, and AI credits are reserved transactionally before provider calls. Platform-admin operations remain governed by the separate platform permission registry. Provider renewals are delivered by signed Razorpay webhooks; a small in-process retry worker handles provider cancellation scheduling.

   The assessment workflow migration adds version snapshots, workspace or batch assignment rules, attempt limits, availability and due dates, late-submission policy, per-assessment pass thresholds, and result-release policy. Student MCQs are scored on the server. Coding submissions run through the separately hosted Judge0 CE integration and are saved for trainer review; assessment edits create new versions, and submitted attempts keep the version number they used.

   Back up the database before applying migrations in an environment with valuable data. Migrations are forward-only; there is no automatic rollback because removing columns or restoring prior values could discard customer data. To recover from a failed migration, fix the reported cause and rerun the same command; the existing migration operations are idempotent.

4. For optional demonstration data, run the non-destructive seeder:

   ```powershell
   npm run db:seed
   ```

   The seeder inserts demo-owned batches, accounts, student profiles, memberships, and notifications. It never truncates tables or overwrites existing records. With one workspace it selects that workspace automatically. With multiple workspaces, select the intended tenant explicitly:

   ```powershell
   npm run db:seed -- --workspace=<workspace-id>
   ```

   You can also set `DEMO_WORKSPACE_ID` in `.env`. The generated demo account emails use `example.com` and are unique to the selected workspace. Rerunning the command is safe; existing demo records and student progress are left as they are.

5. Start the app locally:

   ```powershell
   npm run dev
   ```

6. Open `http://127.0.0.1:3000`. Use **Set up the first college administrator** and provide the bootstrap token from `.env`. The first setup creates the college administrator and binds the browser session to the workspace.

If demo data was seeded, each demo user can be invited from **Workspace Members** to create a password-backed account. Invitation email is sent when Resend is configured; otherwise the one-time link can be copied and shared securely.

## Platform administrator setup

Platform administrators use a separate account store and session, with mandatory time-based one-time password (TOTP) authentication. They are not attached to a college workspace.

1. Generate a private key (for example, `node -p "require('node:crypto').randomBytes(48).toString('base64url')"`) and add it as `PLATFORM_MFA_ENCRYPTION_KEY` in `.env`. Keep a secure backup; losing or rotating this key without a migration prevents verification of stored authenticator secrets.
2. Create the initial platform administrator from a terminal:

   ```powershell
   npm run platform-admin:create
   ```

   The command asks for a name, email, and password, then displays a TOTP secret/URI. Add it to an authenticator app and enter the current six-digit code to finish setup. The secret is encrypted before it is stored. Do not share the setup output.
3. Sign in at `http://127.0.0.1:3000/platform-admin` with the platform account and authenticator code.
4. Use **Platform Admins** to generate an invitation link for another administrator. Email delivery is attempted when Resend is configured; otherwise deliver the one-time link through an approved channel. Invitees must enroll their own authenticator before their first sign-in.

## Operational checks and backups

`GET /api/health` is a liveness check; `GET /api/ready` checks database readiness. For a local MySQL dump, install `mysqldump` and run `npm run db:backup`. Configure `DB_BACKUP_DIR` to choose the output folder. See [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) for backup protection, restore drills, security review, and release procedures.

If the sole first platform administrator is locked out, use the local recovery command from the project directory:

```powershell
npm run platform-admin:recover
```

It only works when there is exactly one active platform administrator. It requires the matching email and an explicit confirmation phrase, replaces that account's password and authenticator, revokes its existing sessions, and records the recovery in the audit log. It displays a new TOTP secret; keep it private and enroll it before signing in. When multiple platform administrators exist, use the in-console MFA reset workflow instead.

The platform console can provision an onboarding workspace and a first college-admin invitation, view workspace-level operational metadata, set workspace lifecycle status, configure plans and prices, and manually administer subscriptions. Suspending or archiving revokes college sessions and blocks college sign-in. Reactivation is reversible. Each lifecycle change requires a reason and is audited. Student-record support access is intentionally not exposed in this first console slice.

For local multi-college development, set `ALLOW_WORKSPACE_REGISTRATION=true` in `.env` to show the workspace creation option. It is disabled by default and should stay disabled in any public environment until email verification and abuse controls are implemented.

## Security behavior in this stage

- Passwords are stored as salted scrypt hashes, never as plaintext.
- Sessions use random opaque tokens stored as SHA-256 hashes in MySQL and sent in HttpOnly, SameSite=Lax cookies.
- College roles are stored in workspace memberships. The former role switcher is removed.
- Student, trainer, batch, leaderboard, notification, and interview remark API queries apply workspace and role scope server-side.
- Student profiles and batch assignments are stored per workspace. College administrators can manage batches, assign trainers and students, and invite students directly into a batch.
- Curriculum completion is stored per student and workspace. Assessment submission status and attempt counts are derived from that student's own submission records.
- Day 1 supports workspace-managed video links, text readings, and PDF links, with per-student material review progress. Day 1 no longer accepts a manual student day-completion action; automatic completion and learning checks are planned for the next stage. Video/document review is currently self-reported, and resource files must be hosted at an accessible HTTPS URL.
- Assessments, submissions, and interview evaluation history are stored with workspace ownership. Student-facing assessment responses omit answer keys.
- College administrators can invite and deactivate workspace members. Deactivation revokes that member's sessions for the workspace; the last active college administrator cannot be deactivated.
- Workspace invitation links expire after seven days and can be accepted once.
- A college administrator can create a one-time password reset link for an active member. Reset links expire after one hour, and using one revokes the member's existing sessions. In a local setup, send the link through a verified channel yourself.
- College administrators can view the workspace plan, status, period dates, plan capacities, active student/trainer/batch counts, and metered AI requests in **Subscription & Usage**. Existing workspaces start in `not_configured` status with the Pilot planning limits; no payment or renewal is implied. AI requests are counted after successful provider generation; AI fallback responses do not consume credits.
- Server-side limits block student/trainer invitations when the workspace is already at capacity, check capacity again when invitations are accepted or inactive members are reactivated, and block batch creation/unarchiving and Gemini-generated requests after their allowance is reached. Pending invitations do not reserve seats. Existing data is not deactivated if it already exceeds a configured plan limit.
- Billing self-service uses Razorpay Subscriptions. Run `npm run db:migrate-billing` after the auth migration, configure `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`, then set monthly and annual prices for active plans in the platform-admin plan catalog. In Razorpay, register `https://<your-host>/api/billing/razorpay/webhook` and enable `subscription.authenticated`, `subscription.activated`, `subscription.charged`, `subscription.pending`, `subscription.halted`, `subscription.resumed`, `subscription.cancelled`, `subscription.completed`, `payment.captured`, and `payment.failed`. Keep credentials server-side. Checkout and recurring renewals remain unavailable until the merchant account and these settings are active. Razorpay hosted invoice links appear when the provider issues an invoice; tax/GST treatment must be configured for the merchant and is not calculated by TalentEdge.

### Invitation and account email

Run `npm run db:migrate-email` after `npm run db:migrate-auth` to add delivery tracking and rate-limit storage. Configure `RESEND_API_KEY`, `EMAIL_FROM`, and `PUBLIC_APP_URL`; verify the sender domain in Resend before sending production mail. In local development without credentials, account flows still create one-time links that authorized staff can copy. Production email links require `PUBLIC_APP_URL` to point to the deployed public HTTPS origin.

Invitation, password-reset, MFA-reset, and account-access notices use the shared email service. The workspace member screen shows the latest 50 email attempts. `sent` means the provider accepted the message for processing; bounce/delivery webhooks are not yet synchronized, so it does not confirm inbox delivery. Requests are rate limited per recipient and category, source IP and category, and workspace/platform and category (5, 20, and 100 requests per hour respectively).

Local college registration does not verify email addresses; keep it disabled in any public environment until verification and abuse controls are implemented. External identity providers, distributed login throttling, and cloud deployment are not configured yet.

## Isolated coding assessment execution

Coding runs and assessment submissions use a separately hosted Judge0 CE service. Set JUDGE0_URL and, when configured on the Judge0 instance, JUDGE0_AUTH_TOKEN and JUDGE0_AUTH_USER in the server environment. Runtime IDs are discovered from the Judge0 /languages endpoint and cached for ten minutes, so the service can upgrade its runtime versions without relying on hard-coded IDs. The TalentEdge server sends source code and server-owned test cases directly to Judge0; do not expose these settings in browser configuration. JUDGE0_CPU_LIMIT, JUDGE0_WALL_LIMIT, and JUDGE0_MEMORY_LIMIT_KB set per-run ceilings (defaults: 2 seconds CPU, 5 seconds wall time, 128000 KB memory). Network access is disabled and the server caps each judge request/poll sequence. If Judge0 is unavailable, the run or submission fails instead of returning a simulated pass. Coding assessment scores are calculated from the proportion of test cases passed; trainers can still review and adjust submitted results. The bundled Two Sum, Longest Substring, and Subarray Sum exercises receive language-specific stdin/stdout harnesses. Custom coding questions must provide programs that read the configured test input from stdin and write the expected output to stdout.

## Readiness and AI governance

Apply the schema with `npm run db:migrate-auth` to create the readiness prediction outcome ledger. Set AI_EXTERNAL_PROCESSING_ENABLED=true alongside GEMINI_API_KEY only after approving external processing for the deployment. External AI is disabled otherwise. The readiness score uses a versioned weighted formula and shows its factors on the student profile. College administrators can record placement outcomes and inspect descriptive precision and recall; these are not calibrated probabilities. See [AI_GOVERNANCE.md](AI_GOVERNANCE.md) for weights, data handling, and use limits.
