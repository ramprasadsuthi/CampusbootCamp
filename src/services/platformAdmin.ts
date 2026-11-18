export interface PlatformWorkspace {
  id: string; name: string; slug: string; lifecycleStatus: 'onboarding' | 'active' | 'suspended' | 'archived';
  statusReason: string; createdAt: string; planId: string; subscriptionStatus: string; activeStudents: number; staffCount: number;
}

async function platformRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}

export const getPlatformSession = () => platformRequest<{ user: { id: string; name: string; email: string }; role: 'platform_admin' }>('/api/platform/auth/me');
export const platformLogin = (email: string, password: string, code: string) => platformRequest<{ success: boolean }>('/api/platform/auth/login', { method: 'POST', body: JSON.stringify({ email, password, code }) });
export const platformLogout = () => platformRequest<{ success: boolean }>('/api/platform/auth/logout', { method: 'POST' });
export const getPlatformOverview = () => platformRequest<any>('/api/platform/overview');
export interface SharedMaterialDraft { id: string; dayNumber: number; title: string; materialType: 'video' | 'text' | 'pdf'; contentUrl: string | null; contentText: string | null; contentFormat: 'markdown' | 'html'; position: number; isRequired: boolean; }
export interface SharedContentVersion { id: string; versionNumber: number; title: string; status: 'draft' | 'published'; createdAt: string; publishedAt: string | null; createdBy: string | null; publishedBy: string | null; appliedWorkspaceCount: number; materialCount: number; assessmentCount: number; }
export interface SharedAssessmentTemplateSummary { id: string; dayNumber: number; title: string; type: string; durationMinutes: number; totalMarks: number; questionCount: number; }
export interface SharedContentVersionDetail extends Omit<SharedContentVersion, 'createdBy' | 'publishedBy' | 'appliedWorkspaceCount' | 'materialCount' | 'assessmentCount'> { materials: SharedMaterialDraft[]; assessmentTemplates: SharedAssessmentTemplateSummary[]; enabledAssessmentIds: string[]; }
export const getSharedContentVersions = () => platformRequest<SharedContentVersion[]>('/api/platform/content/versions');
export const getSharedContentVersion = (id: string) => platformRequest<SharedContentVersionDetail>(`/api/platform/content/versions/${encodeURIComponent(id)}`);
export const createSharedContentDraft = () => platformRequest<{ id: string; versionNumber: number; title: string; status: 'draft' }>('/api/platform/content/versions', { method: 'POST' });
export const saveSharedContentDraft = (id: string, payload: { title: string; materials: SharedMaterialDraft[]; enabledAssessmentIds: string[] }) => platformRequest<{ success: boolean; id: string; title: string; materialCount: number; assessmentCount: number }>(`/api/platform/content/versions/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) });
export const publishSharedContent = (id: string, reason: string) => platformRequest<{ success: boolean; versionNumber: number; title: string }>(`/api/platform/content/versions/${encodeURIComponent(id)}/publish`, { method: 'POST', body: JSON.stringify({ reason }) });
export const applySharedContent = (id: string, workspaceId: string, reason: string) => platformRequest<{ success: boolean; workspaceName: string; versionNumber: number; materialAdded: number; materialUpdated: number; materialPreserved: number; assessmentAdded: number; assessmentUpdated: number; assessmentPreserved: number }>(`/api/platform/content/versions/${encodeURIComponent(id)}/apply`, { method: 'POST', body: JSON.stringify({ workspaceId, reason }) });
export interface PlatformAuditEvent { id: string; action: string; targetType: string; targetId: string | null; targetName: string | null; reason: string; createdAt: string; actorName: string; actorEmail: string | null; }
export const getPlatformAuditEvents = (filters: { q?: string; action?: string; targetType?: string; dateFrom?: string; dateTo?: string; offset?: number }) => platformRequest<{ items: PlatformAuditEvent[]; total: number; offset: number; limit: number }>(`/api/platform/audit?${new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '').map(([key, value]) => [key, String(value)]))}`);
export const getPlatformWorkspaces = (params: { q: string; status: string }) => platformRequest<PlatformWorkspace[]>(`/api/platform/workspaces?${new URLSearchParams(params)}`);
export const getPlatformWorkspace = (id: string) => platformRequest<any>(`/api/platform/workspaces/${encodeURIComponent(id)}`);
export const createPlatformWorkspace = (data: { name: string; adminName: string; adminEmail: string }) => platformRequest<{ id: string; name: string; inviteUrl: string }>('/api/platform/workspaces', { method: 'POST', body: JSON.stringify(data) });
export const inviteWorkspaceAdmin = (id: string, email: string) => platformRequest<{ inviteUrl: string }>(`/api/platform/workspaces/${encodeURIComponent(id)}/admin-invitations`, { method: 'POST', body: JSON.stringify({ email }) });
export const resendWorkspaceAdminInvitation = (workspaceId: string, invitationId: string, reason: string) => platformRequest<{ invitationId: string; email: string; inviteUrl: string }>(`/api/platform/workspaces/${encodeURIComponent(workspaceId)}/admin-invitations/${encodeURIComponent(invitationId)}/resend`, { method: 'POST', body: JSON.stringify({ reason }) });
export const revokeWorkspaceAdminInvitation = (workspaceId: string, invitationId: string, reason: string) => platformRequest<{ success: boolean }>(`/api/platform/workspaces/${encodeURIComponent(workspaceId)}/admin-invitations/${encodeURIComponent(invitationId)}/revoke`, { method: 'POST', body: JSON.stringify({ reason }) });
export const setPlatformWorkspaceStatus = (id: string, status: string, reason: string) => platformRequest<{ success: boolean }>(`/api/platform/workspaces/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status, reason }) });
export const createPlatformAdminInvitation = (email: string) => platformRequest<{ inviteUrl: string }>('/api/platform/admin-invitations', { method: 'POST', body: JSON.stringify({ email }) });
export const getPlatformAdmins = () => platformRequest<Array<{ id: string; name: string; email: string; isActive: boolean; lastLoginAt: string | null; createdAt: string }>>('/api/platform/admins');
export const setPlatformAdminStatus = (id: string, isActive: boolean, reason: string) => platformRequest<{ success: boolean }>(`/api/platform/admins/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ isActive, reason }) });
export const requestPlatformMfaReset = (id: string, reason: string) => platformRequest<{ email: string; inviteUrl: string }>(`/api/platform/admins/${encodeURIComponent(id)}/mfa-reset`, { method: 'POST', body: JSON.stringify({ reason }) });
export const getPlatformMfaReset = (token: string) => platformRequest<{ email: string; totpSecret: string }>(`/api/platform/auth/mfa-resets/${encodeURIComponent(token)}`);
export const completePlatformMfaReset = (data: { token: string; totpSecret: string; code: string }) => platformRequest<{ success: boolean }>('/api/platform/auth/mfa-resets/complete', { method: 'POST', body: JSON.stringify(data) });
export const getPlatformAdminInvite = (token: string) => platformRequest<{ email: string; totpSecret: string }>(`/api/platform/auth/invitations/${encodeURIComponent(token)}`);
export const acceptPlatformAdminInvite = (data: { token: string; name: string; password: string; totpSecret: string; code: string }) => platformRequest<{ success: boolean }>('/api/platform/auth/invitations/accept', { method: 'POST', body: JSON.stringify(data) });
export const getCollegeAdminInvite = (token: string) => platformRequest<{ email: string; workspaceName: string }>(`/api/platform/workspace-invitations/${encodeURIComponent(token)}`);
export const acceptCollegeAdminInvite = (data: { token: string; name: string; password: string }) => platformRequest<{ success: boolean }>('/api/platform/workspace-invitations/accept', { method: 'POST', body: JSON.stringify(data) });
