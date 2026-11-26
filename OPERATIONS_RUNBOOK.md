# Operations and release runbook

This runbook is the baseline for a private staging or production deployment. Complete the open review items with the deployment owner before handling live student data.

## Monitoring

- `GET /api/health` is a liveness check. It confirms the process is serving; it does not query MySQL.
- `GET /api/ready` checks the MySQL connection and returns HTTP 503 while the database is unavailable. Use it as the deployment readiness check.
- Each non-health HTTP request returns an `X-Request-Id` and emits one JSON log entry with request ID, route template, method, status, and duration. Request bodies, query strings, cookies, and user data are intentionally omitted.
- Alert on sustained readiness failures, elevated HTTP 5xx rates, repeated Judge0 or Razorpay provider failures in application logs, and disk/database capacity. Keep application logs in the host's access-controlled log service and define retention before production.
- The current checks are process/database checks, not full dependency probes. Judge0, Resend, Gemini, and Razorpay should be monitored through their failure logs and provider dashboards.

## Database backups and restore

1. Install a compatible MySQL `mysqldump` client on the application/backup host. Set `MYSQLDUMP_PATH` if it is not on `PATH`.
2. Set `DB_BACKUP_DIR` to a restricted, encrypted volume with enough capacity. Keep encryption keys separate from the backup destination.
3. Run `npm run db:backup`. It creates a timestamped SQL dump using a single-transaction snapshot and includes routines, triggers, and events. `DB_PASSWORD` is passed to the child process through its environment, not its command arguments.
4. Copy completed dumps to an encrypted off-host or object-storage location with access controls and retention configured by the operator. The local command does not upload, encrypt, prune, or schedule backups.
5. Verify backup integrity by restoring a recent dump into an isolated, non-production database. Do this on a scheduled cadence and after major schema changes; verify row counts and sign-in/basic workspace flows there.
6. For a restore, stop writes, preserve the current database snapshot, restore into a recovery database first, validate it, then follow the organization's approved database cutover procedure. Never test restoration against the live database.

## Security review before production

- Review the threat model and tenant isolation for every API/data export, including role authorization and cross-workspace access.
- Confirm HTTPS, secure cookie settings, trusted proxy configuration, CORS policy, request limits, secret storage/rotation, and platform MFA recovery procedures in the target hosting environment.
- Verify Resend sender domain, webhook/bounce policy, and email link origin; verify Razorpay webhook signature configuration and Judge0 network isolation/authentication.
- Review database least-privilege access, encryption at rest/in transit, backup access, log access/retention, incident contacts, and data retention/deletion obligations.
- Perform dependency vulnerability review, external penetration testing, and accessibility review. Record findings and owner/target date in the release approval record. This repository does not mark those external reviews as complete.

## Release procedure

1. Confirm the release commit, reviewed change summary, dependency/security findings, and successful CI/build from the release environment.
2. Confirm an off-host backup completed and restore evidence exists for the current release window.
3. Verify required environment variables and provider settings without printing secret values. Confirm `PUBLIC_APP_URL`, verified sender, payment webhook URL, and Judge0 endpoint where those features are enabled.
4. Apply forward-only migrations in documented order during the approved window. Keep a pre-migration backup; do not assume a migration has an automatic rollback.
5. Deploy the application and confirm `/api/health`, `/api/ready`, login, workspace-scoped reads, invitation email, and provider webhook health in staging before production traffic.
6. Observe structured error/latency logs and provider dashboards after rollout. If the release is unhealthy, stop rollout and redeploy the prior application version; restore data only under the approved recovery procedure.
7. Record release version, migration versions, operator, backup reference, checks performed, and follow-up items.

## Recruiter integration selection gate

No recruiter/ATS vendor or customer-approved data contract is evidenced in the current project. Do not transmit student profiles or readiness scores to a vendor until a pilot customer confirms the system and use case. In discovery, record the customer, destination product, required fields, consent/legal basis, visibility rules, deletion behavior, authentication, rate limits, retries, and reconciliation needs. Prefer a minimal, consented candidate export or read-only API as the first slice; exclude readiness probability and sensitive profile fields unless the customer explicitly validates the need. Capture the decision and field map in a versioned integration specification before enabling outbound sync.
