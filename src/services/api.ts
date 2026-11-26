export interface AiRecommendationResponse {
  recommendation: string;
  generatedByAI: boolean;
}
export interface AiPredictionResponse {
  eventId: string;
  modelVersion: string;
  readinessIndex: number;
  readinessTier: 'high' | 'moderate' | 'needs_attention';
  predictedReady: boolean;
  topStrengths: string[];
  criticalGaps: string[];
  summary: string;
  generatedByAI: boolean;
}

export interface CodeRunResponse {
  success: boolean;
  score: number;
  totalTestCases: number;
  passedTestCases: number;
  executionTimeMs: number;
  memoryKb: number;
  language: string;
  stdout: string;
  results: {
    testCaseId: number;
    input: string;
    expected: string;
    actual: string;
    passed: boolean;
    hidden: boolean;
    executionTimeMs: number;
    memoryKb: number;
  }[];
}

class PlanLimitReachedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanLimitReachedError';
  }
}

async function throwForAiResponseError(response: Response) {
  if (response.ok) return;
  const data = await response.json().catch(() => ({}));
  if (data.code === 'PLAN_LIMIT_REACHED') throw new PlanLimitReachedError(data.error || 'This workspace has reached its plan limit.');
  throw new Error(data.error || `HTTP ${response.status}`);
}

export async function fetchAiRecommendations(params: {
  studentId: string;
  studentName: string;
  scores: Record<string, number>;
  weakAreas: string[];
  targetCompanies?: string[];
}): Promise<AiRecommendationResponse> {
  try {
    const res = await fetch('/api/ai/recommendations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    await throwForAiResponseError(res);
    return await res.json();
  } catch (err) {
    if (err instanceof PlanLimitReachedError) throw err;
    console.warn('Fallback to local recommendation:', err);
    return {
      recommendation: `### 🎯 High-Impact Placement Action Plan for ${params.studentName}
- **Algorithmic Focus (90 mins/day)**: Prioritize **${params.weakAreas[0] || 'Dynamic Programming'}** on LeetCode/HackerRank. Work through 3 problems daily: 1 Easy, 1 Medium, 1 Standard Company Previous Question.
- **Speed Aptitude Drills (45 mins/day)**: Practice 20 questions timed at 60 seconds per question on **${params.weakAreas[1] || 'Time & Work & Probability'}** to ensure clearing TCS NQT cognitive thresholds.
- **Interview Whiteboarding**: Practice speaking through edge cases (empty arrays, duplicate elements) out loud before writing line 1.
- **Company Alignment**: You are in a prime position for **TCS Digital (7 LPA)** and **Accenture Advanced App Engineering (6.5 LPA)**. Aim for 100% test case pass rate in Day 37 & Day 40 simulations.`,
      generatedByAI: false,
    };
  }
}

export async function fetchAiReadinessPrediction(student: any, _overallScore: number): Promise<AiPredictionResponse> {
  const res = await fetch('/api/ai/predict-readiness', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: student?.id }),
  });
  await throwForAiResponseError(res);
  return await res.json();
}

export async function predictCompanyReadiness(params: {
  studentId: string;
  studentName: string;
  targetCompany: string;
  scores: Record<string, number>;
}): Promise<{ eventId: string; modelVersion: string; readinessIndex: number; readinessTier: 'high' | 'moderate' | 'needs_attention'; predictedReady: boolean; advice: string; generatedByAI: false }> {
  const res = await fetch('/api/ai/predict-readiness', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: params.studentId, targetCompany: params.targetCompany }),
  });
  await throwForAiResponseError(res);
  const data = await res.json();
  return { ...data, advice: data.summary };
}

export async function recordReadinessOutcome(eventId: string, outcome: 'placed' | 'not_placed') {
  const res = await fetch(`/api/ai/predictions/${encodeURIComponent(eventId)}/outcome`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outcome }),
  });
  await throwForAiResponseError(res);
  return await res.json();
}

export async function fetchReadinessPredictionEvaluation() {
  const res = await fetch('/api/ai/prediction-evaluation');
  await throwForAiResponseError(res);
  return await res.json();
}

export async function fetchPendingReadinessPredictions() {
  const res = await fetch('/api/ai/predictions/pending');
  await throwForAiResponseError(res);
  return await res.json();
}

export async function fetchAiTrainerSummary(params: {
  batchId: string;
  batchName: string;
  atRiskCount: number;
  averageScore: number;
  lowScoringTopics: string[];
}): Promise<{ summary: string; generatedByAI: boolean }> {
  try {
    const res = await fetch('/api/ai/trainer-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    await throwForAiResponseError(res);
    return await res.json();
  } catch (err) {
    if (err instanceof PlanLimitReachedError) throw err;
    return {
      summary: `### 📋 Executive Intervention Strategy for ${params.batchName}
1. **Targeted Micro-Workshops**: 30 minutes daily before the coding slot dedicated strictly to **${params.lowScoringTopics.slice(0, 2).join(' & ')}**.
2. **Peer Mentorship Pairing**: Pair the ${params.atRiskCount} at-risk candidates with top-5 batch performers for collaborative dry-running of benchmark test problems.
3. **Speed Drill Retests**: Conduct an untimed 10-problem diagnostic for students scoring below 65% in recent coding challenges to solidify foundational confidence.`,
      generatedByAI: false,
    };
  }
}

export async function generateTrainerSummary(params: {
  batchId: string;
  batchName: string;
  studentsCount: number;
  averageScore: number;
  weakestTopics: string[];
}): Promise<{ summary: string; generatedByAI: boolean }> {
  return await fetchAiTrainerSummary({
    batchId: params.batchId,
    batchName: params.batchName,
    atRiskCount: Math.round(params.studentsCount * 0.08),
    averageScore: params.averageScore,
    lowScoringTopics: params.weakestTopics,
  });
}


export async function executeCodeOnServer(params: {
  code: string;
  language: string;
  input?: string;
  problemId?: string;
  assessmentId?: string;
  questionIndex?: number;
}): Promise<CodeRunResponse> {
  const res = await fetch('/api/code/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Code execution failed (HTTP ${res.status}).`);
  return data;
}

export async function fetchStudents(): Promise<any[]> {
  const res = await fetch('/api/students');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

export interface AnalyticsDashboardData {
  studentName: string;
  readinessScore: number;
  metrics: Record<string, number>;
  trend: Array<{ day: string; studentScore: number; codingScore: number | null; benchmark: number }>;
  topics: Array<{ topic: string; score: number; target: number }>;
  distribution: Array<{ name: string; value: number; color: string }>;
  batchStudentCount: number;
}

export async function fetchAnalyticsDashboard(studentId: string): Promise<AnalyticsDashboardData> {
  const query = new URLSearchParams({ studentId });
  const response = await fetch(`/api/analytics/dashboard?${query}`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Could not load analytics (HTTP ${response.status}).`);
  }
  return await response.json();
}

export async function fetchBatches(): Promise<any[]> {
  const res = await fetch('/api/batches');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

export async function fetchNotifications(): Promise<any[]> {
  const res = await fetch('/api/notifications');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

export async function fetchWorkspaceLeaderboard(): Promise<any[]> {
  const res = await fetch('/api/leaderboard');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

export const fetchWorkspaceAssessments = () => apiRequest<Assessment[]>('/api/assessments');
export const fetchCurriculumProgress = () => apiRequest<number[]>('/api/curriculum/progress');

export function updateCurriculumDayCompletion(dayNumber: number, completed: boolean) {
  return apiRequest<{ dayNumber: number; completed: boolean }>(`/api/curriculum/progress/${dayNumber}`, {
    method: 'PUT',
    body: JSON.stringify({ completed }),
  });
}

export const fetchCurriculumMaterials = (dayNumber = 1) => apiRequest<CurriculumMaterial[]>(`/api/curriculum/materials?dayNumber=${dayNumber}`);
export const fetchCurriculumLearningCheck = (dayNumber: number) => apiRequest<CurriculumLearningCheck>(`/api/curriculum/learning-check?dayNumber=${dayNumber}`);
export const submitCurriculumLearningCheck = (dayNumber: number, answers: Record<number, number>) => apiRequest<{ id: string; dayNumber: number; score: number; questionCount: number; passingScore: number; passed: boolean; completion: CurriculumLearningCheck['completion'] }>('/api/curriculum/learning-check/attempts', { method: 'POST', body: JSON.stringify({ dayNumber, answers }) });

export function createCurriculumMaterial(params: { dayNumber: number; title: string; materialType: CurriculumMaterialType; contentUrl?: string; contentText?: string; contentFormat?: CurriculumTextFormat; isRequired: boolean }) {
  return apiRequest<CurriculumMaterial>('/api/curriculum/materials', { method: 'POST', body: JSON.stringify(params) });
}

export function updateCurriculumMaterial(id: string, params: { title: string; materialType: CurriculumMaterialType; contentUrl?: string; contentText?: string; contentFormat?: CurriculumTextFormat; isRequired: boolean }) {
  return apiRequest<CurriculumMaterial>(`/api/curriculum/materials/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(params) });
}

export function deleteCurriculumMaterial(id: string) {
  return apiRequest<{ success: boolean }>(`/api/curriculum/materials/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function updateCurriculumMaterialProgress(id: string, status: 'in_progress' | 'completed') {
  return apiRequest<{ materialId: string; status: 'in_progress' | 'completed' }>(`/api/curriculum/materials/${encodeURIComponent(id)}/progress`, { method: 'PUT', body: JSON.stringify({ status }) });
}

export function createWorkspaceAssessment(params: { sourceAssessmentId: string; title: string; status: Assessment['status']; scheduledDate: string; dayNumber?: number; durationMinutes?: number; purpose?: string; batchId?: string | null; sections?: Assessment['sections']; maxAttempts?: number; passPercent?: number; availableAt?: string | null; dueAt?: string | null; allowLateSubmission?: boolean; resultReleasePolicy?: 'immediate' | 'after_due' | 'manual' }) {
  return apiRequest<Assessment>('/api/assessments', { method: 'POST', body: JSON.stringify(params) });
}

export function updateWorkspaceAssessment(id: string, params: Partial<Pick<Assessment, 'title' | 'dayNumber' | 'durationMinutes' | 'purpose' | 'status' | 'scheduledDate' | 'sections' | 'passPercent'>> & { batchId?: string | null; coverage?: string[]; maxAttempts?: number; availableAt?: string | null; dueAt?: string | null; allowLateSubmission?: boolean; resultReleasePolicy?: 'immediate' | 'after_due' | 'manual' }) {
  return apiRequest<Assessment>(`/api/assessments/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(params) });
}

export function archiveWorkspaceAssessment(id: string) {
  return apiRequest<{ success: boolean }>(`/api/assessments/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export const fetchAssessmentSubmissions = (id: string) => apiRequest<any[]>(`/api/assessments/${encodeURIComponent(id)}/submissions`);
export const fetchAssessmentVersions = (id: string) => apiRequest<any[]>(`/api/assessments/${encodeURIComponent(id)}/versions`);
export function reviewAssessmentSubmission(id: string, params: { score: number; feedback: string; releaseResults: boolean }) {
  return apiRequest<{ success: boolean; score: number; percentage: number; passed: boolean; resultReleased: boolean }>(
    `/api/assessments/submissions/${encodeURIComponent(id)}/review`,
    { method: 'PATCH', body: JSON.stringify(params) },
  );
}

export function submitWorkspaceAssessment(id: string, params: { requestId: string; assessmentVersion: number; answers: Record<number, number | string>; codingAnswers: Record<number, { code: string; language: string }>; timeSpentSeconds: number }) {
  return apiRequest<{ id: string; score: number; totalMarks: number; percentage: number; passed: boolean; timeSpentSeconds: number; attemptNumber: number; gradingStatus: 'auto_graded' | 'pending_review'; resultReleased: boolean }>(
    `/api/assessments/${encodeURIComponent(id)}/submissions`,
    { method: 'POST', body: JSON.stringify(params) },
  );
}

export const fetchMyAssessmentAttempts = () => apiRequest<any[]>('/api/assessments/submissions/mine');

export const fetchStudentInterviewHistory = (studentId: string) => apiRequest<any[]>(`/api/students/${encodeURIComponent(studentId)}/interviews`);

export function createWorkspaceBatch(params: { name: string; trainerUserId?: string; startDate: string; completionDate: string; currentDay?: number }) {
  return apiRequest<{ success: boolean; id: string }>('/api/batches', { method: 'POST', body: JSON.stringify(params) });
}

export function updateWorkspaceBatch(id: string, params: { name?: string; trainerUserId?: string | null; startDate?: string; completionDate?: string; currentDay?: number; isArchived?: boolean }) {
  return apiRequest<{ success: boolean }>(`/api/batches/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(params) });
}

export function updateWorkspaceStudent(studentId: string, params: { batchId: string | null }) {
  return apiRequest<{ success: boolean }>(`/api/workspace/students/${encodeURIComponent(studentId)}`, { method: 'PATCH', body: JSON.stringify(params) });
}

export async function updateStudentRemarks(studentId: string, params: { remark: any; score: number; type: 'tech' | 'hr'; ratings: Record<string, number>; recommendation: 'hire' | 'borderline' | 'remedial' }): Promise<any> {
  const res = await fetch(`/api/students/${studentId}/remarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}
import { Assessment, CurriculumLearningCheck, CurriculumMaterial, CurriculumMaterialType, CurriculumTextFormat } from '../types';
import { InterviewReportResult, PlacementOutcomeHistoryRow, PlacementOutcomeReport, ReportActivityType, WorkspaceActivityResult } from '../types/reports';

async function apiRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data as T;
}

export async function fetchWorkspaceActivityReport(params: {
  activityType: Exclude<ReportActivityType, 'placement_readiness'>;
  batchId: string;
  dateFrom: string;
  dateTo: string;
  tier: string;
  query: string;
}): Promise<WorkspaceActivityResult> {
  const search = new URLSearchParams({ ...params, batchId: params.batchId === 'all' ? '' : params.batchId });
  return await apiRequest<WorkspaceActivityResult>(`/api/reports/activity?${search.toString()}`);
}

export async function fetchInterviewAnalytics(params: {
  batchId: string;
  dateFrom: string;
  dateTo: string;
  interviewType: string;
  panelistId: string;
  lifecycle: string;
  followUp: string;
}): Promise<InterviewReportResult> {
  const search = new URLSearchParams({ ...params, batchId: params.batchId === 'all' ? '' : params.batchId, panelistId: params.panelistId === 'all' ? '' : params.panelistId });
  return apiRequest<InterviewReportResult>(`/api/reports/interviews?${search.toString()}`);
}

export async function fetchPlacementOutcomeReport(params: { batchId: string; outcome: string; dateFrom: string; dateTo: string }): Promise<PlacementOutcomeReport> {
  const search = new URLSearchParams({ ...params, batchId: params.batchId === 'all' ? '' : params.batchId });
  return apiRequest<PlacementOutcomeReport>(`/api/reports/placement-outcomes?${search.toString()}`);
}

export async function fetchPlacementOutcomeHistory(scheduleId: string): Promise<PlacementOutcomeHistoryRow[]> {
  return apiRequest<PlacementOutcomeHistoryRow[]>(`/api/interview-follow-ups/${encodeURIComponent(scheduleId)}/history`);
}

