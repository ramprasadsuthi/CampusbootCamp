# TalentEdge V1 Pilot Deployment Checklist

Use this checklist to launch a single-college, invitation-only pilot. Treat every **Go/No-Go gate** as required before moving real student data or opening access to pilot users. Keep credentials in the hosting provider's secret manager or protected environment settings; do not commit them or paste them into tickets/chat.

## Pilot boundaries

- [ ] Name the pilot college owner and TalentEdge technical owner.
- [ ] Record pilot start/end dates, support contact, incident contact, and expected user count.
- [ ] Agree which V1 workflows are in scope (recommended: member invitations, curriculum/progress, assessments, and interview workflow only if staffing is ready).
- [ ] Confirm that workspace self-registration stays disabled (`ALLOW_WORKSPACE_REGISTRATION=false`). Users join only through administrator-issued invitations.
- [ ] Do not enable recruiter/ATS export or sync for this pilot.
- [ ] Do not use readiness scores or AI output to make admission, hiring, or placement decisions. Keep external AI processing off unless the college explicitly approves it.
- [ ] Decide whether billing is out of scope. If so, leave Razorpay checkout unavailable and do not configure live payment credentials.
- [ ] Decide whether coding assessments are in scope. If not, hide/avoid that workflow. If yes, complete the Judge0 checks below before launch.

**Go/No-Go gate:** pilot owner, scope, user list/roles, support contact, data handling, and excluded features are written down.

## 1. Choose and prepare the deployment target

- [ ] Select a hosting provider/location suitable for the college's student data and applicable contractual/privacy requirements.
- [ ] Provision an application runtime and production MySQL database. Keep the database on a private network where possible; do not expose it publicly.
- [ ] Provision a public DNS name and HTTPS certificate. Require HTTPS for the entire application, not just sign-in.
- [ ] Configure network rules so only approved ingress reaches the app and only the app/backup processes reach MySQL.
- [ ] Configure a persistent, restricted backup destination separate from the application instance.
- [ ] Set up an access-controlled log destination and a way for the operator to receive outage/error alerts.
- [ ] Decide the rollback target (previous app release) and identify who can perform it.

**Go/No-Go gate:** hosting, DNS/TLS, private database access, logs/alerts, backup destination, and rollback owner are ready.

## 2. Prepare production secrets and service configuration

Set these in the host's secret/configuration manager. Never store actual secret values in this checklist.

### Required app and database configuration

- [ ] `NODE_ENV=production`
- [ ] `HOST` and `PORT` match the host/container routing configuration. Bind to the interface required by the platform; keep the database private.
- [ ] `PUBLIC_APP_URL=https://<pilot-hostname>` with no trailing path.
- [ ] `DB_HOST`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` point to the production MySQL database. Use a least-privilege database account.
- [ ] `AUTH_BOOTSTRAP_TOKEN` is a unique, long, private value for first-time setup only. Remove/rotate it after bootstrap if it is no longer needed.
- [ ] `PLATFORM_MFA_ENCRYPTION_KEY` is a private random key of at least 32 characters. Keep a protected recovery copy separate from database backups.
- [ ] `ALLOW_WORKSPACE_REGISTRATION=false`
- [ ] `DB_BACKUP_DIR` points to the restricted backup volume (and `MYSQLDUMP_PATH` if `mysqldump` is not on `PATH`).

### Optional services: enable only when included in the pilot

- [ ] **Email invitations/notices:** set `RESEND_API_KEY` and `EMAIL_FROM` to a verified sender; confirm messages contain links to the HTTPS `PUBLIC_APP_URL`. Configure delivery/bounce monitoring expectations (the app currently records provider acceptance, not inbox delivery).
- [ ] **Judge0 coding assessments:** set `JUDGE0_URL`, optional auth values, and reviewed CPU/wall/memory limits. Restrict Judge0 network access, protect its API, and confirm submitted code cannot reach the app database or secrets.
- [ ] **Gemini AI:** keep `AI_EXTERNAL_PROCESSING_ENABLED=false` by default. Enable only after the college approves external processing and the team reviews [AI_GOVERNANCE.md](AI_GOVERNANCE.md).
- [ ] **Razorpay billing:** keep checkout out of the pilot unless commercially required. If enabled, configure merchant credentials, approved plan prices, and signature-verified webhooks in the provider dashboard.

- [ ] Confirm secret values do not appear in source control, deployment logs, build artifacts, or client-side configuration.

**Go/No-Go gate:** required environment values are set and checked without printing their values; optional services not in scope are disabled.

## 3. Prepare the database

- [ ] Create the production database and least-privilege application user.
- [ ] Take and retain a pre-migration database backup.
- [ ] Apply the base schema from `talentEdge.sql` only if provisioning a new empty database.
- [ ] Apply migrations in order:

  ```powershell
  npm run db:migrate-auth
  npm run db:migrate-billing
  npm run db:migrate-email
  ```

  Billing and email migrations are additive and may be applied even if those features are not enabled; confirm migration completion in the schema migration ledger. Do not run demo seed data in the live pilot database.

- [ ] Verify the migration ledger contains the expected applied versions and that the migration commands completed without errors.
- [ ] Verify the production database backup completed and is readable before creating live pilot records.

**Go/No-Go gate:** schema is migrated, backup exists, and no demo seed accounts/data are present in the live workspace.

## 4. Build and deploy the application

- [ ] Deploy from the reviewed release commit, not a developer working tree.
- [ ] Install locked dependencies with `npm ci`.
- [ ] Create the production bundle with `npm run build` and resolve all build failures before deployment.
- [ ] Start the service with `npm start` under the host's service manager/container platform so it restarts after host/process failure.
- [ ] Confirm only the HTTPS ingress is public and the app is not exposed through an unintended development port.
- [ ] Confirm `GET /api/health` responds successfully.
- [ ] Confirm `GET /api/ready` responds with status `ready`; it checks the database connection.
- [ ] Confirm logs include request IDs and do not contain request bodies, cookies, credentials, or query strings.

**Go/No-Go gate:** production process is stable, app is reachable over HTTPS, and readiness succeeds.

## 5. Create the platform and college administrators

- [ ] Create the first platform administrator using `npm run platform-admin:create` in the protected deployment environment; enroll its MFA secret immediately and do not retain setup output in shared logs.
- [ ] Sign in to `/platform-admin` and verify MFA works.
- [ ] Create the pilot college workspace and invite its first college administrator.
- [ ] Confirm the invitation email is accepted by the provider and the secure link uses the production HTTPS hostname. If Resend is not enabled, deliver the one-time link manually through an approved private channel.
- [ ] Have the college administrator accept the invite, set a unique password, and verify workspace name/role.
- [ ] Invite named pilot users with the minimum required role. Assign students to the intended batch; do not use shared test accounts.
- [ ] Verify college administrators can manage only their workspace and platform administrators cannot access student-level records through platform operations.

**Go/No-Go gate:** administrators are enrolled, invited users are named, and no public registration path is available.

## 6. Run staging/pilot smoke checks

Perform these checks first in staging with non-production data. Record pass/fail and the operator.

- [ ] Sign in, sign out, session expiry/revocation, and password reset work over HTTPS.
- [ ] Invitation acceptance works once; expired/revoked invitations are rejected.
- [ ] Role checks work: student, trainer, panelist, and college administrator each see only permitted actions and records.
- [ ] Workspace-scoped reads/writes do not return or modify another workspace's records. Use a separate test workspace in staging for this check.
- [ ] Student curriculum/material progress persists after sign-out and sign-in.
- [ ] Assessment assignment, attempt limits, submission, scoring, trainer review, and result release follow the configured assessment rules.
- [ ] If coding is in scope, test Judge0 success, compile/runtime failure, time/memory limits, and Judge0 outage behavior.
- [ ] If interviews are in scope, test schedule creation, panelist assignment, evaluation submission, follow-up, and student result visibility.
- [ ] If email is in scope, inspect one invitation and reset email end-to-end; confirm delivery status and rate-limit rejection behavior.
- [ ] If billing is in scope, use provider test mode and verify checkout/webhooks before any live charge.
- [ ] Confirm AI remains off unless explicitly approved; verify advisory/readiness wording in student and administrator views.
- [ ] Check browser console and server error logs for workflow failures.

**Go/No-Go gate:** all in-scope checks pass; failures are fixed or explicitly excluded from V1 with the college owner's agreement.

## 7. Security, privacy, and support readiness

- [ ] Review the route/capability manifest in [API_AUTHORIZATION.md](API_AUTHORIZATION.md) against the pilot workflows.
- [ ] Review workspace isolation, password/session handling, invitation/reset flows, production HTTPS/cookie settings, secrets, and admin MFA recovery.
- [ ] Confirm the college's notice/consent, data retention, deletion, and incident contacts for student records.
- [ ] Define who receives support requests, how incidents are escalated, and how user access is disabled if an account is compromised.
- [ ] Review dependency/security findings and document any accepted risks with an owner and due date.
- [ ] Complete an accessibility pass for the flows used by the pilot.
- [ ] Record unresolved items in the release decision. Do not describe external security or accessibility reviews as complete unless they have actually been performed.

**Go/No-Go gate:** pilot owner and technical owner accept the documented scope and known limits; critical security/data-isolation issues are closed.

## 8. Backups, monitoring, and recovery

- [ ] Schedule `npm run db:backup` at a frequency agreed for the amount of acceptable data loss (RPO).
- [ ] Copy dumps to encrypted, access-controlled off-host storage and set a retention schedule.
- [ ] Perform a restore into an isolated database and verify sign-in plus representative workspace, assessment, and interview records.
- [ ] Define recovery time objective (RTO), recovery owner, and steps for restoring/cutting over.
- [ ] Alert on `/api/ready` failures, sustained HTTP 5xx, storage/database capacity, and provider failures for enabled services.
- [ ] Confirm log access is limited, retention is set, and request IDs can be used to investigate reports without logging secrets.

**Go/No-Go gate:** a recent backup is off-host and encrypted, restore has been demonstrated, and operators know how to respond to an outage.

## 9. Launch decision and first-week checks

- [ ] Confirm the first pilot user list and send invitations only to those users.
- [ ] Record release commit, migration versions, configuration owner, backup reference, smoke-check results, risk exceptions, and launch approvers.
- [ ] Confirm users know the support contact and which features are in/out of scope.
- [ ] Launch the pilot and monitor sign-in, invitation acceptance, readiness/health, workflow failures, and provider dashboards daily during the first week.
- [ ] Review feedback and incidents with the college owner before expanding user count or enabling additional integrations/features.

### V1 exclusions unless separately approved

- Open self-service college registration.
- Recruiter/ATS export or synchronization.
- Use of readiness estimates for consequential placement decisions.
- External AI processing without documented approval.
- Live recurring billing unless merchant configuration and billing checks are complete.
- Coding assessments before the isolated Judge0 deployment has passed its checks.
