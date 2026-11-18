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
import { AccountProfile } from './components/AccountProfile';
import { StudentInterviewResults } from './components/StudentInterviewResults';
import { SystemSettings } from './components/SystemSettings';
import { InterviewSchedules } from './components/InterviewSchedules';
import { PanelistInterviewPortal } from './components/PanelistInterviewPortal';
import { AdminReports } from './components/AdminReports';
import { SubscriptionUsage } from './components/SubscriptionUsage';
import { archiveWorkspaceAssessment, createWorkspaceAssessment, createWorkspaceBatch, fetchBatches, fetchCurriculumProgress, fetchNotifications, fetchStudents, fetchWorkspaceAssessments, updateStudentRemarks, updateWorkspaceAssessment, updateWorkspaceBatch, updateWorkspaceStudent } from './services/api';
import { getCurrentSession, getWorkspaceSettings, getWorkspaceTrainers, markWorkspaceNotificationRead, signOut } from './services/auth';
import { generateStudentReportPDF } from './utils/pdfGenerator';
import { BatchInfo, StudentProfile, UserRole } from './types';
import { AuthenticatedSession, DEFAULT_WORKSPACE_SETTINGS, WorkspaceSettings } from './types/auth';
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
  const [curriculumTargetDay, setCurriculumTargetDay] = useState<number | null>(null);
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [batches, setBatches] = useState<BatchInfo[]>([]);
  const [trainers, setTrainers] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [assessments, setAssessments] = useState<any[]>([]);
  const [assessmentsLoading, setAssessmentsLoading] = useState(true);
  const [assessmentsError, setAssessmentsError] = useState('');
  const [completedCurriculumDays, setCompletedCurriculumDays] = useState<number[]>([]);
  const [curriculumProgressLoading, setCurriculumProgressLoading] = useState(true);
  const [curriculumProgressError, setCurriculumProgressError] = useState('');
  const [notifications, setNotifications] = useState<any[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<StudentProfile>(EMPTY_STUDENT);
  const [directoryFilters, setDirectoryFilters] = useState({ batchId: 'all', tierFilter: 'all' });
  const [workspaceSettings, setWorkspaceSettings] = useState<WorkspaceSettings>(DEFAULT_WORKSPACE_SETTINGS);
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  const [activeAssessmentId, setActiveAssessmentId] = useState<string | null>(null);
  const [showAiModal, setShowAiModal] = useState<boolean>(false);
  const [showNotifications, setShowNotifications] = useState<boolean>(false);

  const currentRole: UserRole = session?.role === 'college_admin' ? 'admin' : session?.role || 'student';

  useEffect(() => {
    if (session?.role === 'panelist' && activeTab === 'dashboard') setActiveTab('panelist_interviews');
  }, [session?.role, activeTab]);

  useEffect(() => {
    getCurrentSession()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    if (!session || session.role !== 'college_admin') {
      setWorkspaceSettings(DEFAULT_WORKSPACE_SETTINGS);
      return;
    }
    let active = true;
    getWorkspaceSettings()
      .then(({ settings }) => { if (active) setWorkspaceSettings(settings); })
      .catch((error) => console.error('Could not load workspace settings:', error));
    return () => { active = false; };
  }, [session?.workspace.id, session?.role]);

  // Load only the profiles permitted by the active workspace membership.
  useEffect(() => {
    if (!session) {
      setStudents([]);
      setBatches([]);
      setTrainers([]);
      setAssessments([]);
      setAssessmentsLoading(false);
      setAssessmentsError('');
      setCompletedCurriculumDays([]);
      setCurriculumProgressLoading(false);
      setCurriculumProgressError('');
      setNotifications([]);
      setSelectedStudent(EMPTY_STUDENT);
      return;
    }
    if (session.role === 'panelist') {
      setStudents([]); setBatches([]); setTrainers([]); setSelectedStudent(EMPTY_STUDENT);
      fetchNotifications().then((items) => setNotifications(Array.isArray(items) ? items : [])).catch(() => setNotifications([]));
      return;
    }
    Promise.all([fetchStudents(), fetchBatches(), fetchNotifications(), currentRole === 'admin' ? getWorkspaceTrainers() : Promise.resolve([])])
      .then(([data, batchData, notificationData, trainerData]) => {
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
        setTrainers(Array.isArray(trainerData) ? trainerData : []);
      })
      .catch((err) => {
        console.error('Failed to fetch workspace students:', err);
        if (err instanceof Error && err.message.includes('401')) setSession(null);
      });
  }, [session?.workspace.id, session?.user.id, refreshRevision, currentRole]);

  useEffect(() => {
    if (!session) return;
    if (session.role === 'panelist') { setAssessments([]); setAssessmentsLoading(false); setAssessmentsError(''); return; }
    let active = true;
    setAssessmentsLoading(true);
    setAssessmentsError('');
    fetchWorkspaceAssessments()
      .then((items) => {
        if (!active) return;
        setAssessments(Array.isArray(items) ? items : []);
      })
      .catch((error) => {
        if (!active) return;
        setAssessments([]);
        setAssessmentsError(error instanceof Error ? error.message : 'Could not load assessments.');
        if (error instanceof Error && error.message.includes('401')) setSession(null);
      })
      .finally(() => { if (active) setAssessmentsLoading(false); });
    return () => { active = false; };
  }, [session?.workspace.id, session?.user.id, refreshRevision]);

  useEffect(() => {
    if (!session || currentRole !== 'student') {
      setCompletedCurriculumDays([]);
      setCurriculumProgressLoading(false);
      setCurriculumProgressError('');
      return;
    }
    let active = true;
    setCurriculumProgressLoading(true);
    setCurriculumProgressError('');
    fetchCurriculumProgress()
      .then((progress) => {
        if (active) setCompletedCurriculumDays(Array.isArray(progress) ? progress : []);
      })
      .catch((error) => {
        if (!active) return;
        console.error('Failed to load saved curriculum progress:', error);
        setCurriculumProgressError(error instanceof Error ? error.message : 'Could not load saved course progress.');
        if (error instanceof Error && error.message.includes('401')) setSession(null);
      })
      .finally(() => {
        if (active) setCurriculumProgressLoading(false);
      });
    return () => { active = false; };
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

  const refreshCurriculumProgress = async () => {
    setCurriculumProgressLoading(true);
    setCurriculumProgressError('');
    try {
      const progress = await fetchCurriculumProgress();
      setCompletedCurriculumDays(Array.isArray(progress) ? progress : []);
    } catch (error) {
      setCurriculumProgressError(error instanceof Error ? error.message : 'Could not load saved course progress.');
      throw error;
    } finally {
      setCurriculumProgressLoading(false);
    }
  };

  const handleContinueCourse = (dayNumber: number) => {
    setCurriculumTargetDay(dayNumber);
    setActiveTab('curriculum');
  };

  const handleDashboardNavigate = (tab: string) => {
    if (tab === 'students' || tab === 'batches') setDirectoryFilters({ batchId: 'all', tierFilter: 'all' });
    setActiveTab(tab);
  };

  const handleOpenAtRiskStudents = () => {
    setDirectoryFilters({ batchId: 'all', tierFilter: 'at_risk' });
    setActiveTab('students');
  };

  const handleOpenBatchStudents = (batchId: string) => {
    setDirectoryFilters({ batchId, tierFilter: 'all' });
    setActiveTab('batches');
  };

  const handleDownloadStudentReport = async () => {
    if (currentRole !== 'student' || !session) {
      generateStudentReportPDF(selectedStudent);
      return;
    }

    const isAuthenticatedStudent = (profile: any) =>
      profile && (
        profile.userId === session.user.id
        || profile.id === session.user.id
        || (typeof profile.email === 'string' && profile.email.toLowerCase() === session.user.email.toLowerCase())
      );
    let ownProfile = students.find(isAuthenticatedStudent);
    if (!ownProfile && isAuthenticatedStudent(selectedStudent)) ownProfile = selectedStudent;
    try {
      const ownProfiles = await fetchStudents();
      ownProfile = ownProfiles.find(isAuthenticatedStudent)
        // The student API is scoped to the authenticated user, so a sole returned row is safe as a final identity match.
        || (ownProfiles.length === 1 ? ownProfiles[0] : ownProfile);
    } catch (error) {
      console.error('Could not refresh the authenticated student profile for the report:', error);
    }

    if (!ownProfile) {
      window.alert('Your student profile could not be loaded, so the report was not downloaded. Refresh the page and try again.');
      return;
    }

    const reportStudent: StudentProfile = {
      ...EMPTY_STUDENT,
      ...ownProfile,
      id: session.user.id,
      name: session.user.name.trim() || ownProfile.name || 'Student',
      email: session.user.email.trim() || ownProfile.email || '',
      metrics: { ...EMPTY_STUDENT.metrics, ...(ownProfile.metrics || {}) },
      eligibility: Array.isArray(ownProfile.eligibility) ? ownProfile.eligibility : [],
      weakAreas: Array.isArray(ownProfile.weakAreas) ? ownProfile.weakAreas : [],
      strengths: Array.isArray(ownProfile.strengths) ? ownProfile.strengths : [],
      recentRemarks: Array.isArray(ownProfile.recentRemarks) ? ownProfile.recentRemarks : [],
    };
    generateStudentReportPDF(reportStudent);
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
        setActiveTab(currentSession.role === 'panelist' ? 'panelist_interviews' : 'dashboard');
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

  const handleMarkNotificationRead = async (id: string) => {
    try {
      await markWorkspaceNotificationRead(id);
      setNotifications((current) => current.map((notification) => notification.id === id ? { ...notification, unread: false } : notification));
    } catch (error) {
      console.error('Could not mark notification as read:', error);
    }
  };

  const handleOpenPlacementNotification = (id: string) => {
    void handleMarkNotificationRead(id);
    setShowNotifications(false);
    setActiveTab('interviews');
    window.setTimeout(() => {
      window.dispatchEvent(new Event('placement-outcomes-refresh'));
      window.setTimeout(() => document.getElementById('student-placement-progress')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }, 150);
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

      case 'account_profile':
        return session ? <AccountProfile session={session} onSessionUpdated={setSession} /> : null;

      case 'dashboard':
        return (
          <DashboardLanding
            currentRole={currentRole}
            student={selectedStudent}
            students={students}
            batches={batches}
            displayName={session?.user.name || ''}
            assessments={assessments}
            settings={workspaceSettings}
            completedDayNumbers={completedCurriculumDays}
            curriculumProgressLoading={curriculumProgressLoading}
            curriculumProgressError={curriculumProgressError}
            onNavigate={handleDashboardNavigate}
            onContinueCourse={handleContinueCourse}
            onOpenAssessment={(id) => setActiveAssessmentId(id)}
            onDownloadReport={handleDownloadStudentReport}
            onOpenAiInsights={() => setShowAiModal(true)}
            onOpenStudent={(student) => { setSelectedStudent(student); setActiveTab('student_profile'); }}
            onOpenAtRiskStudents={handleOpenAtRiskStudents}
            onOpenBatch={handleOpenBatchStudents}
          />
        );

      case 'curriculum':
        return (
          <CurriculumTimeline
            onOpenAssessment={(id) => {
              const curriculumDayMatch = /^assess-day-(\d+)$/.exec(id);
              if (curriculumDayMatch) {
                const dayAssessment = assessments.find((assessment) => Number(assessment.dayNumber) === Number(curriculumDayMatch[1]));
                if (dayAssessment) setActiveAssessmentId(dayAssessment.id);
                else setActiveTab('assessments');
              } else setActiveAssessmentId(id);
            }}
            completedDayNumbers={completedCurriculumDays}
            canTrackProgress={currentRole === 'student'}
            onProgressRefresh={refreshCurriculumProgress}
            curriculumProgressLoading={curriculumProgressLoading}
            curriculumProgressError={curriculumProgressError}
            focusDayNumber={curriculumTargetDay}
            onFocusDayHandled={() => setCurriculumTargetDay(null)}
          />
        );

      case 'assessments':
        return (
          <AssessmentList
            assessments={assessments}
            assessmentsLoading={assessmentsLoading}
            assessmentsError={assessmentsError}
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
            onDownloadReport={handleDownloadStudentReport}
            onOpenAiInsights={() => setShowAiModal(true)}
          />
        );

      case 'interviews':
        return currentRole === 'student'
          ? <StudentInterviewResults studentId={session.user.id} />
          : <InterviewPanel students={students} initialType="tech" onUpdateStudentRemarks={handleUpdateRemarks} evaluatorName={session.user.name} />;

      case 'panelist_interviews':
        return <PanelistInterviewPortal />;

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
            initialBatchId={directoryFilters.batchId}
            initialTierFilter={directoryFilters.tierFilter}
            atRiskBelow={workspaceSettings.atRiskBelow}
            tierOneAtOrAbove={workspaceSettings.tierOneAtOrAbove}
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
        return currentRole === 'admin'
          ? <AdminReports students={students} batches={batches} selectedStudent={selectedStudent} atRiskBelow={workspaceSettings.atRiskBelow} tierOneAtOrAbove={workspaceSettings.tierOneAtOrAbove} />
          : null;

      case 'settings':
        return currentRole === 'admin'
          ? <SystemSettings settings={workspaceSettings} onSaved={setWorkspaceSettings} />
          : null;

      case 'subscription':
        return currentRole === 'admin' ? <SubscriptionUsage /> : null;

      case 'interviews_sched':
        return currentRole === 'admin'
          ? <InterviewSchedules students={students} defaultDurationMinutes={workspaceSettings.defaultInterviewDurationMinutes} />
          : null;

      default:
        return (
          <DashboardLanding
            currentRole={currentRole}
            student={selectedStudent}
            students={students}
            batches={batches}
            displayName={session?.user.name || ''}
            assessments={assessments}
            settings={workspaceSettings}
            completedDayNumbers={completedCurriculumDays}
            curriculumProgressLoading={curriculumProgressLoading}
            curriculumProgressError={curriculumProgressError}
            onNavigate={handleDashboardNavigate}
            onContinueCourse={handleContinueCourse}
            onOpenAssessment={(id) => setActiveAssessmentId(id)}
            onDownloadReport={handleDownloadStudentReport}
            onOpenAiInsights={() => setShowAiModal(true)}
            onOpenStudent={(student) => { setSelectedStudent(student); setActiveTab('student_profile'); }}
            onOpenAtRiskStudents={handleOpenAtRiskStudents}
            onOpenBatch={handleOpenBatchStudents}
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
        onOpenAccountProfile={() => setActiveTab('account_profile')}
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
                    {currentRole === 'student' && n.notificationType === 'placement_outcome' && (
                      <button onClick={() => handleOpenPlacementNotification(n.id)} className="pt-1 text-[10px] font-bold text-emerald-700 hover:text-emerald-900 dark:text-emerald-400">
                        View placement progress
                      </button>
                    )}
                    {n.notificationType === 'interview_schedule' && n.unread && (
                      <button onClick={() => void handleMarkNotificationRead(n.id)} className="pt-1 text-[10px] font-bold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400">
                        Mark as read
                      </button>
                    )}
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
