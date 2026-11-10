import { AuthenticatedSession, WorkspaceAuditEvent, WorkspaceMember } from '../types/auth';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}

export const getCurrentSession = () => request<AuthenticatedSession>('/api/auth/me');
export const getBootstrapStatus = () => request<{ enabled: boolean; registrationEnabled: boolean; workspaceName: string }>('/api/auth/bootstrap-status');

export function registerWorkspace(params: { workspaceName: string; name: string; email: string; password: string }) {
  return request<{ success: boolean }>('/api/auth/register-workspace', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export function signIn(email: string, password: string) {
  return request<{ success: boolean }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function bootstrapCollege(params: {
  bootstrapToken: string;
  workspaceName: string;
  name: string;
  email: string;
  password: string;
}) {
  return request<{ success: boolean }>('/api/auth/bootstrap', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export function acceptInvitation(params: { token: string; name: string; password: string }) {
  return request<{ success: boolean }>('/api/auth/accept-invitation', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export function resetPassword(token: string, newPassword: string) {
  return request<{ success: boolean }>('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  });
}

export function signOut() {
  return request<{ success: boolean }>('/api/auth/logout', { method: 'POST' });
}

export const getWorkspaceMembers = () => request<WorkspaceMember[]>('/api/workspace/members');
export const getWorkspaceTrainers = () => request<Array<{ id: string; name: string; email: string }>>('/api/workspace/trainers');
export const getWorkspaceAudit = () => request<WorkspaceAuditEvent[]>('/api/workspace/audit');

export function setWorkspaceMemberStatus(userId: string, status: WorkspaceMember['status']) {
  return request<{ success: boolean }>(`/api/workspace/members/${encodeURIComponent(userId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function createWorkspacePasswordReset(userId: string) {
  return request<{ success: boolean; resetPath: string; expiresInMinutes: number }>(`/api/workspace/members/${encodeURIComponent(userId)}/password-reset`, { method: 'POST' });
}

export function inviteWorkspaceMember(email: string, role: WorkspaceMember['role'], batchId?: string) {
  return request<{ success: boolean; invitePath: string; expiresInDays: number }>('/api/workspace/invitations', {
    method: 'POST',
    body: JSON.stringify({ email, role, batchId }),
  });
}
