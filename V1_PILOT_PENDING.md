# V1 Pilot Release: Pending Work

**Code checkpoint reviewed:** `0e46df0` (`v1 Pilot version`)  
**Release scope assumed:** one college, invitation-only pilot, with only the workflows the college and technical owner explicitly include.

This list combines the latest code history with the repo's deployment and operations guides. A checked-in checklist is not proof that a task is complete; items below are pending until the owner records evidence. The repository does not establish the current hosting/provider setup or whether staging checks have already been performed.

## Release gates to close before using real student data

### 1. Approve the pilot boundary

- [x] Name the owners and record pilot dates: **College pilot owner:** MR Technologies (Ramprasad Suthi); **TalentEdge technical owner:** Ramprasad Suthi; **pilot dates:** 28-Nov-2026 to 31-Dec-2027.
- [x] Record **support contact, incident contact, and launch approver:** Sai Roshan (same person for all three roles).
- [x] Record expected participants: **200 students, 5 trainers, 2 college administrators, and 4 interview panelists** (211 total).
- [x] Capacity decision completed for 200 active students. The default Pilot plan limit is 100; record and verify the selected plan/limit in the deployment before inviting students.
- [x] Record planned student data: **student name, phone number, academic year, college email, batch, assessment results, and interview feedback**.
- [x] Include cohort-tracking fields: **student/roll number, department/program, curriculum progress, and attendance**. Confirm whether academic year should also capture a distinct graduation year.
- [ ] Confirm the college's student notice/consent, data retention, and deletion arrangements before live data is entered.
- [x] In-scope workflows: **member invitations, curriculum/progress, assessments, and interviews**. Interview staffing is ready.
- [x] **Coding assessments are in scope.** Configure the isolated Judge0 service and pass its staging checks before using the coding workflow.
- [x] **Billing, email delivery, and external AI are disabled for this pilot.** Share invitation links manually through an approved private channel; keep billing checkout and external AI processing unavailable.
- [x] **Public workspace registration stays disabled**; onboarding is invitation-only.
- [x] **Readiness/AI indicators are for training guidance only**, not admissions, hiring, or placement decisions.
- [x] Use managed Judge0 with a compatible API/auth contract if available; confirm the provider contract and obtain the base URL and credentials before configuration. If the provider requires non-standard auth headers, add a server-side adapter before use.

### 2. Prepare and deploy the target environment

- [ ] Choose hosting/data region and provision the app, production MySQL, DNS, HTTPS, and network restrictions.
- [ ] Configure production secrets safely, including database credentials, bootstrap token handling, MFA encryption key, public app URL, and backup destination.
- [ ] Apply `talentEdge.sql` only for a new empty database, then apply migrations in order: `db:migrate-auth`, `db:migrate-billing`, and `db:migrate-email`.
- [ ] Take a pre-migration backup and verify the migration ledger and resulting database.
- [ ] Install locked dependencies, build the reviewed release commit, deploy under a service manager, and confirm `/api/health` and `/api/ready`.
- [ ] Verify production HTTPS/cookie/proxy/CORS settings, private database access, and that secrets are absent from client bundles and logs.

### 3. Provision and verify pilot accounts

- [ ] Create the first platform administrator in the protected environment and enroll MFA; verify the recovery path.
- [ ] Create the college workspace and first college administrator; invite named pilot users and assign the intended batch/roles.
- [ ] Verify invitation acceptance, expired/revoked link rejection, password reset, session revocation, deactivation, and the account flows used by the pilot.
- [ ] Verify college admins cannot cross workspace boundaries and platform admins cannot access student records through platform operations.

### 4. Run and record staging acceptance checks

- [ ] Test role and resource scope for student, trainer, panelist, and college administrator using separate staging workspaces.
- [ ] Confirm curriculum/material progress persists through sign-out/sign-in.
- [ ] Confirm assessment availability, attempt limits, submission, scoring, trainer review, and result release.
- [ ] If interviews are in scope, confirm schedule, panelist assignment, evaluation, follow-up, and student result visibility.
- [ ] If coding is in scope, configure isolated Judge0 and test success, compile/runtime failure, resource limits, and service outage.
- [ ] If email is in scope, verify invitation/reset messages, public HTTPS links, rate limiting, and provider status interpretation.
- [ ] If billing is in scope, use Razorpay test mode to verify checkout, signatures, webhook transitions, cancellation, and invoice access before any live charge.
- [ ] Keep external AI off unless approved; if enabled, confirm data handling, credit limits, and advisory copy.
- [ ] Review browser/server logs for workflow failures and record pass/fail, operator, and follow-up for every in-scope scenario.

### 5. Complete operational readiness

- [ ] Set up access-controlled logs, alerts for readiness/5xx/provider failures, and log retention.
- [ ] Schedule backups to encrypted off-host storage, set retention, and perform a restore drill in an isolated database.
- [ ] Record recovery objectives, rollback target/owner, and incident/access-disable procedure.
- [ ] Confirm student notice/consent, data retention/deletion, and support escalation with the college.
- [ ] Review dependencies/security findings and complete the required accessibility pass; document findings and accepted risks.
- [ ] Record release commit, migration versions, configuration owner, backup reference, acceptance evidence, risk exceptions, and approvals.

## Product work that can remain outside this pilot

These are not automatic V1 blockers if the college owner agrees they are out of scope:

- Recruiter/ATS export or synchronization: no selected vendor or customer-approved data contract is present.
- Calendar integration and automated interview reminders.
- Email bounce/complaint synchronization and automated delivery retries; current status records provider acceptance, not inbox delivery.
- External AI processing, unless separately approved and configured.
- Live recurring billing, unless commercially required and fully tested with merchant configuration.
- Coding assessments, until the separately hosted Judge0 service passes the staging checks.
- Automated curriculum completion for every day; some progress behavior remains supported-day/material based and material review is self-reported.

## Documentation cleanup before calling the repo release-ready

- [ ] Update `PRODUCT_SCOPE.md` current implementation section: it still says payment-provider integration, invoices, and production code judging are not implemented, which conflicts with Razorpay and Judge0 code/docs.
- [ ] Update `CUSTOMER_DEMO_USE_CASES.md`: its current notes say billing/payment/invoices and automated email are unavailable and describe invitations as manual, while newer code supports configured Resend and Razorpay workflows.
- [ ] Reconcile `PROJECT_UNDERSTANDING.md` with the current implementation; it still describes some old mock/local-state behavior and the code runner as a simulator.
- [ ] Keep pilot exclusions and provider setup requirements consistent across the feature guide, local setup, demo guide, and deployment checklist.

## Pilot release decision

**Status from repository evidence:** implementation checkpoint exists; deployment readiness and staging acceptance are not evidenced here. Treat the pilot as **not yet cleared for live student data** until the applicable gates above have owners and recorded results. Provider-dependent features should be presented as available only after their deployment setup and checks pass.

See [V1_PILOT_DEPLOYMENT_CHECKLIST.md](V1_PILOT_DEPLOYMENT_CHECKLIST.md), [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md), [LOCAL_SETUP.md](LOCAL_SETUP.md), and [FEATURE_GUIDE.md](FEATURE_GUIDE.md) for detailed procedures and feature limits.
