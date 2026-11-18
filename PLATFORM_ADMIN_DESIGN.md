# Platform Administration Design

## Current implementation

The original college workflows use tenant-scoped workspace sessions. A separate Platform Admin foundation is now implemented at `/platform-admin`:

- Platform accounts use their own account table, MFA secret, session cookie, and server authorization guard. They do not need a college membership.
- TOTP MFA is mandatory. Authenticator secrets are encrypted with `PLATFORM_MFA_ENCRYPTION_KEY`; the initial account is created through `npm run platform-admin:create`, and additional admins are invited by an existing platform admin.
- The console shows a workspace overview and directory, supports onboarding workspace creation and first college-admin invitations, shows workspace-level details, and supports reversible lifecycle changes with a reason and audit record.
- Workspace details show first administrator invitation state and an onboarding checklist. A workspace cannot be set to Active until at least one college-admin membership and account are both active; the API enforces this in addition to the disabled UI action.
- Workspace details list college-admin invitations with pending, accepted, expired, and revoked states. Platform admins can resend or revoke pending links; creating/resending a link invalidates any previous pending link for that email, and all invite changes are audited.
- The platform-wide audit log is searchable by actor, workspace, action, reason, and identifier, and supports target-type/date filters with pagination.
- The platform overview flags onboarding older than seven days, current college-admin invites that have expired or expire within 24 hours, and student/trainer/batch capacity at 80% or more of the assigned planning limit. Alerts link to workspace details; 90% and 100% capacity are raised to higher severity.
- The Shared content library stores versioned releases of common Day 1–40 video/PDF/text materials and built-in sample assessment templates. Platform admins edit drafts, publish with a reason, then explicitly apply a published release to selected onboarding or active colleges with a reason. Its application history records the college, release, actor, timestamp, reason, and item counts, with college/date filters. A rollout view compares each college's current release with the latest published release and flags current, behind, and not-applied colleges. A rollback reapplies an earlier published release as a new history entry; shared items absent from that version are archived (not deleted), preserving student material progress and assessment submissions. College-customized items are preserved.
- The Plans & subscriptions page stores editable Pilot, Campus, and Campus Plus names, descriptions, feature sets, and usage limits without prices. Platform admins can manually set each college's plan, subscription state, start/end dates, and platform-only internal note; both plan and subscription changes require a reason and write before/after audit records. Plan limits and features are loaded from the database by current server-side quota and feature checks.
- College sign-in is blocked for suspended or archived workspaces, and their existing sessions are revoked when the state changes.
- `src/types/subscriptions.ts` and `PRODUCT_SCOPE.md` still define the broader permission and product policy groundwork.
- `WorkspaceSubscriptions` stores each college's plan, status, interval, term dates, and private platform-admin note. College admins can view their own subscription and usage; the internal note is excluded from their API response.
- Plan catalog records are database-backed with the fixed IDs `pilot`, `campus`, and `campus_plus`. Prices are unset, and billing/payment processing is not implemented.

Payment/invoice operations and support access to student records remain unimplemented. The console intentionally shows operational counts and college-admin contacts rather than student records.

## Design principles

1. **Keep platform identity separate.** A platform admin must not gain access by being assigned a college role. Use dedicated platform-admin accounts and platform sessions (or an equivalent session type with no workspace context). Do not use a fake/default college workspace.
2. **Keep all tenant operations explicitly scoped.** Platform routes use a platform-only authorization guard. College routes continue to require an active membership and a workspace ID.
3. **Audit every consequential action.** Record the platform actor, target workspace/account, action, timestamp, reason, and before/after values for plan, subscription, suspension, and support-access changes.
4. **Prefer reversible controls.** Suspend, reactivate, archive, and correct subscription state. Avoid a routine hard-delete operation for colleges and their learning records.
5. **Make commercial assumptions configurable.** Pricing, plan limits, and included features need product approval before being represented as sellable terms.

## Platform-admin capabilities

### 1. Platform overview

- Total, active, trialing, past-due, suspended, and onboarding workspaces.
- New workspace and subscription changes over a selected date range.
- Usage approaching or exceeding plan limits.
- Operational indicators such as failed invitations, authentication issues, and recent administrative actions.
- Links to the relevant workspace detail pages.

### 2. College/workspace directory

- Search and filter by college name, slug, status, plan, subscription state, and creation date.
- Open a workspace detail page with its primary contacts, administrators, batches, active student/trainer counts, usage, plan, and subscription dates.
- Create/provision a workspace and its first college administrator.
- Suspend and reactivate workspace access with a required reason and audit entry.
- Archive a workspace through a controlled retention process; do not permanently delete it from the normal UI.

### 3. Plan catalog

- List and edit plan name, description, included features, quotas, currency, and monthly/annual prices.
- Keep plan IDs stable and store plan definitions in the database (or a versioned catalog) instead of a MySQL enum plus TypeScript-only list.
- Preview the impact of a plan change against current workspace usage before saving.
- Preserve the plan version/terms assigned to existing subscriptions so editing the catalog does not silently rewrite existing agreements.

### 4. Subscription administration

- Assign a plan and set trial, active, past-due, canceled, or suspended state.
- Set billing interval, period dates, trial end, and cancel-at-period-end state.
- Show current usage alongside limits and warn before assigning a plan below existing usage.
- Record a reason and actor for manual changes; show a history of subscription changes.
- Keep payment collection, invoices, tax, refunds, and automated renewal out of the initial stage until a payment provider and billing rules are selected.

### 5. Platform settings and shared content

- Manage platform-level configuration separately from college `WorkspaceSettings`.
- Later add centrally authored shared curriculum/assessment templates with versioning and explicit publish/apply behavior.
- Keep college-specific student records and content isolated from the shared catalog.

### 6. Support access

- Default to workspace-level operational metadata, not student records.
- If support needs student-level access, require a reason, a time-limited grant, a visible support session indicator, read-only access by default, and a detailed audit trail.
- Do not silently impersonate a college administrator or student.

## Recommended data model changes

- `PlatformAdminAccounts`: separate account ID, name, unique email, scrypt password hash, encrypted TOTP secret, active state, inviter, and last-login timestamp. It does not reuse college `Users` or memberships.
- `PlatformAdminSessions`: hashed session token and expiry; no `workspaceId`.
- `PlatformAdminInvitations` and `PlatformAdminMfaResets`: one-time, expiring invite and authenticator-recovery tokens.
- `PlatformWorkspaceAdminInvitations`: out-of-band setup links for first college administrators.
- `PlatformAuditEvents`: actor, action, target type/ID, reason, before/after JSON, timestamp, request metadata.
- `PlatformPlanCatalog`: stable plan key, version, display metadata, price fields, currency, features/limits JSON, active/effective dates.
- `WorkspaceSubscriptions`: reference a stable plan key/version, store operational billing state, and retain current period/trial data.
- `WorkspaceSubscriptionHistory`: immutable record of plan/status/term changes and operator reason.
- Add workspace lifecycle state and reason/updated metadata to `Workspaces` or a dedicated lifecycle table.

The current `WorkspaceSubscriptions.planId` enum will need a careful migration to a stable string/catalog reference before plans become editable. Preserve existing `pilot`, `campus`, and `campus_plus` assignments during migration.

## Delivery sequence

### Stage A — Platform identity and authorization

1. Approve who can create platform-admin accounts and how recovery works.
2. Add dedicated platform-admin identity, MFA policy, and platform sessions.
3. Add `requirePlatformRole` middleware and platform-only API route grouping.
4. Prove that platform sessions cannot call college APIs without an explicit workspace membership, and college sessions cannot call platform APIs.
5. Add immutable platform audit records before adding write controls.

### Stage B — Read-only operations console

1. Add a separate Platform Admin shell and navigation, visible only to platform admins.
2. Add overview metrics and a searchable workspace directory.
3. Add a read-only workspace detail page for contacts, membership counts, usage, plan, and subscription state.
4. Add cross-tenant reporting that exposes only the fields needed for platform operations.

### Stage C — Workspace lifecycle and subscriptions

1. Add workspace provisioning and first-admin setup.
2. Add suspend/reactivate/archive actions with required reason, confirmation, and audit history.
3. Migrate plan definitions out of the enum/static-only catalog into database-backed records. **Implemented.**
4. Add plan assignment and manual subscription-state/term controls with audit records. **Implemented.**
5. Add a dedicated subscription change history and exports.

### Stage D — Plans, shared content, and support operations

1. Add prices, billing intervals, and renewal rules only after commercial terms are approved.
2. Add controlled support access, with consent/approval policy, expiry, indicator, and audit.
3. Add billing-provider integration after provider selection.

## First implementation slice

**Stages A and the initial Stage B slice are implemented**, along with shared content versioning and publishing, and database-backed plan configuration/manual subscription administration: dedicated platform-admin sign-in, mandatory MFA, platform-only authorization, audit logging, workspace overview/directory, onboarding provisioning, a workspace detail page, and the shared content library. Do not expose student records in this foundation. The remaining delivery sequence is subscription change history/exports, approved commercial terms and billing integration, and audited support tooling.

## Decisions needed before subscription controls

- Which named people or identity provider can create platform-admin accounts?
- Is MFA mandatory for all platform admins?
- Which lifecycle states should colleges have (for example, onboarding, active, suspended, archived)?
- Who approves plan prices, quotas, trials, and manual subscription changes?
- Which payment provider, invoice/tax requirements, and refund workflow will be used?
- What support-access approval, duration, and student-data visibility policy is acceptable?

