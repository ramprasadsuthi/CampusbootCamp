# Platform Administration Design

## Current implementation

The original college workflows use tenant-scoped workspace sessions. A separate Platform Admin foundation is now implemented at `/platform-admin`:

- Platform accounts use their own account table, MFA secret, session cookie, and server authorization guard. They do not need a college membership.
- TOTP MFA is mandatory. Authenticator secrets are encrypted with `PLATFORM_MFA_ENCRYPTION_KEY`; the initial account is created through `npm run platform-admin:create`, and additional admins are invited by an existing platform admin.
- The console shows a workspace overview and directory, supports onboarding workspace creation and first college-admin invitations, shows workspace-level details, and supports reversible lifecycle changes with a reason and audit record.
- College sign-in is blocked for suspended or archived workspaces, and their existing sessions are revoked when the state changes.
- `src/types/subscriptions.ts` and `PRODUCT_SCOPE.md` still define the broader permission and product policy groundwork.
- `WorkspaceSubscriptions` stores each college's plan, status, interval, and term dates. College admins can view their own subscription and usage.
- The plan catalog (`pilot`, `campus`, `campus_plus`) and proposed limits are currently defined in TypeScript. Prices are unset, and billing/payment processing is not implemented.

Plan catalog editing, subscription changes, payment/invoice operations, shared content management, and support access to student records remain unimplemented. The console intentionally shows operational counts and college-admin contacts rather than student records.

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
3. Migrate plan definitions out of the enum/static-only catalog into versioned plan records.
4. Add plan assignment and subscription-state controls with usage-impact warnings.
5. Add subscription change history and exports.

### Stage D — Plans, shared content, and support operations

1. Add plan catalog editing only after pricing and entitlement policy are approved.
2. Add shared content publishing/versioning if centrally managed sample material is required.
3. Add controlled support access, with consent/approval policy, expiry, indicator, and audit.
4. Add operational alerts and billing-provider integration after provider selection.

## First implementation slice

**Stage A and the initial Stage B slice are implemented**: dedicated platform-admin sign-in, mandatory MFA, platform-only authorization, audit logging, workspace overview/directory, onboarding provisioning, and a workspace detail page. Do not expose student records in this foundation. The remaining delivery sequence is the plan catalog, subscription history and changes, shared content, and audited support tooling.

## Decisions needed before subscription controls

- Which named people or identity provider can create platform-admin accounts?
- Is MFA mandatory for all platform admins?
- Which lifecycle states should colleges have (for example, onboarding, active, suspended, archived)?
- Who approves plan prices, quotas, trials, and manual subscription changes?
- Which payment provider, invoice/tax requirements, and refund workflow will be used?
- What support-access approval, duration, and student-data visibility policy is acceptable?

