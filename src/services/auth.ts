import { AuthenticatedSession, StudentInterviewFollowUp, WorkspaceAuditEvent, WorkspaceInterviewPanelist, WorkspaceInterviewSchedule, WorkspaceMember, WorkspaceSettings } from '../types/auth';
import { WorkspaceSubscriptionOverview } from '../types/subscriptions';

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

export function updateAccountProfile(params: { name: string; avatar?: string | null }) {
  return request<{ user: AuthenticatedSession['user'] }>('/api/auth/profile', {
    method: 'PATCH',
    body: JSON.stringify(params),
  });
}

export function changeAccountPassword(currentPassword: string, newPassword: string) {
  return request<{ success: boolean }>('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

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
export const getWorkspaceSettings = () => request<{ settings: WorkspaceSettings }>('/api/workspace/settings');
export const getWorkspaceSubscriptionOverview = () => request<WorkspaceSubscriptionOverview>('/api/workspace/subscription');
export const saveWorkspaceSettings = (settings: WorkspaceSettings) => request<{ settings: WorkspaceSettings }>('/api/workspace/settings', {
  method: 'PUT',
  body: JSON.stringify(settings),
});
export const getInterviewSchedules = () => request<WorkspaceInterviewSchedule[]>('/api/interview-schedules');
export const getMyInterviewSchedules = () => request<WorkspaceInterviewSchedule[]>('/api/interview-schedules/mine');
export const getMyInterviewFollowUps = () => request<StudentInterviewFollowUp[]>('/api/interview-follow-ups/mine');
export interface AssignedPanelistInterview extends Omit<WorkspaceInterviewSchedule, 'batchName'> { hasEvaluation: boolean; }
export interface PanelistInterviewEvaluation { ratings: Record<string, number>; remarks: string; recommendation: 'hire' | 'borderline' | 'remedial'; }
export interface InterviewEvaluationDetail {
  id: string; studentId: string; studentName: string; rollNo: string; interviewType: 'tech' | 'hr';
  panelist: string; scheduledAt: string; evaluationDate: string; ratings: Record<string, number>;
  remarks: string; recommendation: string; score: number;
}
export const getInterviewEvaluationDetail = (scheduleId: string) => request<InterviewEvaluationDetail>(`/api/interview-schedules/${encodeURIComponent(scheduleId)}/evaluation`);
export const getAssignedPanelistInterviews = () => request<AssignedPanelistInterview[]>('/api/interview-schedules/assigned');
export const submitPanelistInterviewEvaluation = (scheduleId: string, evaluation: PanelistInterviewEvaluation) => request<{ success: boolean; score: number }>(`/api/interview-schedules/${encodeURIComponent(scheduleId)}/evaluation`, { method: 'POST', body: JSON.stringify(evaluation) });
export const markWorkspaceNotificationRead = (id: string) => request<{ success: boolean }>(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
export const getInterviewPanelists = () => request<WorkspaceInterviewPanelist[]>('/api/interview-panelists');
export function saveInterviewPanelist(params: Partial<Pick<WorkspaceInterviewPanelist, 'id'>> & Omit<WorkspaceInterviewPanelist, 'id' | 'isActive'>) {
  const { id, ...body } = params;
  return request<{ success: boolean; id: string }>(id ? `/api/interview-panelists/${encodeURIComponent(id)}` : '/api/interview-panelists', {
    method: id ? 'PATCH' : 'POST', body: JSON.stringify(body),
  });
}
export function setInterviewPanelistStatus(id: string, isActive: boolean) {
  return request<{ success: boolean }>(`/api/interview-panelists/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ isActive }) });
}
export function createInterviewSchedule(params: Omit<WorkspaceInterviewSchedule, 'id' | 'studentName' | 'rollNo' | 'batchName' | 'panelist'>) {
  return request<{ success: boolean; id: string }>('/api/interview-schedules', { method: 'POST', body: JSON.stringify(params) });
}
export function updateInterviewSchedule(id: string, params: Omit<WorkspaceInterviewSchedule, 'id' | 'studentName' | 'rollNo' | 'batchName' | 'panelist'>) {
  return request<{ success: boolean }>(`/api/interview-schedules/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(params) });
}
export function cancelInterviewSchedule(id: string) {
  return request<{ success: boolean }>(`/api/interview-schedules/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) });
}

export type InterviewFollowUpOutcome = 'needs_another_interview' | 'referred_for_placement' | 'offer_confirmed' | 'no_further_action';
export function saveInterviewFollowUp(id: string, params: { outcome: InterviewFollowUpOutcome; notes: string; studentNotes: string }) {
  return request<{ success: boolean; outcome: InterviewFollowUpOutcome; notes: string; studentNotes: string }>(`/api/interview-schedules/${encodeURIComponent(id)}/follow-up`, { method: 'PUT', body: JSON.stringify(params) });
}

export function setWorkspaceMemberStatus(userId: string, status: WorkspaceMember['status']) {
  return request<{ success: boolean }>(`/api/workspace/members/${encodeURIComponent(userId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function updateWorkspaceMember(userId: string, params: { role?: WorkspaceMember['role']; batchId?: string | null }) {
  return request<{ success: boolean }>(`/api/workspace/members/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify(params),
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
