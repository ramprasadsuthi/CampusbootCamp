export type WorkspaceRole = 'college_admin' | 'trainer' | 'student' | 'panelist';

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
  batchId?: string | null;
  batchName?: string | null;
}

export interface WorkspaceAuditEvent {
  id: string;
  action: string;
  targetUserId?: string | null;
  actorName?: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface WorkspaceSettings {
  atRiskBelow: number;
  tierOneAtOrAbove: number;
  defaultInterviewDurationMinutes: number;
}

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  atRiskBelow: 65,
  tierOneAtOrAbove: 80,
  defaultInterviewDurationMinutes: 30,
};

export interface WorkspaceInterviewSchedule {
  id: string;
  studentId: string;
  studentName: string;
  rollNo: string;
  batchName: string;
  interviewType: 'tech' | 'hr';
  scheduledAt: string;
  durationMinutes: number;
  panelist: string;
  panelistId: string;
  location: string;
  notes: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  hasEvaluation?: boolean;
  evaluationScore?: number | null;
  evaluationRecommendation?: string | null;
  evaluationDate?: string | null;
  followUpOutcome?: 'needs_another_interview' | 'referred_for_placement' | 'offer_confirmed' | 'no_further_action' | null;
  followUpNotes?: string;
  followUpStudentNotes?: string;
}

export interface StudentInterviewFollowUp {
  id: string;
  outcome: 'needs_another_interview' | 'referred_for_placement' | 'offer_confirmed' | 'no_further_action';
  studentNotes: string;
  updatedAt: string;
  interviewType: 'tech' | 'hr';
  interviewDate: string;
}

export interface WorkspaceInterviewPanelist {
  id: string;
  name: string;
  email: string;
  userId?: string | null;
  designation: string;
  specialties: string;
  isActive: boolean;
}

export interface WorkspaceUserNotification {
  id: string;
  title: string;
  desc: string;
  time: string;
  unread: boolean;
  createdAt: string;
  notificationType: string;
}
