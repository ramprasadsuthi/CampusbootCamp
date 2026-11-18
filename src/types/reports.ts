export type ReportActivityType = 'placement_readiness' | 'assessment_submitted' | 'interview_scheduled' | 'interview_completed';

export interface WorkspaceActivityRow {
  id: string;
  activityType: Exclude<ReportActivityType, 'placement_readiness'>;
  activityName: string;
  activityDate: string;
  studentId: string;
  studentName: string;
  rollNo: string;
  batchId: string | null;
  batchName: string;
  readinessScore: number;
  score: number | null;
  outcome: string;
}

export interface WorkspaceActivityResult {
  rows: WorkspaceActivityRow[];
  truncated: boolean;
}

export type InterviewReportLifecycle = 'scheduled' | 'awaiting_evaluation' | 'completed' | 'cancelled';

export interface InterviewReportRow {
  id: string;
  studentId: string;
  studentName: string;
  rollNo: string;
  batchName: string;
  interviewType: 'tech' | 'hr';
  scheduledAt: string;
  durationMinutes: number;
  panelistId: string;
  panelist: string;
  status: string;
  lifecycle: InterviewReportLifecycle;
  evaluationScore: number | null;
  recommendation: string | null;
  evaluationDate: string | null;
  followUpOutcome: 'needs_another_interview' | 'referred_for_placement' | 'offer_confirmed' | 'no_further_action' | null;
  followUpNotes: string;
  followUpStudentNotes: string;
}

export interface InterviewReportResult {
  interviews: InterviewReportRow[];
  truncated: boolean;
  summary: { total: number; scheduled: number; awaitingEvaluation: number; completed: number; cancelled: number; averageScore: number | null };
  recommendations: { hire: number; borderline: number; needImprovement: number; unrecorded: number };
}

export type PlacementOutcome = 'needs_another_interview' | 'referred_for_placement' | 'offer_confirmed' | 'no_further_action';
export interface PlacementOutcomeRow {
  scheduleId: string;
  studentId: string;
  studentName: string;
  email: string;
  rollNo: string;
  batchName: string;
  interviewType: 'tech' | 'hr';
  interviewDate: string;
  outcome: PlacementOutcome;
  adminNotes: string;
  studentNotes: string;
  updatedAt: string;
  historyCount: number;
}
export interface PlacementOutcomeReport { rows: PlacementOutcomeRow[]; truncated: boolean; }
export interface PlacementOutcomeHistoryRow {
  id: string;
  outcome: PlacementOutcome;
  notes: string;
  studentNotes: string;
  createdAt: string;
  updatedBy: string;
}
