# Local account and workspace setup

Stages 3 and 4 add local authentication, college workspace boundaries, and persistent tenant-scoped learning workflows on top of the existing MySQL database.

## One-time database setup

1. Create the database schema from `talentEdge.sql` in your local MySQL instance.
2. Add the DB connection values and a unique `AUTH_BOOTSTRAP_TOKEN` to `.env`. Keep the token private; the initial administrator setup turns off after the first password-backed account exists.
3. Apply the authentication, workspace, and tenant workflow migration:

   ```powershell
   npm run db:migrate-auth
   ```

   The migration creates workspace student profiles, trainer assignments, per-student curriculum progress, learning-material catalog and student material progress, workspace subscription and AI usage records, adds workspace ownership to batches, assessments, submissions, and interview records, creates workspace interview panelists, linked panelist accounts and schedule-linked evaluations, personal in-app notifications, platform-admin identity/session/invitation/audit tables, and workspace lifecycle states. It also copies the sample assessment catalog into each existing workspace. It is safe to rerun; it does not remove existing records.

4. For the optional demonstration data, run the destructive demo seeder **before** creating the first administrator:

   ```powershell
   npm run db:seed
   ```

   The seeder clears demo users, profiles, batches, invitations, sessions, and workspace memberships before repopulating sample records. Do not run it against data you need to keep.

5. Start the app locally:

   ```powershell
   npm run dev
   ```

6. Open `http://127.0.0.1:3000`. Use **Set up the first college administrator** and provide the bootstrap token from `.env`. The first setup creates the college administrator and binds the browser session to the workspace.

If demo data was seeded, each demo user can be invited from **Workspace Members** to create a password-backed account. New member invitations are shown as links to copy; email delivery is not part of this local stage.

## Platform administrator setup

Platform administrators use a separate account store and session, with mandatory time-based one-time password (TOTP) authentication. They are not attached to a college workspace.

1. Generate a private key (for example, `node -p "require('node:crypto').randomBytes(48).toString('base64url')"`) and add it as `PLATFORM_MFA_ENCRYPTION_KEY` in `.env`. Keep a secure backup; losing or rotating this key without a migration prevents verification of stored authenticator secrets.
2. Create the initial platform administrator from a terminal:

   ```powershell
   npm run platform-admin:create
   ```

   The command asks for a name, email, and password, then displays a TOTP secret/URI. Add it to an authenticator app and enter the current six-digit code to finish setup. The secret is encrypted before it is stored. Do not share the setup output.
3. Sign in at `http://127.0.0.1:3000/platform-admin` with the platform account and authenticator code.
4. Use **Platform Admins** to generate an invitation link for another administrator. Deliver the link through an approved channel; email delivery is not configured. Invitees must enroll their own authenticator before their first sign-in.

If the sole first platform administrator is locked out, use the local recovery command from the project directory:

```powershell
npm run platform-admin:recover
```

It only works when there is exactly one active platform administrator. It requires the matching email and an explicit confirmation phrase, replaces that account's password and authenticator, revokes its existing sessions, and records the recovery in the audit log. It displays a new TOTP secret; keep it private and enroll it before signing in. When multiple platform administrators exist, use the in-console MFA reset workflow instead.

The platform console can provision an onboarding workspace and a first college-admin invitation, view workspace-level operational metadata, and set workspace lifecycle status. Suspending or archiving revokes college sessions and blocks college sign-in. Reactivation is reversible. Each lifecycle change requires a reason and is audited. Plan/payment changes and student-record support access are intentionally not exposed in this first console slice.

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
- Server-side limits block student/trainer invitations when the workspace is already at capacity, check capacity again when invitations are accepted or inactive members are reactivated, and block batch creation/unarchiving and Gemini-generated requests after their allowance is reached. Pending invitations do not reserve seats. Existing data is not deactivated if it already exceeds a configured plan limit. Plan changes, billing actions, and automated over-limit remediation are not enabled.

This is a local foundation. Email delivery, external identity providers, distributed login throttling, billing, and cloud deployment are not configured yet. Local college registration does not verify email addresses; keep it disabled in any public environment until verification and abuse controls are implemented.
