export type UserRole = 'admin' | 'trainer' | 'student';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar: string;
  phone?: string;
  rollNo?: string;
  college?: string;
  department?: string;
  branch?: string;
  batchId?: string;
  batchName?: string;
  trainerName?: string;
}

export type BootcampPhaseId = 'tech' | 'aptitude' | 'hr' | 'tech_revision' | 'simulation';

export interface BootcampPhase {
  id: BootcampPhaseId;
  name: string;
  daysRange: string;
  startDay: number;
  endDay: number;
  color: string;
  bgLight: string;
  borderColor: string;
  badgeClass: string;
  description: string;
}

export interface CurriculumDay {
  dayNumber: number;
  phaseId: BootcampPhaseId;
  phaseName: string;
  topic: string;
  subtopics: string[];
  activities: string[];
  practice: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  assessmentTitle: string;
  assessmentType: 'Diagnostic' | 'Practice Drill' | 'Benchmark Test' | 'Mock Test' | 'Interview' | 'None';
  expectedOutcome: string;
  completed?: boolean;
}

export type CurriculumMaterialType = 'video' | 'text' | 'pdf';
export type CurriculumTextFormat = 'markdown' | 'html';
export type CurriculumMaterialProgressStatus = 'not_started' | 'in_progress' | 'completed';

export interface CurriculumMaterial {
  id: string;
  dayNumber: number;
  title: string;
  materialType: CurriculumMaterialType;
  contentUrl: string | null;
  contentText: string | null;
  contentFormat: CurriculumTextFormat;
  position: number;
  isRequired: boolean;
  progressStatus: CurriculumMaterialProgressStatus;
  videoPositionSeconds?: number;
  completedAt?: string | null;
}

export interface CurriculumLearningCheck {
  dayNumber: number;
  title: string;
  passingScore: number;
  questions: Array<{ prompt: string; options: string[] }>;
  attemptCount: number;
  latestAttempt: { score: number; questionCount: number; passed: boolean; submittedAt: string } | null;
  completion: { completed: boolean; requiredCount: number; completedCount: number; checkPassed: boolean };
}

export interface TestCase {
  input: string;
  expected: string;
  hidden?: boolean;
}

export interface CodingProblem {
  id: string;
  title: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  category: string;
  description: string;
  constraints: string[];
  examples: {
    input: string;
    output: string;
    explanation?: string;
  }[];
  templates: {
    c: string;
    cpp: string;
    java: string;
    python: string;
    javascript: string;
  };
  testCases: TestCase[];
}

export interface MCQQuestion {
  id: string;
  section: string;
  text: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  marks: number;
}

export type QuestionItem = 
  | { type: 'mcq'; data: MCQQuestion }
  | { type: 'coding'; data: CodingProblem };

export interface AssessmentSection {
  id: string;
  name: string;
  questions: QuestionItem[];
}

export interface Assessment {
  id: string;
  dayNumber: number;
  title: string;
  type: 'diagnostic' | 'coding_benchmark' | 'aptitude' | 'reasoning' | 'communication' | 'technical' | 'sql' | 'interview' | 'placement_drive' | 'final';
  durationMinutes: number;
  totalMarks: number;
  coverage: string[];
  purpose: string;
  status: 'completed' | 'live' | 'upcoming';
  scheduledDate: string;
  sections: AssessmentSection[];
  targetCompanies: string[];
  batchId?: string | null;
  studentStatus?: 'not_started' | 'submitted';
  studentAttemptCount?: number;
  studentLastSubmittedAt?: string | null;
  studentLatestPercentage?: number | null;
}

export interface AssessmentSubmission {
  id: string;
  assessmentId: string;
  assessmentTitle: string;
  studentId: string;
  studentName: string;
  score: number;
  totalMarks: number;
  percentage: number;
  timeSpentSeconds: number;
  submittedAt: string;
  answers: Record<string, any>;
  codingResults?: Record<string, any>;
  passed: boolean;
}

export interface CircularMetrics {
  coding: number;
  aptitude: number;
  reasoning: number;
  sql: number;
  csFundamentals: number;
  communication: number;
  techInterview: number;
  hrInterview: number;
  overallReadiness: number;
}

export interface CompanyEligibility {
  company: 'TCS' | 'Infosys' | 'Accenture' | 'Cognizant' | 'Capgemini' | 'Wipro' | 'Other';
  roleName: string;
  tier: 'Prime/Specialist (7-12 LPA)' | 'Digital/Adv (6.5-9 LPA)' | 'Standard/Ninja (3.5-4.5 LPA)';
  minCutoff: number;
  currentProbability: number;
  status: 'Eligible' | 'Borderline' | 'Need Prep';
  logoColor: string;
}

export interface StudentProfile {
  id: string;
  name: string;
  email: string;
  rollNo: string;
  phone: string;
  photo: string;
  college: string;
  department: string;
  branch: string;
  batch: string;
  batchId?: string | null;
  trainer: string;
  attendancePercent: number;
  currentDay: number;
  overallProgressPercent: number;
  placementReadinessScore: number;
  metrics: CircularMetrics;
  eligibility: CompanyEligibility[];
  weakAreas: string[];
  strengths: string[];
  recentRemarks: {
    trainerName: string;
    date: string;
    comment: string;
    type: 'tech' | 'hr' | 'general';
  }[];
}

export interface TechnicalInterviewRecord {
  id: string;
  studentId: string;
  studentName: string;
  rollNo: string;
  batch: string;
  date: string;
  panel: string;
  status: 'Scheduled' | 'Completed';
  ratings: {
    coding: number;
    sql: number;
    oop: number;
    projects: number;
    communication: number;
    problemSolving: number;
  };
  remarks: string;
  recommendation: 'Hire' | 'Borderline' | 'Need Improvement';
}

export interface HRInterviewRecord {
  id: string;
  studentId: string;
  studentName: string;
  rollNo: string;
  batch: string;
  date: string;
  panel: string;
  status: 'Scheduled' | 'Completed';
  resumeReview: number;
  ratings: {
    confidence: number;
    communication: number;
    behavior: number;
    leadership: number;
    teamwork: number;
    adaptability: number;
  };
  comments: string;
  recommendation: 'Hire' | 'Borderline' | 'Need Improvement';
}

export interface BatchData {
  id: string;
  name: string;
  college: string;
  trainer: string;
  totalStudents: number;
  readyCount: number;
  atRiskCount: number;
  averageScore: number;
  currentDay: number;
  startDate: string;
  completionDate: string;
  attendanceRate: number;
}

export interface LeaderboardUser {
  rank: number;
  id: string;
  name: string;
  rollNo: string;
  college: string;
  batch: string;
  avatar: string;
  overallScore: number;
  codingScore: number;
  aptitudeScore: number;
  communicationScore: number;
  weeklyTrend: number; // positive = up, negative = down
  badges: string[];
}

export interface NotificationItem {
  id: string;
  type: 'upcoming_assessment' | 'interview_reminder' | 'assignment_due' | 'performance_alert' | 'congrats';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  action?: string;
}

export interface BatchInfo {
  id: string;
  name: string;
  college: string;
  department: string;
  trainer: string;
  trainerUserId?: string | null;
  totalStudents: number;
  activeStudents: number;
  avgAttendance: number;
  avgReadiness: number;
  tier1ReadyPercent: number;
  tier2ReadyPercent: number;
  atRiskPercent: number;
  startDate: string;
  endDate: string;
}

export interface LeaderboardEntry {
  studentId: string;
  studentName: string;
  rollNo: string;
  batch: string;
  avatar: string;
  score: number;
  codingScore: number;
  aptitudeScore: number;
  communicationScore: number;
  badges: string[];
}

