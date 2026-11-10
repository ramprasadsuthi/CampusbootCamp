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
| **College administrator** | Configure the college workspace; invite and deactivate users; assign college roles; create batches and enroll students; assign trainers; view college-level usage and reports; manage the college subscription and billing contacts. |
| **TalentEdge platform administrator** | Create and support college workspaces; manage plan catalog and subscriptions; administer shared content and platform settings; view operational and billing information. Student-data access is limited to support needs and should be audited. |

Permissions are scoped by workspace and role. Subscription entitlements are a separate concern: a role determines what a user may do, while the plan determines which capabilities and capacity the college has purchased.

## Initial subscription tiers

All tiers are college subscriptions. A trial is a subscription state or offer, not a separate feature tier. Exact prices and numeric limits remain to be set after pilot discovery.

| Tier | Intended use | Included capabilities |
| --- | --- | --- |
| **Pilot** | A college validating the workflow with a bounded cohort | Core college workspace, student/trainer roles, batches, assigned curriculum, assessments and results, interview feedback, basic dashboards and standard exports, small included AI allowance, time-limited trial or pilot terms. |
| **Campus** | A college operating its placement program | Pilot capabilities plus higher configurable capacity, college-wide reporting, standard AI allowance, subscription self-service, and routine support. This is the expected default paid plan. |
| **Campus Plus** | A larger or more analytics-focused placement program | Campus capabilities plus higher configurable capacity and AI allowance, advanced analytics, custom branding, and priority support. |

The plan catalog should support monthly and annual billing, a trial period, upgrades and downgrades, cancellation at period end, invoice history, and a past-due/suspended state. The payment provider and exact commercial terms are Stage 2/implementation decisions; prices are not yet approved.

## Capacity and usage dimensions

The primary plan limit is **active students**. Each plan also has independently configurable limits for:

- Trainer seats
- Active batches
- AI requests or credits per billing period

The initial plan catalog should store these limits as configuration, not as checks scattered through screens or API routes. Exact values are intentionally marked **TBD** pending pilot feedback. A student should count as active based on an explicit enrollment/account state and the subscription period, not simply because a profile row exists.

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
- Show student progress and basic trainer/college cohort views.
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

## Current codebase gap

The current app is a demo/prototype with role switching, sample data, and selected MySQL-backed routes. It does not yet have authenticated accounts, college tenant isolation, persisted subscription/billing records, usage enforcement, or a production code-execution service. This document and the subscription types are the Stage 1 scope foundation; subsequent stages must implement those capabilities before public paid launch.

## Decisions still open

- Exact prices in INR and any annual discount
- Numeric capacity and AI allowances per tier
- Trial duration and whether Pilot becomes a paid tier or remains a time-limited evaluation offer
- Payment provider and supported payment methods
- What access remains available while a subscription is past due or suspended
- Whether custom branding belongs only in Campus Plus or is an add-on

