import React, { useEffect, useState } from 'react';
import { Bell, BriefcaseBusiness, CalendarClock, CheckCircle2, Clock3, ExternalLink, MapPin, MessageSquareText, ShieldCheck, Star, UserRound } from 'lucide-react';
import { fetchNotifications, fetchStudentInterviewHistory } from '../services/api';
import { getMyInterviewFollowUps, getMyInterviewSchedules } from '../services/auth';
import { StudentInterviewFollowUp, WorkspaceInterviewSchedule } from '../types/auth';

interface InterviewEvaluation {
  id: string;
  type: 'tech' | 'hr';
  date: string;
  panel: string;
  status: string;
  ratings: Record<string, number>;
  remarks: string;
  recommendation: string;
  score: number;
}

interface Props {
  studentId: string;
}

const rubricLabels: Record<string, string> = {
  coding: 'Algorithmic problem solving & DSA',
  sql: 'SQL queries & relational design',
  oop: 'OOP concepts & clean architecture',
  projects: 'Project knowledge',
  problemSolving: 'Logical and edge case thinking',
  communication: 'Communication',
  resumeReview: 'Resume and background',
  confidence: 'Confidence',
  behavioralStar: 'STAR response quality',
  leadership: 'Leadership and initiative',
  teamwork: 'Teamwork',
  adaptability: 'Adaptability',
};

const recommendationLabels: Record<string, string> = {
  hire: 'Strong hire',
  borderline: 'Borderline / qualified for next tier',
  remedial: 'Remedial practice recommended',
};

const followUpLabels: Record<StudentInterviewFollowUp['outcome'], string> = {
  needs_another_interview: 'Another interview needed',
  referred_for_placement: 'Referred for placement',
  offer_confirmed: 'Offer confirmed',
  no_further_action: 'No further action recorded',
};

function scoreColor(score: number) {
  if (score >= 80) return 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40';
  if (score >= 60) return 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40';
  return 'text-rose-700 bg-rose-50 dark:text-rose-300 dark:bg-rose-950/40';
}

export const StudentInterviewResults: React.FC<Props> = ({ studentId }) => {
  const [evaluations, setEvaluations] = useState<InterviewEvaluation[]>([]);
  const [upcomingSchedules, setUpcomingSchedules] = useState<WorkspaceInterviewSchedule[]>([]);
  const [placementUpdates, setPlacementUpdates] = useState<StudentInterviewFollowUp[]>([]);
  const [interviewNotifications, setInterviewNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    Promise.all([fetchStudentInterviewHistory(studentId), getMyInterviewSchedules(), getMyInterviewFollowUps(), fetchNotifications().catch(() => [])])
      .then(([items, nextSchedules, followUps, notifications]) => {
        if (!active) return;
        setEvaluations(Array.isArray(items) ? items : []);
        setUpcomingSchedules(Array.isArray(nextSchedules) ? nextSchedules : []);
        setPlacementUpdates(Array.isArray(followUps) ? followUps : []);
        setInterviewNotifications((Array.isArray(notifications) ? notifications : []).filter((item) => ['interview_schedule', 'interview_evaluation'].includes(item.notificationType)).slice(0, 6));
      })
      .catch((requestError) => { if (active) setError(requestError instanceof Error ? requestError.message : 'Could not load your interview results.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [studentId]);

  useEffect(() => {
    const refreshPlacement = () => {
      getMyInterviewFollowUps().then((items) => setPlacementUpdates(Array.isArray(items) ? items : [])).catch(() => undefined);
    };
    window.addEventListener('placement-outcomes-refresh', refreshPlacement);
    return () => window.removeEventListener('placement-outcomes-refresh', refreshPlacement);
  }, []);

  const latestTech = evaluations.find((evaluation) => evaluation.type === 'tech');
  const latestHr = evaluations.find((evaluation) => evaluation.type === 'hr');

  return (
    <div className="mx-auto max-w-5xl space-y-6 animate-fadeIn">
      <header className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center dark:border-slate-800 dark:bg-slate-900">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"><ShieldCheck className="h-3.5 w-3.5" />Your results · Read only</div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">Mock Interview Scores</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Review your scores and feedback, and see upcoming interview appointments and schedule updates.</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500"><CheckCircle2 className="h-4 w-4 text-emerald-600" />Only your saved evaluations are shown</div>
      </header>

      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30">Could not load your interview results: {error}</div>}
      {!loading && interviewNotifications.length > 0 && <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"><header className="border-b border-slate-100 p-5 dark:border-slate-800"><h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white"><Bell className="h-4 w-4 text-indigo-600" />Interview updates</h2><p className="mt-1 text-xs text-slate-500">Schedule changes and cancellations sent to your account.</p></header><div className="divide-y divide-slate-100 dark:divide-slate-800">{interviewNotifications.map((notification) => { const cancelled = /cancelled/i.test(notification.title || ''); return <article key={notification.id} className={`flex gap-3 p-4 ${cancelled ? 'bg-rose-50/70 dark:bg-rose-950/20' : ''}`}><span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${cancelled ? 'bg-rose-500' : notification.unread ? 'bg-indigo-500' : 'bg-slate-300'}`} /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className={`text-sm font-bold ${cancelled ? 'text-rose-800 dark:text-rose-300' : 'text-slate-800 dark:text-slate-100'}`}>{notification.title}</h3>{cancelled && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">Canceled</span>}{notification.unread && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">New</span>}</div><p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">{notification.desc}</p><p className="mt-1 text-[10px] text-slate-400">{notification.time}</p></div></article>; })}</div></section>}
      {!loading && placementUpdates.length > 0 && <section id="student-placement-progress" className="scroll-mt-20 overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm dark:border-emerald-900 dark:bg-slate-900"><header className="border-b border-emerald-100 p-5 dark:border-emerald-900/60"><h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white"><BriefcaseBusiness className="h-4 w-4 text-emerald-600" />Placement progress</h2><p className="mt-1 text-xs text-slate-500">Updates shared by your college after your mock interview.</p></header><div className="divide-y divide-slate-100 dark:divide-slate-800">{placementUpdates.map((update) => <article key={update.id} className="p-5"><div className="flex flex-wrap items-center justify-between gap-2"><span className={`rounded-full px-3 py-1 text-xs font-bold ${update.outcome === 'offer_confirmed' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300'}`}>{followUpLabels[update.outcome]}</span><span className="text-xs text-slate-500">{update.interviewType === 'tech' ? 'Technical' : 'HR & behavioral'} interview · {update.interviewDate}</span></div>{update.studentNotes && <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-200">{update.studentNotes}</p>}<p className="mt-2 text-[10px] text-slate-400">Updated {update.updatedAt}</p></article>)}</div></section>}
      {!loading && <section className="overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-sm dark:border-indigo-900 dark:bg-slate-900"><header className="border-b border-indigo-100 p-5 dark:border-indigo-900/60"><h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white"><CalendarClock className="h-4 w-4 text-indigo-600" />Upcoming interviews</h2><p className="mt-1 text-xs text-slate-500">Appointments scheduled by your college. Details are read-only; times are shown in your local timezone.</p></header>{upcomingSchedules.length === 0 ? <div className="p-6 text-sm text-slate-500">You have no upcoming interviews scheduled.</div> : <div className="divide-y divide-slate-100 dark:divide-slate-800">{upcomingSchedules.map((schedule) => { const date = new Date(`${schedule.scheduledAt.replace(' ', 'T')}Z`); const locationUrl = /^https?:\/\//i.test(schedule.location || '') ? schedule.location : ''; return <article key={schedule.id} className="p-5"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold uppercase text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">{schedule.interviewType === 'tech' ? 'Technical interview' : 'HR & behavioral interview'}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">Scheduled</span></div><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Date & time</p><p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100"><CalendarClock className="h-4 w-4 text-indigo-500" />{Number.isNaN(date.getTime()) ? schedule.scheduledAt : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p></div><div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Duration</p><p className="mt-1 flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200"><Clock3 className="h-4 w-4 text-slate-400" />{schedule.durationMinutes} minutes</p></div><div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Panelist</p><p className="mt-1 flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200"><UserRound className="h-4 w-4 text-slate-400" />{schedule.panelist}</p></div><div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Location / meeting link</p><p className="mt-1 flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200"><MapPin className="h-4 w-4 shrink-0 text-slate-400" />{locationUrl ? <a href={locationUrl} target="_blank" rel="noopener noreferrer" className="break-all font-semibold text-indigo-600 underline hover:text-indigo-800 dark:text-indigo-400">Join / open meeting <ExternalLink className="ml-1 inline h-3.5 w-3.5" /></a> : schedule.location || 'To be confirmed'}</p></div></div>{schedule.notes && <div className="mt-4 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Preparation notes</p><p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-slate-700 dark:text-slate-200">{schedule.notes}</p></div>}</article>; })}</div>}</section>}
      {loading ? <div role="status" className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">Loading your interview results…</div>
        : !error && evaluations.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900"><MessageSquareText className="mx-auto h-8 w-8 text-slate-300" /><h2 className="mt-3 font-bold text-slate-800 dark:text-white">No interview evaluations yet</h2><p className="mt-1 text-sm text-slate-500">Your trainer’s scores and feedback will appear here after an evaluation is saved.</p></div>
          : !loading && !error && <>
            <section className="grid gap-4 sm:grid-cols-2">
              {[{ title: 'Technical interview', item: latestTech }, { title: 'HR & behavioral interview', item: latestHr }].map(({ title, item }) => <article key={title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Latest {title.toLowerCase()}</p>{item ? <div className="mt-3 flex items-end justify-between gap-3"><div><strong className="text-3xl font-extrabold text-slate-900 dark:text-white">{Number(item.score) || 0}%</strong><p className="mt-1 text-xs text-slate-500">{item.date} · {item.panel || 'Interview panel'}</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${scoreColor(Number(item.score) || 0)}`}>{recommendationLabels[item.recommendation] || item.recommendation || 'Evaluated'}</span></div> : <p className="mt-3 text-sm text-slate-500">No evaluation recorded yet.</p>}</article>)}
            </section>

            <section className="space-y-4">
              <div><h2 className="text-lg font-bold text-slate-900 dark:text-white">Evaluation history</h2><p className="mt-1 text-xs text-slate-500">Scores and comments saved by your trainer or panelist.</p></div>
              {evaluations.map((evaluation) => {
                const score = Number(evaluation.score) || 0;
                const entries = Object.entries(evaluation.ratings || {});
                return <article key={evaluation.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <header className="flex flex-col justify-between gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center dark:border-slate-800">
                    <div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold uppercase text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">{evaluation.type === 'tech' ? 'Technical round' : 'HR & behavioral round'}</span><span className="flex items-center gap-1 text-xs text-slate-500"><Clock3 className="h-3.5 w-3.5" />{evaluation.date}</span></div><p className="mt-2 text-xs text-slate-500">Panelist: <span className="font-semibold text-slate-700 dark:text-slate-300">{evaluation.panel || 'Not specified'}</span></p></div>
                    <div className="flex items-center gap-3"><span className={`rounded-xl px-3 py-2 text-sm font-extrabold ${scoreColor(score)}`}>{score}%</span><span className="flex items-center gap-1 text-xs font-semibold capitalize text-slate-600 dark:text-slate-300"><Star className="h-3.5 w-3.5 text-amber-500" />{recommendationLabels[evaluation.recommendation] || evaluation.recommendation || evaluation.status || 'Evaluated'}</span></div>
                  </header>
                  <div className="space-y-5 p-5">
                    {entries.length > 0 && <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">{entries.map(([key, value]) => <div key={key}><div className="mb-1 flex justify-between gap-3 text-xs"><span className="text-slate-600 dark:text-slate-300">{rubricLabels[key] || key}</span><strong className="shrink-0 text-slate-900 dark:text-white">{value}/10</strong></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.max(0, Math.min(100, Number(value) * 10))}%` }} /></div></div>)}</div>}
                    {evaluation.remarks && <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60"><p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500"><MessageSquareText className="h-3.5 w-3.5" />Trainer feedback & next steps</p><p className="whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-200">{evaluation.remarks}</p></div>}
                  </div>
                </article>;
              })}
            </section>
          </>}
    </div>
  );
};
