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
import { SAMPLE_STUDENTS } from './data/mockData';
import { generateStudentReportPDF, exportBatchCSV } from './utils/pdfGenerator';
import { StudentProfile, UserRole } from './types';
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

export default function App() {
  const [currentRole, setCurrentRole] = useState<UserRole>('student');
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [students, setStudents] = useState<StudentProfile[]>(SAMPLE_STUDENTS);
  const [selectedStudent, setSelectedStudent] = useState<StudentProfile>(SAMPLE_STUDENTS[0]);
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  const [activeAssessmentId, setActiveAssessmentId] = useState<string | null>(null);
  const [showAiModal, setShowAiModal] = useState<boolean>(false);
  const [showNotifications, setShowNotifications] = useState<boolean>(false);

  const notifications = [
    {
      id: 'n1',
      title: 'Day 40 Final Placement Simulation Live',
      time: '10 minutes ago',
      desc: '3-Hour capstone test is now active for all batches.',
      unread: true,
    },
    {
      id: 'n2',
      title: 'TCS NQT Drive Benchmark Updated',
      time: '1 hour ago',
      desc: 'Your coding score (92%) qualifies for TCS Digital shortlist.',
      unread: true,
    },
    {
      id: 'n3',
      title: 'Technical Mock Interview Scheduled',
      time: 'Yesterday',
      desc: 'Panel session completed with Prof. Rajesh Sharma. Score: 88%.',
      unread: false,
    },
  ];

  // Dark mode effect
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // Handle role switch defaults
  const handleSelectRole = (role: UserRole) => {
    setCurrentRole(role);
    setActiveTab('dashboard');
  };

  // Handle remarks update from InterviewPanel
  const handleUpdateRemarks = (studentId: string, remark: any, newScore: number) => {
    setStudents((prev) =>
      prev.map((st) => {
        if (st.id === studentId) {
          const updatedRemarks = [remark, ...st.recentRemarks];
          const updatedMetrics = {
            ...st.metrics,
            [remark.type === 'tech' ? 'techInterview' : 'hrInterview']: newScore,
          };
          const newStudent = {
            ...st,
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
  };

  // Render view based on active tab and role
  const renderContent = () => {
    switch (activeTab) {
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
            onOpenAssessment={(id) => setActiveAssessmentId(id)}
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
          />
        );

      case 'eval_hr':
        return (
          <InterviewPanel
            students={students}
            initialType="hr"
            onUpdateStudentRemarks={handleUpdateRemarks}
          />
        );

      case 'analytics':
        return <AnalyticsDashboard student={selectedStudent} />;

      case 'batches':
      case 'students':
        return (
          <BatchManager
            students={students}
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

  // If in active assessment, render full-screen AssessmentPlayer
  if (activeAssessmentId) {
    return (
      <AssessmentPlayer
        assessmentId={activeAssessmentId}
        student={selectedStudent}
        onClose={() => setActiveAssessmentId(null)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors">
      {/* Top Navbar */}
      <Navbar
        currentRole={currentRole}
        onSelectRole={handleSelectRole}
        students={students}
        selectedStudent={selectedStudent}
        onSelectStudent={(s) => setSelectedStudent(s)}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode(!darkMode)}
        onOpenAiInsights={() => setShowAiModal(true)}
        onOpenNotifications={() => setShowNotifications(!showNotifications)}
        unreadNotifsCount={2}
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
