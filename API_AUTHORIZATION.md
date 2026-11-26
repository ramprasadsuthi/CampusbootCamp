# API Authorization Map

This map records the middleware attached to every Express API route in `server.ts`. `requireWorkspacePermission(...)` authenticates the college session and permits access when the workspace role has **any one** of the listed capabilities. `requirePlatformPermission(...)` validates a separate platform session and checks only the platform permission registry. Resource handlers also enforce workspace and record-level scope in their queries.

## Public and token-authenticated routes

These routes intentionally do not require an existing session: health and bootstrap/login operations, workspace registration (disabled unless explicitly enabled), invitation acceptance/lookup, password reset, platform login, and platform MFA reset. Invitation and reset handlers validate one-time tokens. Logout revokes the session represented by the caller's cookie.

| Method and path | Access model |
| --- | --- |
| GET `/api/health` | Public or one-time token flow |
| GET `/api/auth/bootstrap-status` | Public or one-time token flow |
| POST `/api/auth/register-workspace` | Public or one-time token flow |
| POST `/api/auth/bootstrap` | Public or one-time token flow |
| POST `/api/auth/login` | Public or one-time token flow |
| POST `/api/auth/accept-invitation` | Public or one-time token flow |
| POST `/api/auth/reset-password` | Public or one-time token flow |
| POST `/api/auth/request-password-reset` | Public; generic response, recipient/IP rate limited |
| POST `/api/auth/logout` | Public or one-time token flow |
| POST `/api/platform/auth/login` | Public or one-time token flow |
| GET `/api/platform/auth/invitations/:token` | Public or one-time token flow |
| POST `/api/platform/auth/invitations/accept` | Public or one-time token flow |
| GET `/api/platform/workspace-invitations/:token` | Public or one-time token flow |
| POST `/api/platform/workspace-invitations/accept` | Public or one-time token flow |
| GET `/api/platform/auth/mfa-resets/:token` | Public or one-time token flow |
| POST `/api/platform/auth/mfa-resets/complete` | Public or one-time token flow |
| POST `/api/billing/razorpay/webhook` | Public endpoint; verifies Razorpay HMAC signature and deduplicates provider event IDs |

## Protected routes

### Required capability: `requireWorkspacePermission('audit.read')`

- GET `/api/workspace/email-deliveries` (latest 50 delivery attempts for the current workspace)

### Required capability: `requireWorkspacePermission('profile.update_own')`

- POST `/api/auth/change-password`
- PATCH `/api/auth/profile`

### Required capability: `requireWorkspacePermission('profile.read_own')`

- GET `/api/auth/me`

### Required capability: `requirePlatformPermission('platform.operations.read')`

- GET `/api/platform/auth/me`
- POST `/api/platform/auth/logout`
- GET `/api/platform/overview`
- GET `/api/platform/audit`
- GET `/api/platform/workspaces`
- GET `/api/platform/workspaces/:id`

### Required capability: `requirePlatformPermission('platform.shared_content.manage')`

- GET `/api/platform/content/applications`
- GET `/api/platform/content/rollout`
- GET `/api/platform/content/versions`
- GET `/api/platform/content/versions/:id`
- POST `/api/platform/content/versions`
- PUT `/api/platform/content/versions/:id`
- POST `/api/platform/content/versions/:id/publish`
- POST `/api/platform/content/versions/:id/apply`
- POST `/api/platform/content/versions/:id/rollback`

### Required capability: `requirePlatformPermission('platform.billing.read')`

- GET `/api/platform/subscription-history`

### Required capability: `requirePlatformPermission('platform.plans.manage')`

- GET `/api/platform/plans`
- PUT `/api/platform/plans/:id`

### Required capability: `requirePlatformPermission('platform.subscriptions.manage')`

- PUT `/api/platform/workspaces/:id/subscription`

### Required capability: `requirePlatformPermission('platform.workspaces.manage')`

- POST `/api/platform/workspaces`
- POST `/api/platform/workspaces/:id/admin-invitations`
- POST `/api/platform/workspaces/:id/admin-invitations/:invitationId/resend`
- POST `/api/platform/workspaces/:id/admin-invitations/:invitationId/revoke`
- PATCH `/api/platform/workspaces/:id/status`

### Required capability: `requirePlatformPermission('platform.settings.manage')`

- POST `/api/platform/admin-invitations`
- POST `/api/platform/admins/:id/mfa-reset`
- GET `/api/platform/admins`
- PATCH `/api/platform/admins/:id/status`

### Required capability: `requireWorkspacePermission('subscription.read')`

- GET `/api/workspace/subscription`
- GET `/api/workspace/billing/plans`

### Required capability: `requireWorkspacePermission('subscription.manage')`

- POST `/api/workspace/billing/checkout`
- POST `/api/workspace/billing/confirm`
- POST `/api/workspace/billing/cancel`

### Required capability: `requireWorkspacePermission('billing.manage')`

- GET `/api/workspace/billing/invoices`
- GET `/api/workspace/billing/invoices/:id/view`

### Required capability: `requireWorkspacePermission('workspace.configure')`

- GET `/api/workspace/settings`
- PUT `/api/workspace/settings`

### Required capability: `requireWorkspacePermission('interview.schedule_workspace')`

- GET `/api/interview-panelists`
- POST `/api/interview-panelists`
- PATCH `/api/interview-panelists/:id`
- PUT `/api/interview-schedules/:id/follow-up`
- POST `/api/interview-schedules`
- PATCH `/api/interview-schedules/:id`

### Required capability: `requireWorkspacePermission('interview.read_workspace')`

- GET `/api/interview-schedules`
- GET `/api/interview-follow-ups/:scheduleId/history`
- GET `/api/interview-schedules/:id/evaluation`

### Required capability: `requireWorkspacePermission('interview.read_own')`

- GET `/api/interview-follow-ups/mine`
- GET `/api/interview-schedules/mine`

### Required capability: `requireWorkspacePermission('interview.panelist.read_assigned')`

- GET `/api/interview-schedules/assigned`

### Required capability: `requireWorkspacePermission('interview.panelist.evaluate_assigned')`

- POST `/api/interview-schedules/:id/evaluation`

### Required capability: `requireWorkspacePermission('members.read')`

- GET `/api/workspace/members`
- GET `/api/workspace/trainers`

### Required capability: `requireWorkspacePermission('members.change_role')`

- PATCH `/api/workspace/members/:id`

### Required capability: `requireWorkspacePermission('students.update_workspace')`

- PATCH `/api/workspace/students/:id`

### Required capability: `requireWorkspacePermission('members.password_reset')`

- POST `/api/workspace/members/:id/password-reset`

### Required capability: `requireWorkspacePermission('audit.read')`

- GET `/api/workspace/audit`

### Required capability: `requireWorkspacePermission('members.change_status')`

- PATCH `/api/workspace/members/:id/status`

### Required capability: `requireWorkspacePermission('members.invite')`

- POST `/api/workspace/invitations`

### Required capability: `requireWorkspacePermission('curriculum.read_own')`

- GET `/api/curriculum/progress`
- GET `/api/curriculum/learning-check`

### Required capability: `requireWorkspacePermission('curriculum.progress.update_own')`

- PUT `/api/curriculum/progress/:dayNumber`
- POST `/api/curriculum/learning-check/attempts`
- PUT `/api/curriculum/materials/:id/progress`

### Required capability: `requireWorkspacePermission('curriculum.read_own', 'curriculum.read_assigned', 'curriculum.manage_workspace')`

- GET `/api/curriculum/materials`

### Required capability: `requireWorkspacePermission('curriculum.manage_workspace')`

- POST `/api/curriculum/materials`
- PATCH `/api/curriculum/materials/:id`
- DELETE `/api/curriculum/materials/:id`

### Required capability: `requireWorkspacePermission('students.read_assigned', 'students.read_workspace')`

- GET `/api/students`

### Required capability: `requireWorkspacePermission('report.read_workspace')`

- GET `/api/reports/activity`
- GET `/api/reports/interviews`
- GET `/api/reports/placement-outcomes`

### Required capability: `requireWorkspacePermission('batches.read_assigned', 'batches.read_workspace')`

- GET `/api/batches`

### Required capability: `requireWorkspacePermission('batches.manage')`

- POST `/api/batches`
- PATCH `/api/batches/:id`

### Required capability: `requireWorkspacePermission('assessment.read_assigned', 'assessment.read_workspace')`

- GET `/api/assessments`
- GET `/api/assessments/:id/submissions`

### Required capability: `requireWorkspacePermission('assessment.manage_assigned', 'assessment.manage_workspace')`

- POST `/api/assessments`
- PATCH `/api/assessments/:id`

### Required capability: `requireWorkspacePermission('assessment.manage_workspace')`

- DELETE `/api/assessments/:id`

### Required capability: `requireWorkspacePermission('assessment.submit_own')`

- POST `/api/assessments/:id/submissions`

### Required capability: `requireWorkspacePermission('assessment.read_own')`

- GET `/api/assessments/submissions/mine`

### Required capability: `requireWorkspacePermission('leaderboard.read_assigned', 'analytics.read_workspace')`

- GET `/api/leaderboard`

### Required capability: `requireWorkspacePermission('notifications.read_own')`

- GET `/api/notifications`

### Required capability: `requireWorkspacePermission('notifications.update_own')`

- PATCH `/api/notifications/:id/read`

### Required capability: `requireWorkspacePermission('interview.evaluate_assigned', 'interview.evaluate_workspace')`

- POST `/api/students/:id/remarks`

### Required capability: `requireWorkspacePermission('interview.read_own', 'interview.history.read_assigned', 'interview.read_workspace')`

- GET `/api/students/:id/interviews`

### Required capability: `requireWorkspacePermission('analytics.read_assigned', 'analytics.read_workspace')`

- GET `/api/analytics/dashboard`

### Required capability: `requireWorkspacePermission('ai.recommendation.own', 'ai.recommendation.assigned', 'ai.recommendation.workspace')`

- POST `/api/ai/recommendations`

### Required capability: `requireWorkspacePermission('ai.readiness.own', 'ai.readiness.assigned', 'ai.readiness.workspace')`

- POST `/api/ai/predict-readiness`

### Required capability: `requireWorkspacePermission('students.update_workspace')`

- PATCH `/api/ai/predictions/:id/outcome` (college administrator only through the workspace role registry)
- GET `/api/ai/predictions/pending`

### Required capability: `requireWorkspacePermission('report.read_workspace')`

- GET `/api/ai/prediction-evaluation`

### Required capability: `requireWorkspacePermission('ai.trainer_summary', 'ai.trainer_summary.workspace')`

- POST `/api/ai/trainer-summary`

### Required capability: `requireWorkspacePermission('code.execute')`

- POST `/api/code/run`

## Scope enforcement

- College requests derive `workspaceId`, user identity, and role from the authenticated server session. Request bodies and query parameters cannot select another workspace.
- College data handlers include the session workspace in database reads and writes. Student and trainer routes targeting a student, batch, or interview additionally check self ownership or assigned batch membership.
- Platform routes intentionally operate across workspaces through the separate platform session. Student-level support access is a distinct capability and is not granted by general operations access.
- The health endpoint is public and returns service status only.

Capability definitions and role grants live in `src/types/subscriptions.ts`; route enforcement is in `server.ts`. Update this map whenever registering or changing API routes.
