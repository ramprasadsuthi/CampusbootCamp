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
export const getPlatformWorkspaces = (params: { q: string; status: string }) => platformRequest<PlatformWorkspace[]>(`/api/platform/workspaces?${new URLSearchParams(params)}`);
export const getPlatformWorkspace = (id: string) => platformRequest<any>(`/api/platform/workspaces/${encodeURIComponent(id)}`);
export const createPlatformWorkspace = (data: { name: string; adminName: string; adminEmail: string }) => platformRequest<{ id: string; name: string; inviteUrl: string }>('/api/platform/workspaces', { method: 'POST', body: JSON.stringify(data) });
export const inviteWorkspaceAdmin = (id: string, email: string) => platformRequest<{ inviteUrl: string }>(`/api/platform/workspaces/${encodeURIComponent(id)}/admin-invitations`, { method: 'POST', body: JSON.stringify({ email }) });
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
