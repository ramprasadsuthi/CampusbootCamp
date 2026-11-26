# TalentEdge Product Scope — Base Version

**Status:** Initial product proposal, based on the Stage 1 discussion  
**Launch approach:** College-first SaaS for the Indian market, with prices denominated in INR. Students receive access through their college in the initial release. Direct-to-student subscriptions are a later option.

## Product goal

Help colleges run a measurable placement-readiness program across students, trainers, and placement administrators. The base release should support the core journey from college setup and student enrollment through curriculum, assessments, feedback, and readiness reporting.

## Customer and role model

Each college has an isolated workspace (tenant). A user may have a role in a college workspace; platform operations are handled separately from college roles.

| Role | Base permissions |
| --- | --- |
| **Student** | View and maintain permitted profile fields; access assigned curriculum and assessments; submit attempts; view own progress, feedback, reports, and earned certificates. |
| **Trainer** | Manage assigned batches; view enrolled students in those batches; assign approved curriculum and assessments; review progress; record interview evaluations and feedback; view batch analytics and export permitted batch reports. |
| **Interview panelist** | View assigned interviews and candidate details needed for the session; submit assigned interview evaluations and feedback. |
| **College administrator** | Configure the college workspace; invite and deactivate users; assign college roles; create batches and enroll students; assign trainers; view college-level usage and reports; manage the college subscription and billing contacts. |
| **TalentEdge platform administrator** | Create and support college workspaces; manage plan catalog and subscriptions; administer shared content and platform settings; view operational and billing information. Student-data access is limited to support needs and should be audited. |

Permissions are scoped by workspace and role. Subscription entitlements are a separate concern: a role determines what a user may do, while the plan determines which capabilities and capacity the college has purchased.

### Permission boundary

The permission registry in `src/types/subscriptions.ts` is the canonical role-capability matrix, separate from subscription features. Shared server middleware enforces capabilities on protected college API routes; hiding a menu item is not authorization. College roles are `student`, `trainer`, `panelist`, and `college_admin`. `platform_admin` uses a separate session and permission registry and must never be inferred from college membership. See `API_AUTHORIZATION.md` for the route map and intentional public/token routes.

| Capability | Student | Trainer | Interview panelist | College admin | Platform admin |
| --- | --- | --- | --- | --- | --- |
| Own profile, assigned learning, own assessments and results | Own records | — | — | Own profile | Support access only, audited |
| Assigned batches, students, content and evaluation | — | Assigned batches only | Assigned interviews only | Workspace-wide | Support access only, audited |
| Invite/deactivate members; manage roles | — | — | — | Workspace-wide | Cross-workspace support |
| Create batches/enroll students; manage curriculum and assessments | — | Assigned content only, per policy | — | Workspace-wide | Shared content/catalog only |
| Schedule interviews / record evaluation | View own schedule and results | Evaluate assigned students | Evaluate assigned interviews | Schedule workspace interviews | Support access only, audited |
| Analytics and exports | Own report | Assigned batches | — | Workspace-wide | Operational / billing views; student data only for audited support |
| Subscription and billing | — | — | — | Read/manage own college | Manage all workspaces and plan catalog |

The registry is enforced by shared middleware on protected API routes. Resource-level tenant and record scope is enforced by route queries and target checks; public and token-authenticated routes are documented separately in `API_AUTHORIZATION.md`.

## Initial subscription tiers

All tiers are college subscriptions. A trial is a subscription state or offer, not a separate feature tier. Exact prices remain to be set after pilot discovery; proposed numeric capacity defaults are documented below.

| Tier | Intended use | Included capabilities |
| --- | --- | --- |
| **Pilot** | A college validating the workflow with a bounded batch | Core college workspace, student/trainer roles, batches, assigned curriculum, assessments and results, interview feedback, basic dashboards and standard exports, small included AI allowance, time-limited trial or pilot terms. |
| **Campus** | A college operating its placement program | Pilot capabilities plus higher configurable capacity, college-wide reporting, standard AI allowance, subscription self-service, and routine support. This is the expected default paid plan. |
| **Campus Plus** | A larger or more analytics-focused placement program | Campus capabilities plus higher configurable capacity and AI allowance, advanced analytics, custom branding, and priority support. |

The plan catalog should support monthly and annual billing, a trial period, upgrades and downgrades, cancellation at period end, invoice history, and a past-due/suspended state. The payment provider and exact commercial terms are Stage 2/implementation decisions; prices are not yet approved.

## Proposed capacity and usage baseline

The primary plan limit is **active students**. The following are proposed starting values for pilot planning, not approved commercial commitments. They are represented as data in `src/types/subscriptions.ts` so later adjustments do not require rewriting screens or route logic.

| Limit per college workspace | Pilot | Campus | Campus Plus |
| --- | ---: | ---: | ---: |
| Active students | 100 | 500 | 2,000 |
| Trainer seats | 5 | 25 | 100 |
| Active batches | 3 | 20 | 100 |
| AI credits per billing period | 500 | 5,000 | 25,000 |

The initial plan catalog stores these limits as configuration, not as checks scattered through screens or API routes. Validate the proposed quantities with pilot colleges before commercial launch. A student counts as active only when their workspace membership and enrollment are active; a profile row by itself is not sufficient. Trainer seats count active trainer memberships. Pending invitations do not consume seats, but acceptance is checked against current capacity. Active batches exclude archived batches. AI credits need an agreed metering definition before enforcement (for example, one successful AI request or a weighted token unit).

## Base release requirements

### College and account foundation

- Create an isolated college workspace and its first college administrator.
- Invite users, assign workspace roles, deactivate access, and support account recovery.
- Support multiple batches and trainer assignments within a college.
- Enforce workspace boundaries in the server for every read and write.

### Learning and placement workflows

- Maintain student profiles and enrollment state.
- Assign curriculum and assessments to a student or batch.
- Save assessment attempts, scores, and feedback.
- Record technical and HR interview evaluations with structured rubrics.
- Show student progress and basic trainer/college batch views.
- Provide standard student and batch exports, plus notifications for key events.

### Subscription and operations

- Show current plan, subscription status, renewal date, included limits, and usage.
- Enforce active-student, trainer-seat, batch, and AI allowances on the server.
- Support trial, paid, past-due, canceled, and suspended states with clear access behavior.
- Keep invoices and billing contact details available to the college administrator.
- Record administrative and subscription changes in an audit trail.

## Later enhancements

These should fit the tenant, role, and entitlement model, but are not required for the first paid release unless pilot colleges make them launch blockers:

- Individual student subscriptions and self-serve public enrollment
- Custom curriculum and assessment authoring, content marketplace, and versioned learning paths
- Single sign-on, college-system integrations, and automated roster synchronization
- Custom domains and deeper white-labeling
- Multi-campus organization hierarchy and consolidated billing
- Advanced placement analytics and recruiter integrations
- Real code compilation and execution through an isolated, resource-limited judging service

## Foundational design rules

1. Every college-owned record belongs to a tenant, and tenant isolation is enforced server-side.
2. Roles/permissions and plan entitlements are modeled separately.
3. Plan features and quotas are data/configuration driven; new plans and limits should not require UI rewrites.
4. Usage is metered with a defined billing-period boundary and auditable events.
5. Billing-provider identifiers stay behind an internal subscription interface.
6. Curriculum and assessments are versioned so historical student attempts retain their original meaning.
7. Readiness probabilities are advisory product estimates, not promises of placement outcomes.

## Current implementation boundary

The app now has authenticated workspace accounts, tenant-scoped membership, and selected MySQL-backed workflows. `src/types/subscriptions.ts` provides plan defaults and the server-enforced capability registry; `API_AUTHORIZATION.md` maps the API routes. The platform-admin UI supports audited database-backed plan configuration and manual college subscription assignment with dates, status, and private internal notes. Workspace subscription status and usage are visible to college admins, and server-side quotas use configured limits for student/trainer invitations and activations, active batch creation/unarchiving, and provider-generated AI requests. Prices, billing-provider integration, and invoice history are not implemented. The code-run endpoint remains a simulator rather than a production judging service.

## Decisions still open

- Exact prices in INR and any annual discount
- Validation and approval of proposed numeric capacity and AI allowances per tier
- Trial duration and whether Pilot becomes a paid tier or remains a time-limited evaluation offer
- Payment provider and supported payment methods
- What access remains available while a subscription is past due or suspended
- Whether custom branding belongs only in Campus Plus or is an add-on

