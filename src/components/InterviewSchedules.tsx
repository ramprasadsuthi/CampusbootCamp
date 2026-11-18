import React, { FormEvent, useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, Clock3, Eye, LoaderCircle, MapPin, MessageSquareText, Pencil, Plus, Save, UserRound, X } from 'lucide-react';
import { StudentProfile } from '../types';
import { WorkspaceInterviewPanelist, WorkspaceInterviewSchedule } from '../types/auth';
import { cancelInterviewSchedule, createInterviewSchedule, getInterviewEvaluationDetail, getInterviewPanelists, getInterviewSchedules, InterviewEvaluationDetail, InterviewFollowUpOutcome, saveInterviewFollowUp, saveInterviewPanelist, setInterviewPanelistStatus, updateInterviewSchedule } from '../services/auth';

interface Props { students: StudentProfile[]; defaultDurationMinutes: number; }
const defaultLocalDateTime = () => { const value = new Date(); value.setHours(value.getHours() + 1, 0, 0, 0); return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const scheduleToLocalInput = (value: string) => { const date = new Date(`${value.replace(' ', 'T')}Z`); return Number.isNaN(date.getTime()) ? defaultLocalDateTime() : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const schedulePayloadDate = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toISOString(); };
const formatScheduleDate = (value: string) => { const date = new Date(`${value.replace(' ', 'T')}Z`); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); };
type InterviewLifecycle = 'scheduled' | 'awaiting_evaluation' | 'completed' | 'cancelled';
const getInterviewLifecycle = (schedule: WorkspaceInterviewSchedule): InterviewLifecycle => {
  if (schedule.status === 'cancelled') return 'cancelled';
  if (schedule.status === 'completed' || schedule.hasEvaluation) return 'completed';
  const scheduledAt = new Date(`${schedule.scheduledAt.replace(' ', 'T')}Z`).getTime();
  return Number.isFinite(scheduledAt) && scheduledAt <= Date.now() ? 'awaiting_evaluation' : 'scheduled';
};
const lifecycleLabels: Record<InterviewLifecycle, string> = { scheduled: 'Scheduled', awaiting_evaluation: 'Awaiting evaluation', completed: 'Completed', cancelled: 'Cancelled' };
const lifecycleClasses: Record<InterviewLifecycle, string> = {
  scheduled: 'bg-emerald-50 text-emerald-700', awaiting_evaluation: 'bg-amber-50 text-amber-700',
  completed: 'bg-sky-50 text-sky-700', cancelled: 'bg-slate-100 text-slate-500',
};
const blankForm = (duration: number) => ({ studentId: '', interviewType: 'tech' as const, scheduledAt: defaultLocalDateTime(), durationMinutes: duration, panelistId: '', location: '', notes: '' });
const blankPanelist = () => ({ name: '', email: '', designation: '', specialties: '' });
const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-950 dark:text-white';
const interviewRubricLabels: Record<string, string> = {
  coding: 'Coding & data structures', sql: 'SQL & data modeling', oop: 'OOP & code quality',
  projects: 'Project knowledge', problemSolving: 'Problem solving', communication: 'Communication',
  resumeReview: 'Resume & background', confidence: 'Confidence', behavioralStar: 'Behavioral STAR responses',
  leadership: 'Leadership & initiative', teamwork: 'Teamwork', adaptability: 'Adaptability',
};
const followUpLabels: Record<InterviewFollowUpOutcome, string> = {
  needs_another_interview: 'Needs another interview', referred_for_placement: 'Referred for placement',
  offer_confirmed: 'Offer confirmed', no_further_action: 'No further action',
};

export const InterviewSchedules: React.FC<Props> = ({ students, defaultDurationMinutes }) => {
  const [schedules, setSchedules] = useState<WorkspaceInterviewSchedule[]>([]);
  const [panelists, setPanelists] = useState<WorkspaceInterviewPanelist[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [panelistSaving, setPanelistSaving] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [lifecycleFilter, setLifecycleFilter] = useState<'all' | InterviewLifecycle>('all');
  const [, setLifecycleClock] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingPanelistId, setEditingPanelistId] = useState<string | null>(null);
  const [form, setForm] = useState(() => blankForm(defaultDurationMinutes));
  const [panelistForm, setPanelistForm] = useState(blankPanelist);
  const [evaluationDetail, setEvaluationDetail] = useState<InterviewEvaluationDetail | null>(null);
  const [loadingEvaluationId, setLoadingEvaluationId] = useState<string | null>(null);
  const [followUpDrafts, setFollowUpDrafts] = useState<Record<string, { outcome: InterviewFollowUpOutcome | ''; notes: string; studentNotes: string }>>({});
  const [savingFollowUpId, setSavingFollowUpId] = useState<string | null>(null);

  const refresh = async () => {
    setError('');
    try {
      const [scheduleData, panelistData] = await Promise.all([getInterviewSchedules(), getInterviewPanelists()]);
      setSchedules(scheduleData); setPanelists(panelistData);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Could not load interview operations.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  useEffect(() => { const interval = window.setInterval(() => setLifecycleClock((value) => value + 1), 60_000); return () => window.clearInterval(interval); }, []);
  const resetForm = () => { setEditingId(null); setForm(blankForm(defaultDurationMinutes)); };
  const editSchedule = (schedule: WorkspaceInterviewSchedule) => {
    setEditingId(schedule.id);
    setForm({ studentId: schedule.studentId, interviewType: schedule.interviewType, scheduledAt: scheduleToLocalInput(schedule.scheduledAt), durationMinutes: schedule.durationMinutes, panelistId: schedule.panelistId, location: schedule.location, notes: schedule.notes });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    const payload = { ...form, scheduledAt: schedulePayloadDate(form.scheduledAt), status: 'scheduled' as const };
    try {
      if (editingId) await updateInterviewSchedule(editingId, payload); else await createInterviewSchedule(payload);
      resetForm(); setNotice(editingId ? 'Interview updated. The student has been notified.' : 'Interview scheduled. The student has been notified.'); await refresh();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Could not save interview schedule.'); }
    finally { setSaving(false); }
  };
  const cancelSchedule = async (schedule: WorkspaceInterviewSchedule) => {
    if (!window.confirm(`Cancel the ${schedule.interviewType === 'tech' ? 'technical' : 'HR'} interview for ${schedule.studentName}?`)) return;
    setCancellingId(schedule.id); setError(''); setNotice('');
    try {
      await cancelInterviewSchedule(schedule.id);
      setNotice('Interview cancelled. The student has been notified.'); await refresh();
    } catch (cancelError) { setError(cancelError instanceof Error ? cancelError.message : 'Could not cancel this interview.'); }
    finally { setCancellingId(null); }
  };
  const savePanelist = async (event: FormEvent) => {
    event.preventDefault(); setPanelistSaving(true); setError(''); setNotice('');
    try {
      await saveInterviewPanelist({ ...panelistForm, ...(editingPanelistId ? { id: editingPanelistId } : {}) });
      setPanelistForm(blankPanelist()); setEditingPanelistId(null); setNotice(editingPanelistId ? 'Panelist details updated.' : 'Panelist added to the workspace directory.'); await refresh();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Could not save panelist.'); }
    finally { setPanelistSaving(false); }
  };
  const editPanelist = (panelist: WorkspaceInterviewPanelist) => { setEditingPanelistId(panelist.id); setPanelistForm({ name: panelist.name, email: panelist.email, designation: panelist.designation, specialties: panelist.specialties }); };
  const reviewEvaluation = async (scheduleId: string) => {
    setError(''); setLoadingEvaluationId(scheduleId);
    try { setEvaluationDetail(await getInterviewEvaluationDetail(scheduleId)); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Could not load the saved evaluation.'); }
    finally { setLoadingEvaluationId(null); }
  };
  const togglePanelist = async (panelist: WorkspaceInterviewPanelist) => {
    setError(''); setNotice('');
    try { await setInterviewPanelistStatus(panelist.id, !panelist.isActive); setNotice(panelist.isActive ? 'Panelist deactivated.' : 'Panelist activated.'); await refresh(); }
    catch (statusError) { setError(statusError instanceof Error ? statusError.message : 'Could not update panelist.'); }
  };
  const saveFollowUp = async (schedule: WorkspaceInterviewSchedule) => {
    const draft = followUpDrafts[schedule.id] || { outcome: schedule.followUpOutcome || '', notes: schedule.followUpNotes || '', studentNotes: schedule.followUpStudentNotes || '' };
    if (!draft.outcome) { setError('Choose a follow-up outcome before saving.'); return; }
    setError(''); setNotice(''); setSavingFollowUpId(schedule.id);
    try {
      await saveInterviewFollowUp(schedule.id, { outcome: draft.outcome, notes: draft.notes, studentNotes: draft.studentNotes });
      setNotice('Interview follow-up saved. The panelist evaluation remains unchanged.');
      await refresh();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Could not save this follow-up.'); }
    finally { setSavingFollowUpId(null); }
  };
  const visibleSchedules = schedules.filter((schedule) => lifecycleFilter === 'all' || getInterviewLifecycle(schedule) === lifecycleFilter);
  const activePanelists = panelists.filter((panelist) => panelist.isActive && Boolean(panelist.userId));

  return <div className="mx-auto max-w-6xl space-y-6 animate-fadeIn">
    <header className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900"><div><p className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">Interview operations</p><h1 className="mt-1 text-2xl font-extrabold text-slate-900 dark:text-white">Interview Panels & Scheduling</h1><p className="mt-1 text-sm text-slate-500">Manage workspace panelists, prevent double-booking, and notify students in-app.</p></div><div className="rounded-xl bg-indigo-50 px-4 py-3 text-right dark:bg-indigo-950/40"><span className="block text-[10px] font-bold uppercase text-indigo-600 dark:text-indigo-300">Scheduled</span><span className="text-xl font-extrabold text-indigo-800 dark:text-indigo-200">{schedules.filter((item) => item.status === 'scheduled').length}</span></div></header>
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30">{error}</p>}
    {notice && <p role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />{notice}</p>}

    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4"><h2 className="font-bold text-slate-900 dark:text-white">Workspace panelist directory</h2><p className="mt-1 text-xs text-slate-500">Add a panelist and email, then invite that email as an Interview panelist under Workspace Members. Scheduling is enabled after the account accepts its invite.</p></div>
      <form onSubmit={(event) => void savePanelist(event)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <input className={inputClass} value={panelistForm.name} onChange={(e) => setPanelistForm((v) => ({ ...v, name: e.target.value }))} placeholder="Panelist name" maxLength={191} required />
        <input className={inputClass} value={panelistForm.email} onChange={(e) => setPanelistForm((v) => ({ ...v, email: e.target.value }))} placeholder="Email (optional)" type="email" />
        <input className={inputClass} value={panelistForm.designation} onChange={(e) => setPanelistForm((v) => ({ ...v, designation: e.target.value }))} placeholder="Designation" maxLength={191} />
        <input className={inputClass} value={panelistForm.specialties} onChange={(e) => setPanelistForm((v) => ({ ...v, specialties: e.target.value }))} placeholder="Specialties" maxLength={500} />
        <div className="flex gap-2"><button disabled={panelistSaving} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2.5 text-sm font-bold text-white disabled:opacity-50">{panelistSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{editingPanelistId ? 'Save' : 'Add panelist'}</button>{editingPanelistId && <button type="button" onClick={() => { setEditingPanelistId(null); setPanelistForm(blankPanelist()); }} className="rounded-xl border border-slate-200 px-3 text-slate-600 dark:border-slate-700 dark:text-slate-300" aria-label="Cancel panelist edit"><X className="h-4 w-4" /></button>}</div>
      </form>
      {panelists.length === 0 ? <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">Add at least one panelist before scheduling an interview.</p> : <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">{panelists.map((p) => <div key={p.id} className="flex flex-col justify-between gap-2 py-3 sm:flex-row sm:items-center"><div><p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{p.name} <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${p.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{p.isActive ? 'Active' : 'Inactive'}</span><span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${p.userId ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700'}`}>{p.userId ? 'Account linked' : 'Invite needed'}</span></p><p className="text-xs text-slate-500">{[p.designation, p.email, p.specialties].filter(Boolean).join(' · ') || 'No additional details'}</p></div><div className="flex gap-2"><button onClick={() => editPanelist(p)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"><Pencil className="mr-1 inline h-3 w-3" />Edit</button><button onClick={() => void togglePanelist(p)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">{p.isActive ? 'Deactivate' : 'Activate'}</button></div></div>)}</div>}
    </section>

    <form onSubmit={(event) => void save(event)} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="font-bold text-slate-900 dark:text-white">{editingId ? 'Edit interview schedule' : 'Schedule an interview'}</h2><p className="mt-1 text-xs text-slate-500">Students receive an in-app notification when interviews are created, updated, or cancelled.</p></div>{editingId && <button type="button" onClick={resetForm} className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-3.5 w-3.5" />Cancel edit</button>}</div>
      {students.length === 0 ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">There are no active students in this workspace to schedule.</p> : activePanelists.length === 0 ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">Add a panelist, then invite them as an Interview panelist from Workspace Members. Only linked accounts can be assigned.</p> : <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="space-y-1 text-xs font-semibold text-slate-600 dark:text-slate-300">Student<select className={inputClass} value={form.studentId} onChange={(e) => setForm((v) => ({ ...v, studentId: e.target.value }))} required><option value="">Select student</option>{students.map((s) => <option key={s.id} value={s.id}>{s.name}{s.rollNo ? ` · ${s.rollNo}` : ''}</option>)}</select></label>
          <label className="space-y-1 text-xs font-semibold text-slate-600 dark:text-slate-300">Interview type<select className={inputClass} value={form.interviewType} onChange={(e) => setForm((v) => ({ ...v, interviewType: e.target.value as 'tech' | 'hr' }))}><option value="tech">Technical</option><option value="hr">HR & behavioral</option></select></label>
          <label className="space-y-1 text-xs font-semibold text-slate-600 dark:text-slate-300">Date and time (your local time)<input className={inputClass} type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm((v) => ({ ...v, scheduledAt: e.target.value }))} required /></label>
          <label className="space-y-1 text-xs font-semibold text-slate-600 dark:text-slate-300">Duration (minutes)<input className={inputClass} type="number" min={15} max={180} step={15} value={form.durationMinutes} onChange={(e) => setForm((v) => ({ ...v, durationMinutes: Number(e.target.value) }))} required /></label>
          <label className="space-y-1 text-xs font-semibold text-slate-600 dark:text-slate-300">Panelist<select className={inputClass} value={form.panelistId} onChange={(e) => setForm((v) => ({ ...v, panelistId: e.target.value }))} required><option value="">Select panelist</option>{activePanelists.map((p) => <option key={p.id} value={p.id}>{p.name}{p.designation ? ` · ${p.designation}` : ''}</option>)}</select></label>
          <label className="space-y-1 text-xs font-semibold text-slate-600 dark:text-slate-300">Room or meeting link<input className={inputClass} value={form.location} onChange={(e) => setForm((v) => ({ ...v, location: e.target.value }))} maxLength={500} placeholder="Room 2 or meeting URL" /></label>
          <label className="space-y-1 text-xs font-semibold text-slate-600 dark:text-slate-300 sm:col-span-2 lg:col-span-3">Preparation notes<textarea className={inputClass} value={form.notes} onChange={(e) => setForm((v) => ({ ...v, notes: e.target.value }))} maxLength={2000} rows={2} placeholder="Optional instructions for the student" /></label>
        </div>
        <div className="mt-4 flex justify-end"><button disabled={saving || students.length === 0 || activePanelists.length === 0} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">{saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : editingId ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{saving ? 'Saving…' : editingId ? 'Save changes' : 'Schedule interview'}</button></div>
      </>}
    </form>

    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <header className="flex flex-col justify-between gap-3 border-b border-slate-200 p-5 dark:border-slate-800 sm:flex-row sm:items-center"><div><h2 className="font-bold text-slate-900 dark:text-white">Workspace interview schedule</h2><p className="mt-1 text-xs text-slate-500">Track appointments, pending evaluations, completed interviews, and cancellations.</p></div><label className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">Filter<select className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950" value={lifecycleFilter} onChange={(event) => setLifecycleFilter(event.target.value as typeof lifecycleFilter)}><option value="all">All interviews</option><option value="scheduled">Scheduled</option><option value="awaiting_evaluation">Awaiting evaluation</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label></header>
      {loading ? <p role="status" className="p-6 text-sm text-slate-500">Loading interview schedules…</p> : visibleSchedules.length === 0 ? <div className="p-8 text-center"><CalendarClock className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">No interviews in this view</p><p className="mt-1 text-xs text-slate-500">Change the filter or create a schedule above.</p></div> : <div className="divide-y divide-slate-100 dark:divide-slate-800">{visibleSchedules.map((s) => { const lifecycle = getInterviewLifecycle(s); const followUpDraft = followUpDrafts[s.id] || { outcome: s.followUpOutcome || '', notes: s.followUpNotes || '', studentNotes: s.followUpStudentNotes || '' }; return <article key={s.id} className="flex flex-col justify-between gap-4 p-5 lg:flex-row lg:items-center"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${s.interviewType === 'tech' ? 'bg-indigo-50 text-indigo-700' : 'bg-violet-50 text-violet-700'}`}>{s.interviewType === 'tech' ? 'Technical' : 'HR & behavioral'}</span><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${lifecycleClasses[lifecycle]}`}>{lifecycleLabels[lifecycle]}</span></div><h3 className="mt-2 truncate text-sm font-bold text-slate-900 dark:text-white">{s.studentName}<span className="ml-2 text-xs font-normal text-slate-500">{s.rollNo}{s.batchName ? ` · ${s.batchName}` : ''}</span></h3><div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500"><span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />{formatScheduleDate(s.scheduledAt)}</span><span className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{s.durationMinutes} min · {s.panelist}</span>{s.location && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{s.location}</span>}</div>{s.notes && <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-500"><MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0" />{s.notes}</p>}{lifecycle === 'completed' && s.hasEvaluation && <><div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:bg-sky-950/30 dark:text-sky-200"><CheckCircle2 className="h-4 w-4" /><span className="font-bold">Evaluation: {Number(s.evaluationScore) || 0}%</span><span>Recommendation: {s.evaluationRecommendation || 'Not specified'}</span>{s.evaluationDate && <span className="text-sky-700/70 dark:text-sky-300/70">Submitted {s.evaluationDate}</span>}</div><div className="mt-3 grid gap-2 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 dark:border-indigo-900 dark:bg-indigo-950/20 sm:grid-cols-2"><label className="text-[11px] font-bold text-slate-600 dark:text-slate-300">Placement follow-up<select value={followUpDraft.outcome} onChange={(event) => setFollowUpDrafts((drafts) => ({ ...drafts, [s.id]: { ...followUpDraft, outcome: event.target.value as InterviewFollowUpOutcome | '' } }))} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"><option value="">Not recorded</option>{Object.entries(followUpLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-[11px] font-bold text-slate-600 dark:text-slate-300">Admin-only notes<textarea value={followUpDraft.notes} onChange={(event) => setFollowUpDrafts((drafts) => ({ ...drafts, [s.id]: { ...followUpDraft, notes: event.target.value } }))} rows={2} maxLength={4000} placeholder="Internal follow-up details (not shown to the student)" className="mt-1 w-full resize-y rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"/></label><label className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300 sm:col-span-2">Notes visible to the student<textarea value={followUpDraft.studentNotes} onChange={(event) => setFollowUpDrafts((drafts) => ({ ...drafts, [s.id]: { ...followUpDraft, studentNotes: event.target.value } }))} rows={2} maxLength={2000} placeholder="Share next steps or placement guidance" className="mt-1 w-full resize-y rounded-lg border border-indigo-200 bg-white px-2.5 py-2 text-xs dark:border-indigo-800 dark:bg-slate-900"/></label><button onClick={() => void saveFollowUp(s)} disabled={savingFollowUpId === s.id || !followUpDraft.outcome} className="justify-self-end self-end rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{savingFollowUpId === s.id ? 'Saving…' : 'Save follow-up'}</button></div></>}</div><div className="flex shrink-0 items-center gap-2">{s.status === 'scheduled' && <><button onClick={() => editSchedule(s)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"><Pencil className="h-3.5 w-3.5" />Edit</button><button disabled={cancellingId === s.id} onClick={() => void cancelSchedule(s)} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 disabled:cursor-wait disabled:opacity-60">{cancellingId === s.id ? 'Cancelling…' : 'Cancel interview'}</button></>}{s.status === 'cancelled' && <button onClick={() => editSchedule(s)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"><UserRound className="h-3.5 w-3.5" />Reschedule</button>}{lifecycle === 'completed' && s.hasEvaluation && <button onClick={() => void reviewEvaluation(s.id)} disabled={loadingEvaluationId === s.id} className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 px-3 py-2 text-xs font-semibold text-sky-700 disabled:opacity-60 dark:border-sky-900 dark:text-sky-300">{loadingEvaluationId === s.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}{loadingEvaluationId === s.id ? 'Loading…' : 'Review evaluation'}</button>}</div></article>; })}</div>}
    </section>
    {evaluationDetail && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setEvaluationDetail(null); }}><section role="dialog" aria-modal="true" aria-labelledby="evaluation-detail-title" className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"><header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-100 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><div><p className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">Saved evaluation · Read only</p><h2 id="evaluation-detail-title" className="mt-1 text-xl font-extrabold text-slate-900 dark:text-white">{evaluationDetail.interviewType === 'tech' ? 'Technical interview' : 'HR & behavioral interview'}</h2><p className="mt-1 text-sm text-slate-500">{evaluationDetail.studentName}{evaluationDetail.rollNo ? ` · ${evaluationDetail.rollNo}` : ''} · Panelist: {evaluationDetail.panelist}</p></div><button onClick={() => setEvaluationDetail(null)} aria-label="Close evaluation details" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button></header><div className="space-y-5 p-5"><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-indigo-50 p-4 dark:bg-indigo-950/30"><p className="text-[10px] font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">Final score</p><p className="mt-1 text-2xl font-extrabold text-indigo-900 dark:text-indigo-100">{Number(evaluationDetail.score) || 0}%</p></div><div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Recommendation</p><p className="mt-1 text-sm font-bold text-slate-900 dark:text-white">{evaluationDetail.recommendation}</p></div><div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Submitted</p><p className="mt-1 text-sm font-bold text-slate-900 dark:text-white">{evaluationDetail.evaluationDate}</p></div></div><div><h3 className="mb-3 font-bold text-slate-900 dark:text-white">Rubric scores</h3><div className="grid gap-3 sm:grid-cols-2">{Object.entries(evaluationDetail.ratings || {}).map(([key, value]) => <div key={key} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><div className="mb-2 flex items-center justify-between gap-3 text-xs"><span className="font-medium text-slate-600 dark:text-slate-300">{interviewRubricLabels[key] || key}</span><strong className="text-slate-900 dark:text-white">{value}/10</strong></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.max(0, Math.min(100, Number(value) * 10))}%` }} /></div></div>)}</div></div><div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60"><h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500"><MessageSquareText className="h-4 w-4" />Panelist feedback</h3><p className="whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-200">{evaluationDetail.remarks || 'No written feedback was submitted.'}</p></div><p className="text-[11px] text-slate-400">This saved evaluation is read-only in the administrator review.</p></div></section></div>}
  </div>;
};
