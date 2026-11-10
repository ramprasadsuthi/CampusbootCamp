export type WorkspaceRole = 'college_admin' | 'trainer' | 'student';

export interface AuthenticatedSession {
  user: { id: string; name: string; email: string; avatar: string };
  workspace: { id: string; name: string };
  role: WorkspaceRole;
}

export interface WorkspaceMember {
  id: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  status: 'active' | 'inactive';
  createdAt: string;
}

export interface WorkspaceAuditEvent {
  id: string;
  action: string;
  targetUserId?: string | null;
  actorName?: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}
