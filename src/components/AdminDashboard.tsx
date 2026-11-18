import React from 'react';
import { AlertTriangle, ArrowRight, Building2, CheckCircle2, ChevronRight, Code2, FileCheck2, Layers, Users } from 'lucide-react';
import { Assessment, BatchInfo, StudentProfile, UserRole } from '../types';
import { WorkspaceSettings } from '../types/auth';

interface AdminDashboardProps {
  currentRole: UserRole;
  students: StudentProfile[];
  batches: BatchInfo[];
  assessments: Assessment[];
  settings: WorkspaceSettings;
  onNavigate: (tab: string) => void;
  onOpenAssessment: (assessmentId: string) => void;
  onOpenStudent: (student: StudentProfile) => void;
  onOpenAtRisk: () => void;
  onOpenBatch: (batchId: string) => void;
}

const clampPercent = (value: number) => Math.max(0, Math.min(100, Number(value) || 0));
const average = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
const numberLabel = (value: number | null) => value === null ? '—' : `${value}%`;

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ currentRole, students, batches, assessments, settings, onNavigate, onOpenAssessment, onOpenStudent, onOpenAtRisk, onOpenBatch }) => {
  const averageReadiness = average(students.map((student) => clampPercent(student.placementReadinessScore)));
  const averageCoding = average(students.map((student) => clampPercent(student.metrics.coding)));
  const atRiskStudents = students.filter((student) => Number(student.placementReadinessScore) < settings.atRiskBelow)
    .sort((a, b) => a.placementReadinessScore - b.placementReadinessScore);
  const activeAssessments = assessments.filter((assessment) => assessment.status !== 'completed')
    .sort((a, b) => a.dayNumber - b.dayNumber);
  const averageProgress = average(students.map((student) => clampPercent(student.overallProgressPercent)));
  const studentsWithDay = students.filter((student) => Number(student.currentDay) > 0);
  const averageDay = average(studentsWithDay.map((student) => Math.min(40, Number(student.currentDay)))) || 0;
  const atRiskPercent = students.length ? Math.round((atRiskStudents.length / students.length) * 100) : 0;
  const batchSummary = batches.map((batch) => {
    const members = students.filter((student) => student.batchId === batch.id);
    return {
      ...batch,
      studentCount: members.length,
      readiness: average(members.map((student) => clampPercent(student.placementReadinessScore))),
      atRiskCount: members.filter((student) => Number(student.placementReadinessScore) < settings.atRiskBelow).length,
    };
  }).sort((a, b) => b.studentCount - a.studentCount).slice(0, 5);

  const milestones = [
    { day: 1, title: 'Launch', subtitle: 'Diagnostic' },
    { day: 18, title: 'Tech mastery', subtitle: 'DSA & SQL' },
    { day: 26, title: 'Aptitude', subtitle: 'Quant & logic' },
    { day: 30, title: 'HR & GD', subtitle: 'Verbal STAR' },
    { day: 36, title: 'Full mock', subtitle: 'Tech blitz' },
    { day: 40, title: 'Simulation', subtitle: 'Final' },
  ];

  const cardClass = 'rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900';
  const openStudentDirectory = () => onNavigate('students');

  return (
    <div className="space-y-5 animate-fadeIn">
      <header className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center">
        <div><p className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">{currentRole === 'admin' ? 'College workspace' : 'Trainer workspace'}</p><h1 className="mt-1 text-2xl font-extrabold text-slate-900 dark:text-white">{currentRole === 'admin' ? 'Executive Dashboard' : 'Trainer Dashboard'}</h1><p className="mt-1 text-sm text-slate-500">A live overview of students, batches, readiness, and assessments.</p></div>
        <div className="flex gap-2"><button onClick={openStudentDirectory} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Student directory</button><button onClick={() => onNavigate('batches')} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-700">Manage batches</button></div>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <button onClick={openStudentDirectory} className={`${cardClass} text-left transition hover:border-indigo-300`}><div className="flex items-center justify-between"><span className="text-[11px] font-semibold uppercase text-slate-500">Students in workspace</span><Users className="h-4 w-4 text-indigo-600" /></div><div className="mt-2 text-3xl font-extrabold text-slate-900 dark:text-white">{students.length}</div><p className="mt-1 text-xs text-slate-500">Across {batches.length} active {batches.length === 1 ? 'batch' : 'batches'} · {students.filter((student) => !student.batchId).length} unassigned</p></button>
        <button onClick={openStudentDirectory} className={`${cardClass} text-left transition hover:border-indigo-300`}><div className="flex items-center justify-between"><span className="text-[11px] font-semibold uppercase text-slate-500">Average readiness</span><CheckCircle2 className="h-4 w-4 text-indigo-600" /></div><div className="mt-2 text-3xl font-extrabold text-slate-900 dark:text-white">{numberLabel(averageReadiness)}</div><p className="mt-1 text-xs text-slate-500">Mean placement readiness across {students.length} students</p></button>
        <button onClick={openStudentDirectory} className={`${cardClass} text-left transition hover:border-indigo-300`}><div className="flex items-center justify-between"><span className="text-[11px] font-semibold uppercase text-slate-500">Average coding score</span><Code2 className="h-4 w-4 text-blue-600" /></div><div className="mt-2 text-3xl font-extrabold text-slate-900 dark:text-white">{numberLabel(averageCoding)}</div><p className="mt-1 text-xs text-slate-500">Mean coding score across workspace students</p></button>
        <button onClick={onOpenAtRisk} className={`${cardClass} border-l-4 border-l-amber-500 text-left transition hover:border-amber-400`}><div className="flex items-center justify-between"><span className="text-[11px] font-semibold uppercase text-slate-500">At-risk students</span><AlertTriangle className="h-4 w-4 text-amber-600" /></div><div className="mt-2 flex items-baseline gap-2"><span className="text-3xl font-extrabold text-slate-900 dark:text-white">{atRiskStudents.length}</span><span className="text-xs text-slate-500">{atRiskPercent}% of students</span></div><p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">Readiness below {settings.atRiskBelow}% · Open student list →</p></button>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><div className="flex items-center gap-2"><h2 className="font-bold text-slate-900 dark:text-white">40-day roadmap progress</h2><span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">Workspace average</span></div><p className="mt-1 text-xs text-slate-500">Based on student progress saved in the workspace profiles.</p></div><button onClick={() => onNavigate('curriculum')} className="flex items-center gap-1 text-xs font-bold text-indigo-600 hover:underline">Open curriculum <ChevronRight className="h-3.5 w-3.5" /></button></div>
        {averageProgress === null ? <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-800/60">No student progress data is available yet.</p> : <><div className="flex items-center justify-between text-xs"><span className="font-semibold text-slate-700 dark:text-slate-300">Average completion: {averageProgress}%</span><span className="text-slate-500">Average day: {averageDay || '—'} of 40</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${averageProgress}%` }} /></div><div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-6">{milestones.map((milestone) => { const reached = averageDay >= milestone.day; return <button key={milestone.day} onClick={() => onNavigate('curriculum')} className="group text-center"><span className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full border-2 text-[9px] font-extrabold ${reached ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-900'}`}>{milestone.day}</span><span className={`mt-1 block text-[10px] font-bold ${reached ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400'}`}>{milestone.title}</span><span className="block text-[9px] text-slate-400">{milestone.subtitle}</span></button>; })}</div></>}
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs xl:col-span-2 dark:border-slate-800 dark:bg-slate-900">
          <header className="flex items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800"><div><h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white"><FileCheck2 className="h-4 w-4 text-indigo-600" />Live and upcoming assessments</h2><p className="mt-1 text-[11px] text-slate-500">{activeAssessments.length} active or upcoming in this workspace</p></div><button onClick={() => onNavigate('assessments')} className="text-xs font-semibold text-indigo-600 hover:underline">Assessment engine <ArrowRight className="ml-1 inline h-3.5 w-3.5" /></button></header>
          {activeAssessments.length === 0 ? <p className="p-6 text-sm text-slate-500">No live or upcoming assessments are configured.</p> : <div className="divide-y divide-slate-100 dark:divide-slate-800">{activeAssessments.slice(0, 5).map((assessment) => <div key={assessment.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">Day {assessment.dayNumber}</span><span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${assessment.status === 'live' ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'}`}>{assessment.status}</span><span className="text-[10px] text-slate-400">{assessment.scheduledDate}</span></div><h3 className="mt-1 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{assessment.title}</h3></div><button onClick={() => onOpenAssessment(assessment.id)} className="shrink-0 rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 dark:bg-slate-800 dark:text-slate-200">Preview assessment</button></div>)}</div>}
        </article>

        <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <header className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800"><div><h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white"><Layers className="h-4 w-4 text-indigo-600" />Batch snapshot</h2><p className="mt-1 text-[11px] text-slate-500">Student count and readiness by batch</p></div><button onClick={() => onNavigate('batches')} aria-label="Open batches" className="text-indigo-600"><ArrowRight className="h-4 w-4" /></button></header>
          {batchSummary.length === 0 ? <p className="p-5 text-sm text-slate-500">No active batches in this workspace.</p> : <div className="divide-y divide-slate-100 dark:divide-slate-800">{batchSummary.map((batch) => <button key={batch.id} onClick={() => onOpenBatch(batch.id)} className="w-full p-4 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/50"><div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-bold text-slate-800 dark:text-slate-100">{batch.name}</span><span className="shrink-0 text-[10px] font-semibold text-slate-500">{batch.studentCount} students</span></div><div className="mt-2 flex items-center justify-between text-[10px]"><span className="text-slate-500">Avg readiness {numberLabel(batch.readiness)}</span><span className={batch.atRiskCount ? 'font-semibold text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}>{batch.atRiskCount} at risk</span></div></button>)}</div>}
        </article>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800"><div><h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white"><AlertTriangle className="h-4 w-4 text-amber-600" />Students needing attention</h2><p className="mt-1 text-[11px] text-slate-500">Lowest readiness scores first · threshold below {settings.atRiskBelow}%</p></div><button onClick={onOpenAtRisk} className="text-xs font-semibold text-indigo-600 hover:underline">View all {atRiskStudents.length} <ArrowRight className="ml-1 inline h-3.5 w-3.5" /></button></header>
        {atRiskStudents.length === 0 ? <p className="p-5 text-sm text-slate-500">No students currently fall below the readiness threshold.</p> : <div className="grid gap-px bg-slate-100 dark:bg-slate-800 sm:grid-cols-2 lg:grid-cols-3">{atRiskStudents.slice(0, 6).map((student) => <button key={student.id} onClick={() => onOpenStudent(student)} className="flex items-center justify-between gap-3 bg-white p-4 text-left hover:bg-amber-50/50 dark:bg-slate-900 dark:hover:bg-slate-800"><span className="min-w-0"><span className="block truncate text-xs font-bold text-slate-800 dark:text-slate-100">{student.name}</span><span className="mt-1 block truncate text-[10px] text-slate-500">{student.batch || 'Unassigned'} · {student.rollNo || 'No roll number'}</span></span><span className="shrink-0 rounded-lg bg-amber-50 px-2 py-1 text-xs font-extrabold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">{clampPercent(student.placementReadinessScore)}%</span></button>)}</div>}
      </section>
      <p className="flex items-center gap-2 text-[10px] text-slate-400"><Building2 className="h-3.5 w-3.5" />Metrics are calculated from the student and assessment records visible in this workspace.</p>
    </div>
  );
};
