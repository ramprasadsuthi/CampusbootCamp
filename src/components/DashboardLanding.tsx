import React from 'react';
import { AdminDashboard } from './AdminDashboard';
import { StudentDashboard } from './StudentDashboard';
import { Assessment, BatchInfo, StudentProfile, UserRole } from '../types';
import { WorkspaceSettings } from '../types/auth';

interface DashboardLandingProps {
  currentRole: UserRole;
  student: StudentProfile;
  students: StudentProfile[];
  batches: BatchInfo[];
  displayName: string;
  onNavigate: (tab: string) => void;
  onContinueCourse: (dayNumber: number) => void;
  onOpenAssessment: (assessmentId: string) => void;
  onDownloadReport: () => void;
  onOpenAiInsights: () => void;
  onOpenStudent: (student: StudentProfile) => void;
  onOpenAtRiskStudents: () => void;
  onOpenBatch: (batchId: string) => void;
  assessments: Assessment[];
  settings: WorkspaceSettings;
  completedDayNumbers: number[];
  curriculumProgressLoading: boolean;
  curriculumProgressError: string;
}

export const DashboardLanding: React.FC<DashboardLandingProps> = ({
  currentRole,
  student,
  students,
  batches,
  displayName,
  onNavigate,
  onContinueCourse,
  onOpenAssessment,
  onDownloadReport,
  onOpenAiInsights,
  onOpenStudent,
  onOpenAtRiskStudents,
  onOpenBatch,
  assessments,
  settings,
  completedDayNumbers,
  curriculumProgressLoading,
  curriculumProgressError,
}) => {
  if (currentRole === 'student') {
    return <StudentDashboard
      student={student}
      displayName={displayName}
      assessments={assessments}
      completedDayNumbers={completedDayNumbers}
      curriculumProgressLoading={curriculumProgressLoading}
      curriculumProgressError={curriculumProgressError}
      onNavigate={onNavigate}
      onContinueCourse={onContinueCourse}
      onOpenAssessment={onOpenAssessment}
      onDownloadReport={onDownloadReport}
    />;
  }

  return <AdminDashboard
    currentRole={currentRole}
    students={students}
    batches={batches}
    assessments={assessments}
    settings={settings}
    onNavigate={onNavigate}
    onOpenAssessment={onOpenAssessment}
    onOpenStudent={onOpenStudent}
    onOpenAtRisk={onOpenAtRiskStudents}
    onOpenBatch={onOpenBatch}
  />;
};
