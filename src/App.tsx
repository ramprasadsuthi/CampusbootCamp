import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { DashboardLanding } from './components/DashboardLanding';
import { CurriculumTimeline } from './components/CurriculumTimeline';
import { AssessmentList } from './components/AssessmentList';
import { AssessmentPlayer } from './components/AssessmentPlayer';
import { CodeEditor } from './components/CodeEditor';
import { StudentProfileView } from './components/StudentProfileView';
import { InterviewPanel } from './components/InterviewPanel';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { BatchManager } from './components/BatchManager';
import { LeaderboardView } from './components/LeaderboardView';
import { CertificateModal } from './components/CertificateModal';
import { AiInsightsModal } from './components/AiInsightsModal';
import { AuthScreen } from './components/AuthScreen';
import { WorkspaceMembers } from './components/WorkspaceMembers';
import { archiveWorkspaceAssessment, createWorkspaceAssessment, createWorkspaceBatch, fetchBatches, fetchNotifications, fetchStudents, fetchWorkspaceAssessments, updateStudentRemarks, updateWorkspaceAssessment, updateWorkspaceBatch, updateWorkspaceStudent } from './services/api';
import { getCurrentSession, getWorkspaceTrainers, signOut } from './services/auth';
import { generateStudentReportPDF, exportBatchCSV } from './utils/pdfGenerator';
import { BatchInfo, StudentProfile, UserRole } from './types';
import { AuthenticatedSession } from './types/auth';
import {
  Bell,
  CheckCircle2,
  Calendar,
  Sparkles,
  ArrowRight,
  FileCheck2,
  Users,
  Award,
} from 'lucide-react';

const EMPTY_STUDENT: StudentProfile = {
  id: '',
  name: 'No students enrolled yet',
  email: '',
  rollNo: '',
  phone: '',
  photo: '',
  college: '',
  department: '',
  branch: '',
  batch: '',
  trainer: '',
  attendancePercent: 0,
  currentDay: 0,
  overallProgressPercent: 0,
  placementReadinessScore: 0,
  metrics: { coding: 0, aptitude: 0, reasoning: 0, sql: 0, csFundamentals: 0, communication: 0, techInterview: 0, hrInterview: 0, overallReadiness: 0 },
  eligibility: [],
  weakAreas: [],
  strengths: [],
  recentRemarks: [],
};

export default function App() {
  const [session, setSession] = useState<AuthenticatedSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [batches, setBatches] = useState<BatchInfo[]>([]);
  const [trainers, setTrainers] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [assessments, setAssessments] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<StudentProfile>(EMPTY_STUDENT);
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  const [activeAssessmentId, setActiveAssessmentId] = useState<string | null>(null);
  const [showAiModal, setShowAiModal] = useState<boolean>(false);
  const [showNotifications, setShowNotifications] = useState<boolean>(false);

  const currentRole: UserRole = session?.role === 'college_admin' ? 'admin' : session?.role || 'student';

  useEffect(() => {
    getCurrentSession()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setAuthLoading(false));
  }, []);

  // Load only the profiles permitted by the active workspace membership.
  useEffect(() => {
    if (!session) {
      setStudents([]);
      setBatches([]);
      setTrainers([]);
      setAssessments([]);
      setNotifications([]);
      setSelectedStudent(EMPTY_STUDENT);
      return;
    }
    Promise.all([fetchStudents(), fetchBatches(), fetchNotifications(), fetchWorkspaceAssessments(), currentRole === 'admin' ? getWorkspaceTrainers() : Promise.resolve([])])
      .then(([data, batchData, notificationData, assessmentData, trainerData]) => {
        const profiles = Array.isArray(data) ? data : [];
        setStudents(profiles);
        setSelectedStudent((current) => profiles.find((student: StudentProfile) => student.id === current.id) || profiles[0] || EMPTY_STUDENT);
        const scopedBatches = Array.isArray(batchData) ? batchData : [];
        setBatches(scopedBatches.map((batch: any) => ({
          id: batch.id,
          name: batch.name,
          college: batch.college,
          department: '',
          trainer: batch.trainer,
          trainerUserId: batch.trainerUserId || null,
          totalStudents: Number(batch.totalStudents || 0),
          activeStudents: Number(batch.totalStudents || 0),
          avgAttendance: Number(batch.attendanceRate || 0),
          avgReadiness: Number(batch.averageScore || 0),
          tier1ReadyPercent: batch.totalStudents ? Math.round((Number(batch.readyCount || 0) / Number(batch.totalStudents)) * 100) : 0,
          tier2ReadyPercent: 0,
          atRiskPercent: batch.totalStudents ? Math.round((Number(batch.atRiskCount || 0) / Number(batch.totalStudents)) * 100) : 0,
          startDate: batch.startDate,
          endDate: batch.completionDate,
        })));
        setNotifications(Array.isArray(notificationData) ? notificationData : []);
        setAssessments(Array.isArray(assessmentData) ? assessmentData : []);
        setTrainers(Array.isArray(trainerData) ? trainerData : []);
      })
      .catch((err) => {
        console.error('Failed to fetch workspace students:', err);
        if (err instanceof Error && err.message.includes('401')) setSession(null);
      });
  }, [session?.workspace.id, session?.user.id, refreshRevision, currentRole]);

  const handleCreateBatch = async (params: { name: string; trainerUserId?: string; startDate: string; completionDate: string }) => {
    await createWorkspaceBatch(params);
    setRefreshRevision((value) => value + 1);
  };

  const handleUpdateBatch = async (id: string, params: { name?: string; trainerUserId?: string | null; startDate?: string; completionDate?: string; currentDay?: number; isArchived?: boolean }) => {
    await updateWorkspaceBatch(id, params);
    setRefreshRevision((value) => value + 1);
  };

  const handleAssignStudent = async (studentId: string, batchId: string | null) => {
    await updateWorkspaceStudent(studentId, { batchId });
    setRefreshRevision((value) => value + 1);
  };

  // Dark mode effect
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const handleAuthenticated = () => {
    setAuthLoading(true);
    getCurrentSession()
      .then((currentSession) => {
        setSession(currentSession);
        setActiveTab('dashboard');
      })
      .catch(() => setSession(null))
      .finally(() => setAuthLoading(false));
  };

  const handleSignOut = async () => {
    await signOut().catch(() => undefined);
    setSession(null);
    setActiveAssessmentId(null);
    setShowAiModal(false);
    setShowNotifications(false);
  };

  const handleCreateAssessment = async (params: Parameters<typeof createWorkspaceAssessment>[0]) => {
    const assessment = await createWorkspaceAssessment(params);
    setAssessments((current) => [...current, assessment].sort((a, b) => a.dayNumber - b.dayNumber));
  };

  const handleUpdateAssessment = async (id: string, params: Parameters<typeof updateWorkspaceAssessment>[1]) => {
    const assessment = await updateWorkspaceAssessment(id, params);
    setAssessments((current) => current.map((item) => item.id === id ? assessment : item));
  };

  const handleArchiveAssessment = async (id: string) => {
    await archiveWorkspaceAssessment(id);
    setAssessments((current) => current.filter((item) => item.id !== id));
  };

  // Handle remarks update from InterviewPanel calling MySQL Backend
  const handleUpdateRemarks = async (studentId: string, remark: any, newScore: number, evaluation: { ratings: Record<string, number>; recommendation: 'hire' | 'borderline' | 'remedial' }) => {
    try {
      const response = await updateStudentRemarks(studentId, { remark, score: newScore, type: remark.type, ...evaluation });
      
      setStudents((prev) =>
        prev.map((st) => {
          if (st.id === studentId) {
            const updatedRemarks = [remark, ...st.recentRemarks];
            const updatedMetrics = {
              ...st.metrics,
              [remark.type === 'tech' ? 'techInterview' : 'hrInterview']: newScore,
              overallReadiness: response.updatedReadiness
            };
            const newStudent = {
              ...st,
              placementReadinessScore: response.updatedReadiness,
              metrics: updatedMetrics,
              recentRemarks: updatedRemarks,
            };
            if (selectedStudent.id === studentId) {
              setSelectedStudent(newStudent);
            }
            return newStudent;
          }
          return st;
        })
      );
    } catch (error) {
      console.error('Failed to update student remarks on server:', error);
      throw error;
    }
  };

  // Render view based on active tab and role
  const renderContent = () => {
    switch (activeTab) {
      case 'workspace':
        return session ? <WorkspaceMembers session={session} /> : null;

      case 'dashboard':
        return (
          <DashboardLanding
            currentRole={currentRole}
            student={selectedStudent}
            onNavigate={(tab) => setActiveTab(tab)}
            onOpenAssessment={(id) => setActiveAssessmentId(id)}
            onDownloadReport={() => generateStudentReportPDF(selectedStudent)}
            onOpenAiInsights={() => setShowAiModal(true)}
          />
        );

      case 'curriculum':
        return (
          <CurriculumTimeline
            onOpenAssessment={(id) => setActiveAssessmentId(id)}
          />
        );

      case 'assessments':
        return (
          <AssessmentList
            assessments={assessments}
            batches={batches}
            canManage={currentRole !== 'student'}
            onOpenAssessment={(id) => setActiveAssessmentId(id)}
            onCreateAssessment={handleCreateAssessment}
            onUpdateAssessment={handleUpdateAssessment}
            onArchiveAssessment={handleArchiveAssessment}
          />
        );

      case 'code_sandbox':
        return <CodeEditor />;

      case 'student_profile':
        return (
          <StudentProfileView
            student={selectedStudent}
            onDownloadReport={() => generateStudentReportPDF(selectedStudent)}
            onOpenAiInsights={() => setShowAiModal(true)}
          />
        );

      case 'interviews':
      case 'eval_tech':
        return (
          <InterviewPanel
            students={students}
            initialType="tech"
            onUpdateStudentRemarks={handleUpdateRemarks}
            evaluatorName={session.user.name}
          />
        );

      case 'eval_hr':
        return (
          <InterviewPanel
            students={students}
            initialType="hr"
            onUpdateStudentRemarks={handleUpdateRemarks}
            evaluatorName={session.user.name}
          />
        );

      case 'analytics':
        return <AnalyticsDashboard student={selectedStudent} />;

      case 'batches':
      case 'students':
        return (
          <BatchManager
            students={students}
            batches={batches}
            trainers={trainers}
            canManage={currentRole === 'admin'}
            onCreateBatch={handleCreateBatch}
            onUpdateBatch={handleUpdateBatch}
            onAssignStudent={handleAssignStudent}
            onSelectStudent={(st) => setSelectedStudent(st)}
            onNavigateToProfile={() => setActiveTab('student_profile')}
          />
        );

      case 'leaderboard':
        return <LeaderboardView />;

      case 'certificate':
        return <CertificateModal student={selectedStudent} />;

      case 'reports':
        return (
          <div className="space-y-6 animate-fadeIn">
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-8 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
              <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">
                Export Placement Dossiers & Batch Reports
              </h1>
              <p className="text-xs text-slate-500 max-w-2xl">
                Download verified individual student dossiers with comprehensive competency scores, trainer endorsement remarks, and batch-wide placement statistics.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
                <div className="p-6 rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/60 space-y-3">
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Current Candidate Dossier (PDF)
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    Comprehensive verified dossier for <strong>{selectedStudent.name}</strong> ({selectedStudent.rollNo}) including 9-domain matrix and company eligibility.
                  </p>
                  <button
                    onClick={() => generateStudentReportPDF(selectedStudent)}
                    className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md cursor-pointer transition-all"
                  >
                    Generate Candidate PDF
                  </button>
                </div>

                <div className="p-6 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/60 space-y-3">
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Master Batch Export (CSV / Excel)
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    Full spreadsheet export containing all enrolled candidates across CS, IT, and ECE batches with attendance and assessment metrics.
                  </p>
                  <button
                    onClick={() => exportBatchCSV('Campus_Placement_Master_Report', students)}
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md cursor-pointer transition-all"
                  >
                    Export Master CSV
                  </button>
                </div>
              </div>
            </div>
          </div>
        );

      case 'settings':
      case 'interviews_sched':
        return (
          <div className="space-y-6 animate-fadeIn">
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-8 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-6">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">
                  Assessment Engine & System Configuration
                </h1>
                <p className="text-xs text-slate-500 mt-1">
                  Configure target company drive cutoffs, assessment timing constraints, and rubric weights.
                </p>
              </div>

              <div className="space-y-4 max-w-xl text-xs">
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      TCS NQT Tier 1 Cutoff
                    </span>
                    <span className="font-bold text-indigo-600">80%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      Infosys SP Coding Benchmark
                    </span>
                    <span className="font-bold text-indigo-600">85%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      Accenture FSE Aptitude Cutoff
                    </span>
                    <span className="font-bold text-indigo-600">75%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      default:
        return (
          <DashboardLanding
            currentRole={currentRole}
            student={selectedStudent}
            onNavigate={(tab) => setActiveTab(tab)}
            onOpenAssessment={(id) => setActiveAssessmentId(id)}
            onDownloadReport={() => generateStudentReportPDF(selectedStudent)}
            onOpenAiInsights={() => setShowAiModal(true)}
          />
        );
    }
  };

  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-sm font-medium text-slate-500">Loading your secure workspace…</div>;
  }

  if (!session) {
    return <AuthScreen onAuthenticated={handleAuthenticated} />;
  }

  // If in active assessment, render full-screen AssessmentPlayer
  if (activeAssessmentId) {
    const assessment = assessments.find((item) => item.id === activeAssessmentId);
    if (!assessment) return <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">Loading assessment…</div>;
    return (
      <AssessmentPlayer
        assessment={assessment}
        student={selectedStudent}
        onClose={() => setActiveAssessmentId(null)}
        onAssessmentCompleted={() => setRefreshRevision((value) => value + 1)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors">
      {/* Top Navbar */}
      <Navbar
        currentRole={currentRole}
        session={session}
        onSignOut={handleSignOut}
        students={students}
        selectedStudent={selectedStudent}
        onSelectStudent={(s) => setSelectedStudent(s)}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode(!darkMode)}
        onOpenAiInsights={() => setShowAiModal(true)}
        onOpenNotifications={() => setShowNotifications(!showNotifications)}
        unreadNotifsCount={notifications.filter((notification) => notification.unread).length}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
      />

      {/* Main Layout Container */}
      <div className="flex-1 flex max-w-7xl w-full mx-auto">
        {/* Left Sidebar */}
        <Sidebar
          currentRole={currentRole}
          activeTab={activeTab}
          onSelectTab={(tab) => setActiveTab(tab)}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        {/* Center Content View */}
        <main className="flex-1 p-3 sm:p-5 lg:p-6 min-w-0 overflow-y-auto">
          {renderContent()}
        </main>
      </div>

      {/* AI Placement Doctor Modal */}
      <AiInsightsModal
        student={selectedStudent}
        isOpen={showAiModal}
        onClose={() => setShowAiModal(false)}
      />

      {/* Notification Drawer Modal */}
      {showNotifications && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 h-full p-6 shadow-2xl border-l border-slate-200 dark:border-slate-800 flex flex-col justify-between animate-fadeIn">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <Bell className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                  <h3 className="font-bold text-slate-900 dark:text-white">
                    Campus Notifications
                  </h3>
                </div>
                <button
                  onClick={() => setShowNotifications(false)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                        {n.title}
                      </h4>
                      {n.unread && (
                        <span className="w-2 h-2 rounded-full bg-rose-500" />
                      )}
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                      {n.desc}
                    </p>
                    <span className="text-[10px] text-slate-400 block pt-1">
                      {n.time}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={() => setShowNotifications(false)}
              className="w-full py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 text-xs font-bold"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
