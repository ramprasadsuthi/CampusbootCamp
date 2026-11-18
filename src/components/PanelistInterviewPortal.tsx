import React, { useEffect, useMemo, useState } from 'react';
import { Bell, CalendarClock, CheckCircle2, Clock3, ExternalLink, LoaderCircle, MapPin, MessageSquareText, Star, UserRound } from 'lucide-react';
import { AssignedPanelistInterview, getAssignedPanelistInterviews, submitPanelistInterviewEvaluation } from '../services/auth';
import { fetchNotifications } from '../services/api';

const RUBRICS: Record<'tech' | 'hr', Array<{ key: string; label: string }>> = {
  tech: [
    { key: 'coding', label: 'Coding & data structures' }, { key: 'sql', label: 'SQL & data modeling' },
    { key: 'oop', label: 'OOP & code quality' }, { key: 'projects', label: 'Project knowledge' },
    { key: 'problemSolving', label: 'Problem solving' }, { key: 'communication', label: 'Communication' },
  ],
  hr: [
    { key: 'resumeReview', label: 'Resume & background' }, { key: 'confidence', label: 'Confidence' },
    { key: 'communication', label: 'Communication' }, { key: 'behavioralStar', label: 'Behavioral STAR responses' },
    { key: 'leadership', label: 'Leadership & initiative' }, { key: 'teamwork', label: 'Teamwork' },
    { key: 'adaptability', label: 'Adaptability' },
  ],
};
const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-950 dark:text-white';
const freshRatings = (type: 'tech' | 'hr') => Object.fromEntries(RUBRICS[type].map(({ key }) => [key, 5]));

function toLocalDate(value: string) {
  const date = new Date(`${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
function interviewHasStarted(value: string) {
  const date = new Date(`${value.replace(' ', 'T')}Z`);
  return !Number.isNaN(date.getTime()) && date.getTime() <= Date.now();
}

export const PanelistInterviewPortal: React.FC = () => {
  const [interviews, setInterviews] = useState<AssignedPanelistInterview[]>([]);
  const [scheduleNotifications, setScheduleNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [remarks, setRemarks] = useState('');
  const [recommendation, setRecommendation] = useState<'hire' | 'borderline' | 'remedial'>('borderline');
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    setError('');
    try {
      const [assigned, notifications] = await Promise.all([getAssignedPanelistInterviews(), fetchNotifications().catch(() => [])]);
      setInterviews(assigned);
      setScheduleNotifications((Array.isArray(notifications) ? notifications : []).filter((item) => item.notificationType === 'panelist_interview').slice(0, 8));
    }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Could not load assigned interviews.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); const interval = window.setInterval(() => void refresh(), 30_000); return () => window.clearInterval(interval); }, []);

  const selected = useMemo(() => interviews.find((item) => item.id === activeId) || null, [interviews, activeId]);
  const openEvaluation = (item: AssignedPanelistInterview) => {
    setActiveId(item.id); setRatings(freshRatings(item.interviewType)); setRemarks(''); setRecommendation('borderline'); setError(''); setNotice('');
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await submitPanelistInterviewEvaluation(selected.id, { ratings, remarks, recommendation });
      setNotice(`Evaluation submitted successfully. Final score: ${result.score}%. The student has been notified.`);
      setActiveId(null); await refresh();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : 'Could not submit this evaluation.'); }
    finally { setSaving(false); }
  };

  return <div className="mx-auto max-w-5xl space-y-6 animate-fadeIn">
    <header className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center"><div><p className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">Panelist portal</p><h1 className="mt-1 text-2xl font-extrabold text-slate-900 dark:text-white">My assigned interviews</h1><p className="mt-1 text-sm text-slate-500">Review only the interviews assigned to your panelist account and submit a private evaluation for each student.</p></div><div className="rounded-xl bg-indigo-50 px-4 py-3 text-right dark:bg-indigo-950/40"><span className="block text-[10px] font-bold uppercase text-indigo-600 dark:text-indigo-300">Assignments</span><span className="text-xl font-extrabold text-indigo-800 dark:text-indigo-200">{interviews.length}</span></div></header>
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30">{error}</p>}
    {notice && <p role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />{notice}</p>}

    {!loading && scheduleNotifications.length > 0 && <section className="overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-xs dark:border-indigo-900 dark:bg-slate-900"><header className="border-b border-indigo-100 p-5 dark:border-indigo-900/60"><h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white"><Bell className="h-4 w-4 text-indigo-600" />Interview updates</h2><p className="mt-1 text-xs text-slate-500">New assignments, schedule changes, and cancellations for your panelist account.</p></header><div className="divide-y divide-slate-100 dark:divide-slate-800">{scheduleNotifications.map((item) => { const cancelled = /cancelled|no longer assigned/i.test(`${item.title} ${item.desc}`); return <article key={item.id} className={`flex gap-3 p-4 ${cancelled ? 'bg-rose-50/70 dark:bg-rose-950/20' : ''}`}><span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${cancelled ? 'bg-rose-500' : item.unread ? 'bg-indigo-500' : 'bg-slate-300'}`} /><div><div className="flex flex-wrap items-center gap-2"><h3 className={`text-sm font-bold ${cancelled ? 'text-rose-800 dark:text-rose-300' : 'text-slate-800 dark:text-slate-100'}`}>{item.title}</h3>{cancelled && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">Canceled / reassigned</span>}{item.unread && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">New</span>}</div><p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">{item.desc}</p><p className="mt-1 text-[10px] text-slate-400">{item.time}</p></div></article>; })}</div></section>}

    {loading ? <p role="status" className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">Loading your assignments…</p>
      : interviews.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900"><CalendarClock className="mx-auto h-8 w-8 text-slate-300" /><h2 className="mt-3 font-bold text-slate-800 dark:text-white">No interviews assigned</h2><p className="mt-1 text-sm text-slate-500">Your college administrator will assign interviews to your panelist account.</p></div>
        : <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900"><header className="border-b border-slate-100 p-5 dark:border-slate-800"><h2 className="font-bold text-slate-900 dark:text-white">Interview schedule</h2><p className="mt-1 text-xs text-slate-500">Student details are available only for interviews assigned to you.</p></header><div className="divide-y divide-slate-100 dark:divide-slate-800">{interviews.map((item) => { const cancelled = item.status === 'cancelled'; const started = interviewHasStarted(item.scheduledAt); const meetingLink = /^https?:\/\//i.test(item.location || '') ? item.location : ''; return <article key={item.id} className="p-5"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold uppercase text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">{item.interviewType === 'tech' ? 'Technical' : 'HR & behavioral'}</span><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${cancelled ? 'bg-rose-50 text-rose-700' : item.hasEvaluation ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{cancelled ? 'Cancelled' : item.hasEvaluation ? 'Evaluation submitted' : 'Scheduled'}</span></div><h3 className="mt-2 text-base font-bold text-slate-900 dark:text-white">{item.studentName}<span className="ml-2 text-xs font-normal text-slate-500">{item.rollNo && `Roll: ${item.rollNo}`}</span></h3><div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-600 dark:text-slate-300"><span className="flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5 text-indigo-500" />{toLocalDate(item.scheduledAt)} (local)</span><span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{item.durationMinutes} minutes</span><span className="flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" />{item.panelist}</span><span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{meetingLink ? <a href={meetingLink} target="_blank" rel="noopener noreferrer" className="break-all text-indigo-600 underline dark:text-indigo-400">Open meeting link <ExternalLink className="inline h-3 w-3" /></a> : item.location || 'Location to be confirmed'}</span></div>{item.notes && <p className="mt-3 flex gap-2 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300"><MessageSquareText className="mt-0.5 h-4 w-4 shrink-0" />{item.notes}</p>}</div>{!cancelled && !item.hasEvaluation && <div className="shrink-0">{started ? <button onClick={() => openEvaluation(item)} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-indigo-700">Evaluate interview</button> : <span className="rounded-xl bg-slate-100 px-3 py-2 text-[11px] font-semibold text-slate-500 dark:bg-slate-800">Evaluation opens after scheduled time</span>}</div>}</div>{activeId === item.id && <form onSubmit={(event) => void submit(event)} className="mt-5 border-t border-slate-100 pt-5 dark:border-slate-800"><div className="mb-4 flex items-center justify-between gap-3"><div><h4 className="font-bold text-slate-900 dark:text-white">{item.interviewType === 'tech' ? 'Technical rubric' : 'HR & behavioral rubric'}</h4><p className="mt-1 text-xs text-slate-500">Rate each area from 0 to 10. The overall score is calculated automatically.</p></div><Star className="h-5 w-5 text-amber-500" /></div><div className="grid gap-4 sm:grid-cols-2">{RUBRICS[item.interviewType].map(({ key, label }) => <label key={key} className="text-xs font-semibold text-slate-600 dark:text-slate-300"><span className="flex justify-between gap-3">{label}<strong className="text-indigo-700 dark:text-indigo-300">{ratings[key]}/10</strong></span><input className="mt-2 w-full accent-indigo-600" type="range" min="0" max="10" step="1" value={ratings[key] ?? 5} onChange={(event) => setRatings((current) => ({ ...current, [key]: Number(event.target.value) }))} /></label>)}</div><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Recommendation<select className={`${inputClass} mt-1`} value={recommendation} onChange={(event) => setRecommendation(event.target.value as typeof recommendation)}><option value="hire">Strong hire</option><option value="borderline">Borderline / proceed carefully</option><option value="remedial">Remedial practice recommended</option></select></label><label className="text-xs font-semibold text-slate-600 dark:text-slate-300 sm:row-span-2">Detailed feedback<textarea className={`${inputClass} mt-1`} value={remarks} onChange={(event) => setRemarks(event.target.value)} minLength={3} maxLength={5000} rows={5} placeholder="Strengths, improvement areas, and actionable next steps" required /></label><div className="flex items-end gap-2"><button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60">{saving && <LoaderCircle className="h-4 w-4 animate-spin" />}{saving ? 'Submitting…' : 'Submit evaluation'}</button><button type="button" disabled={saving} onClick={() => setActiveId(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">Cancel</button></div></div></form>}</article>; })}</div></section>}
  </div>;
};
