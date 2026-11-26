# TalentEdge Feature Guide

TalentEdge is a college placement preparation and administration platform. It supports student learning and assessment, trainer and interview workflows, college workspace administration, and a separate platform operations console.

This guide describes the current implementation based on the application screens, server APIs, schema migrations, and setup documentation. A feature can be implemented in code and still require provider credentials, a database migration, or deployment configuration before it works in a particular environment.

## 1. Roles and feature access

| Role | Curriculum and assessments | Progress and feedback | Batches and student records | Interviews | Analytics and reports | Workspace and account admin | Subscription and billing | Platform operations |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Student** | Follow curriculum; take assigned assessments | View own progress, results, feedback, and readiness factors | View own batch context | View own schedules and results | View own performance | Update own profile and password | — | — |
| **Trainer** | View/manage assessments within assigned scope; review attempts | Review assigned students and provide feedback | Manage or monitor assigned batches and students, according to capability | Conduct evaluations and view assigned history | View assigned-batch analytics | — | — | — |
| **Interview panelist** | — | Submit interview evaluation | View candidates on assigned interviews | View assigned schedules and submit evaluations | — | — | — | — |
| **College administrator** | Manage workspace materials and assessments | Review workspace student records and outcomes | Manage batches, members, assignments, and student directory | Manage panelists, schedules, and follow-ups | Workspace reports, analytics, and exports | Manage members, settings, access, and audit activity | View usage; manage subscription and billing | — |
| **Platform administrator** | Publish and distribute shared content | Workspace-level operational information | Manage college workspaces, not student learning records | — | Platform-level operational overview and audit | Manage platform administrators | Manage plan catalog and workspace subscription operations | Separate `/platform-admin` console |

**Access boundary:** college roles are workspace-scoped; student access is limited to the student's own records; trainer and panelist access is scoped to assigned records. Platform administrators use a separate account/session and permission registry. Protected API routes enforce capabilities in server middleware, with additional resource-scope checks in route handlers. See [API_AUTHORIZATION.md](API_AUTHORIZATION.md).

## 2. Student experience

### Dashboard and 40-day Bootcamp Guide

The dashboard links students to their current learning path, upcoming or assigned assessments, progress, interview activity, profile, and readiness insights. The curriculum organizes 40 days into technical training (Days 1–18), aptitude and reasoning (19–26), HR and communication (27–30), technical revision and core CS (31–36), and placement simulation (37–40).

Students can review workspace learning materials, complete learning checks, and save supported day/material progress. Materials can include video links, readings, and PDF links. Progress is stored per student and workspace. Material review is self-reported; linked resources must be reachable by the student's browser.

### Assessments and coding practice

Students can view assigned assessments, start attempts, answer supported question types, and submit work. Assessment versions, assignment rules, attempt limits, timing/availability, due dates, late-submission policies, and result-release rules are stored with the assessment workflow. Student MCQ scoring is server-side. Coding submissions are retained for scoring and trainer review; trainers can adjust reviewed results and release feedback according to the workflow.

The code practice and coding assessment runner sends code to a separately hosted Judge0 CE service. The service must be configured by the operator. The server applies configured CPU, memory, wall-time, process, and request limits; submissions are evaluated against server-owned test cases. If Judge0 is unavailable or unconfigured, runs fail instead of returning a simulated pass. See [LOCAL_SETUP.md](LOCAL_SETUP.md) for configuration and limits.

### Profile, readiness, and reports

The student profile displays placement-readiness factors, skills, development areas, interview remarks, and related profile information. The readiness score is a versioned weighted heuristic with visible factors; recorded placement outcomes support descriptive evaluation. It is not a calibrated probability or placement guarantee. AI-assisted summaries and recommendations may use Gemini when external processing is explicitly enabled; fallback output is heuristic/demo content.

Students can view their interview evaluation history and download available reports/certificates. Students can also view progress analytics and leaderboard information within their permitted scope.

## 3. Trainer and interview panelist experience

Trainers work with assigned batches and students. Available workflows include reviewing progress and assessment attempts, managing assessments within their permitted assignment scope, providing feedback, viewing batch analytics, and recording mock interview evaluations. Access is bounded by the server-side role capabilities and assignment checks.

Interview panelists use a focused assigned-interviews portal to view candidate and schedule details and submit evaluations. They do not receive workspace-wide student or analytics access through that portal.

Interview evaluation history and follow-ups are persisted. Evaluations can contribute to student profile/readiness information; those indicators remain advisory. Automated calendar integration and outbound interview reminder email jobs are not currently included.

## 4. College administrator experience

### Workspace, members, and access lifecycle

College administrators can invite workspace members as students, trainers, panelists, or college administrators; assign students to batches; update roles/assignments; activate or deactivate access; request member password resets; inspect workspace audit activity; and view recent email attempts. Deactivation applies to workspace membership and revokes relevant workspace sessions.

Invitations and password/account notices can be sent through Resend when configured. Email attempts are stored with status and errors; the workspace UI shows recent attempts. `sent` means Resend accepted the message for processing, not that it reached an inbox. Bounce/delivery webhooks are not yet synchronized. For local setup without email configuration, authorized staff can copy and share one-time invitation or reset links. Recipient, IP, and workspace/platform category rate limits are applied.

Self-service password reset uses a generic response to avoid revealing whether an email is registered. Account notices are sent for supported lifecycle events such as password changes and access status changes.

### Batches, students, and learning content

Administrators can manage batches, assign students and trainers, browse the workspace student directory, and inspect student profiles. Workspace curriculum materials can be created, edited, and archived; student progress is tracked separately from shared material definitions.

### Interviews, analytics, and settings

Administrators can manage interview panelists; create, edit, cancel, and follow up on schedules; and review interview evaluations and history. Workspace dashboards and reports include activity, assessment, interview, and placement outcome data within the administrator's scope. PDF/CSV helpers support relevant reporting flows.

Workspace settings include readiness thresholds and scheduling defaults. Readiness thresholds affect display/classification and do not validate predictive accuracy.

### Subscriptions and billing

The billing area displays the workspace plan, status, period, and usage. Where configured, administrators can select a priced plan, start Razorpay subscription checkout, cancel at period end, and review provider payment/invoice history. Signed, deduplicated Razorpay webhooks update subscription state and entitlements. Prices must be set by a platform administrator; merchant credentials, webhook configuration, and an active Razorpay account are required. Tax/GST calculation and billing self-service for invoice addresses are not included.

Entitlement checks are enforced on workspace APIs for plan features and applicable student, staff, batch, and AI usage limits. Subscription status can limit workspace features while preserving recovery/billing access. See [LOCAL_SETUP.md](LOCAL_SETUP.md) for provider configuration.

## 5. Platform administrator console

The platform console is served at `/platform-admin`. Platform administrator accounts are separate from college accounts and require password plus authenticator-based MFA.

- **Overview:** cross-workspace operational totals and subscription/lifecycle information, designed to avoid student-level record access.
- **College workspaces:** search and inspect workspaces, create a workspace with its initial college administrator invitation, resend/revoke invitations, and change workspace lifecycle status with a reason.
- **Plan catalog and subscriptions:** manage plan features, limits, prices, and administrative workspace subscription changes; inspect subscription history.
- **Shared content:** create drafts, publish versioned curriculum materials and sample assessment sets, apply a release to selected workspaces, review rollout/application history, and roll back by applying a previous release as a new operation. Workspace customizations and student progress are preserved by the apply workflow.
- **Platform administrators:** invite, activate/deactivate, and initiate MFA reset for platform accounts.
- **Audit:** inspect platform administrative activity.

Platform permissions are separate from college role capabilities. Platform operations do not grant access to student-level learning records.

## 6. Persistence, integrations, and operations

### Persistence and data setup

MySQL stores accounts, workspace memberships, batches, student profiles, curriculum/material progress, assessments and versions, submissions and reviews, interviews/evaluations, notifications, audit records, subscription state, email delivery metadata, and readiness outcome events. Workspace ownership and role scopes are applied by server APIs.

Database migrations use a schema-version ledger and are forward-only. Demo seeding is designed to insert demo-owned records without truncating customer data. Take a database backup before applying migrations to data that matters.

### External services

| Service | Used for | Required setup / current limit |
| --- | --- | --- |
| **Judge0 CE** | Isolated code execution | Separately hosted; server-side endpoint/auth and resource limits required. No simulated pass fallback. |
| **Resend** | Invitations and account lifecycle email | API key, verified sender, and public app URL required. Provider-accepted status is recorded; bounce webhooks are not integrated. |
| **Razorpay Subscriptions** | Recurring subscription checkout, renewals, and provider billing records | Merchant activation, server credentials, webhook setup, and configured plan prices required. Tax calculation is outside TalentEdge. |
| **Google Gemini** | Optional AI recommendations/summaries | `GEMINI_API_KEY` and explicit `AI_EXTERNAL_PROCESSING_ENABLED=true`; disabled otherwise. AI output is advisory. |
| **Recruiter/ATS or college-system integration** | Not implemented | No customer-approved destination or field contract is present in the project. Select after customer discovery and document consent, field mapping, access, retention, retries, and audit needs before exchanging student data. |

### Operational readiness

`GET /api/health` is a liveness endpoint. `GET /api/ready` checks database readiness. API request logs include request IDs, route template, status, and latency, and omit request bodies/query strings. `npm run db:backup` creates a timestamped MySQL dump; scheduling, encrypted off-host storage, retention, and restore drills must be arranged by the deployment operator. The security review and release checklist are in [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md). The step-by-step single-college V1 launch checklist is [V1_PILOT_DEPLOYMENT_CHECKLIST.md](V1_PILOT_DEPLOYMENT_CHECKLIST.md).

## 7. Known boundaries

- Some display-only, derived, or demo-oriented UI elements do not have a full persisted CRUD workflow. Review the owning screen/API before treating every visible control as a data-management contract.
- The capability registry and route manifest document/enforce protected API access, but resource-level tenant, self, and assignment checks remain important parts of authorization.
- Judge0 must be provisioned and secured separately; TalentEdge does not host the execution service.
- Readiness scores and fallback AI content are not validated placement predictions or guarantees. Gemini processing is an external data transfer when enabled.
- Billing depends on provider account setup and merchant settings. Tax/GST handling and custom billing-contact management are not provided.
- Email attempt status does not confirm inbox delivery; bounces, complaints, scheduled reminders, interview notices, and automated retry/resend management remain future work.
- Recruiter/ATS synchronization is not implemented pending a customer-backed vendor and data contract.
- Health endpoints and request logs provide a baseline, not a full observability platform, alerting service, automated backup scheduler, restore automation, penetration test, or production approval.

## 8. Main implementation files

| Area | Main files |
| --- | --- |
| Application routing and navigation | `src/App.tsx`, `src/components/Sidebar.tsx`, `src/main.tsx` |
| Authentication and account lifecycle | `src/components/AuthScreen.tsx`, `src/components/WorkspaceMembers.tsx`, `src/services/auth.ts`, `server.ts` |
| Student learning and assessments | `src/components/StudentDashboard.tsx`, `src/components/CurriculumTimeline.tsx`, `src/components/AssessmentList.tsx`, `src/components/AssessmentPlayer.tsx`, `src/components/AssessmentResultsPanel.tsx`, `src/components/CodeEditor.tsx` |
| Interviews, profiles, and analytics | `src/components/StudentProfileView.tsx`, `src/components/InterviewPanel.tsx`, `src/components/InterviewSchedules.tsx`, `src/components/PanelistInterviewPortal.tsx`, `src/components/AnalyticsDashboard.tsx`, `src/components/AdminReports.tsx` |
| College and platform administration | `src/components/BatchManager.tsx`, `src/components/SubscriptionUsage.tsx`, `src/components/PlatformAdminApp.tsx` |
| Permissions and API coverage | `src/types/subscriptions.ts`, `API_AUTHORIZATION.md`, `server.ts` |
| Readiness and AI policy | `src/utils/readinessScore.ts`, `AI_GOVERNANCE.md` |
| Database migrations and operations | `migrate-auth.ts`, `migrate-billing.ts`, `migrate-email.ts`, `backup-mysql.ts`, `OPERATIONS_RUNBOOK.md` |
| Setup and demo data | `LOCAL_SETUP.md`, `seed-mysql.ts`, `talentEdge.sql` |

## 9. Local setup commands

See [LOCAL_SETUP.md](LOCAL_SETUP.md) before running migrations or configuring external services. Common commands:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start local development server |
| `npm run db:migrate-auth` | Apply authentication, workspace, and core workflow schema |
| `npm run db:migrate-billing` | Add billing/subscription schema |
| `npm run db:migrate-email` | Add email delivery/rate-limit schema |
| `npm run db:seed` | Add demo data without truncating existing records |
| `npm run db:backup` | Create a timestamped MySQL dump using `mysqldump` |
| `npm run build` | Build frontend and production server bundle |
| `npm run lint` | Run TypeScript no-emit check |
| `npm start` | Start production bundle |
