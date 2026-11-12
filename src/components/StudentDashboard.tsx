import React from 'react';
import { ArrowRight, Award, BookOpen, CheckCircle2, Clock3, FileCheck2, MessageSquareText, Target } from 'lucide-react';
import { CURRICULUM_40_DAYS } from '../data/curriculumData';
import { Assessment, StudentProfile } from '../types';

interface Props {
  student: StudentProfile;
  assessments: Assessment[];
  completedDayNumbers: number[];
  onNavigate: (tab: string) => void;
  onOpenAssessment: (assessmentId: string) => void;
  onDownloadReport: () => void;
}

const percent = (value: number) => Math.max(0, Math.min(100, Number(value) || 0));
const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

export const StudentDashboard: React.FC<Props> = ({ student, assessments, completedDayNumbers, onNavigate, onOpenAssessment, onDownloadReport }) => {
  const completed = new Set(completedDayNumbers);
  const completedCount = completed.size;
  const nextDay = CURRICULUM_40_DAYS.find((day) => !completed.has(day.dayNumber));
  const submitted = assessments.filter((item) => item.studentStatus === 'submitted');
  const pending = assessments.filter((item) => item.status !== 'completed' && item.studentStatus !== 'submitted')
    .sort((a, b) => a.dayNumber - b.dayNumber).slice(0, 4);
  const metrics = [
    { label: 'Placement readiness', value: percent(student.placementReadinessScore), detail: 'Based on your current profile', icon: Target, color: 'text-indigo-600 bg-indigo-50' },
    { label: 'Course progress', value: Math.round(completedCount / 40 * 100), detail: `${completedCount} of 40 days completed`, icon: BookOpen, color: 'text-blue-600 bg-blue-50' },
    { label: 'Assessments submitted', value: submitted.length, detail: `${assessments.length} available to you`, icon: FileCheck2, color: 'text-emerald-600 bg-emerald-50', plain: true },
    { label: 'Coding score', value: percent(student.metrics.coding), detail: 'Your latest recorded score', icon: Award, color: 'text-violet-600 bg-violet-50' },
  ];

  return <div className="space-y-6 animate-fadeIn">
    <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900">
      <div><p className="text-sm font-medium text-indigo-600">Your placement preparation</p><h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">Welcome back, {student.name.split(' ')[0]}</h1><p className="mt-1 text-sm text-slate-500">See your progress, next steps, and personal assessment status.</p></div>
      <button onClick={onDownloadReport} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200">Download my report</button>
    </section>

    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map(({ label, value, detail, icon: Icon, color, plain }) => <article key={label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between"><span className="text-sm font-medium text-slate-500">{label}</span><span className={`rounded-lg p-2 ${color}`}><Icon size={18} /></span></div>
        <div className="mt-3 flex items-baseline gap-1"><strong className="text-3xl text-slate-900 dark:text-white">{value}</strong>{!plain && <span className="text-lg text-slate-500">%</span>}</div>
        <p className="mt-1 text-xs text-slate-500">{detail}</p>
        {!plain && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-indigo-600" style={{ width: `${value}%` }} /></div>}
      </article>)}
    </section>

    <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold text-indigo-600">YOUR NEXT STEP</p><h2 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{nextDay ? `Day ${nextDay.dayNumber}: ${nextDay.topic}` : '40-day course complete'}</h2><p className="mt-2 text-sm text-slate-500">{nextDay ? `${nextDay.phaseName} · ${nextDay.expectedOutcome}` : 'You have completed every day in the course roadmap.'}</p></div><span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">{completedCount}/40 days</span></div>
        <div className="mt-5 h-2 rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-indigo-600" style={{ width: `${Math.round(completedCount / 40 * 100)}%` }} /></div>
        <button onClick={() => onNavigate('curriculum')} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">{nextDay ? 'Continue course' : 'Review course'} <ArrowRight size={16} /></button>
      </article>
      <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><h2 className="font-bold text-slate-900 dark:text-white">Your skill scores</h2><p className="mt-1 text-xs text-slate-500">Personal scores currently recorded</p><div className="mt-4 space-y-3">{[['Coding', student.metrics.coding], ['Aptitude', student.metrics.aptitude], ['Reasoning', student.metrics.reasoning], ['Communication', student.metrics.communication]].map(([name, score]) => <div key={String(name)}><div className="mb-1 flex justify-between text-sm"><span className="text-slate-600 dark:text-slate-300">{name}</span><b className="text-slate-900 dark:text-white">{percent(Number(score))}%</b></div><div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${percent(Number(score))}%` }} /></div></div>)}</div></article>
    </section>

    <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm xl:col-span-2 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800"><div><h2 className="font-bold text-slate-900 dark:text-white">Assessments for you</h2><p className="mt-1 text-xs text-slate-500">Status and attempts are based on your submissions.</p></div><button onClick={() => onNavigate('assessments')} className="text-sm font-semibold text-indigo-600">All assessments <ArrowRight size={15} className="ml-1 inline" /></button></div>
        {pending.length ? <div className="divide-y divide-slate-100 dark:divide-slate-800">{pending.map((item) => <div key={item.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-semibold text-slate-800 dark:text-slate-100">{item.title}</h3><p className="mt-1 flex items-center gap-2 text-xs text-slate-500"><Clock3 size={14} /> Day {item.dayNumber} · {item.durationMinutes} min · {item.studentAttemptCount || 0} attempts{item.studentLatestPercentage != null ? ` · Latest score ${Math.round(item.studentLatestPercentage)}%` : ''}</p></div><div className="flex items-center gap-3">{item.studentStatus === 'submitted' ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"><CheckCircle2 size={14} /> Submitted</span> : <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">Not started</span>}{item.status === 'live' && <button onClick={() => onOpenAssessment(item.id)} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white">{item.studentStatus === 'submitted' ? 'Retake' : 'Start'}</button>}</div></div>)}</div> : <div className="p-6 text-sm text-slate-500">You’re all caught up. Check the assessments page for upcoming tests.</div>}
      </article>
      <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center gap-2"><MessageSquareText size={18} className="text-indigo-600"/><h2 className="font-bold text-slate-900 dark:text-white">Trainer feedback</h2></div>{student.recentRemarks?.[0] ? <><p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">“{student.recentRemarks[0].comment}”</p><p className="mt-3 text-xs text-slate-500">{student.recentRemarks[0].trainerName} · {dateLabel(student.recentRemarks[0].date)}</p></> : <p className="mt-4 text-sm text-slate-500">No trainer feedback yet. Your latest comments will appear here.</p>}<button onClick={() => onNavigate('profile')} className="mt-5 text-sm font-semibold text-indigo-600">View my profile <ArrowRight size={15} className="ml-1 inline" /></button></article>
    </section>
  </div>;
};
