import React, { FormEvent, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, ArrowRight, Award, Calendar, Clock, FileCheck2, Layers, Pencil, Plus, X } from 'lucide-react';
import { Assessment, BatchInfo } from '../types';

interface AssessmentListProps {
  assessments: Assessment[];
  batches: BatchInfo[];
  canManage: boolean;
  onOpenAssessment: (assessmentId: string) => void;
  onCreateAssessment: (params: { sourceAssessmentId: string; title: string; status: Assessment['status']; scheduledDate: string; dayNumber: number; durationMinutes: number; purpose: string; batchId?: string | null }) => Promise<void>;
  onUpdateAssessment: (id: string, params: Partial<Pick<Assessment, 'title' | 'dayNumber' | 'durationMinutes' | 'purpose' | 'status' | 'scheduledDate'>> & { batchId?: string | null }) => Promise<void>;
  onArchiveAssessment: (id: string) => Promise<void>;
}

type EditorState = { kind: 'create' } | { kind: 'edit'; assessment: Assessment } | null;

export const AssessmentList: React.FC<AssessmentListProps> = ({
  assessments,
  batches,
  canManage,
  onOpenAssessment,
  onCreateAssessment,
  onUpdateAssessment,
  onArchiveAssessment,
}) => {
  const [editor, setEditor] = useState<EditorState>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [sourceAssessmentId, setSourceAssessmentId] = useState('');
  const [title, setTitle] = useState('');
  const [dayNumber, setDayNumber] = useState(1);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [purpose, setPurpose] = useState('');
  const [status, setStatus] = useState<Assessment['status']>('upcoming');
  const [scheduledDate, setScheduledDate] = useState('');
  const [batchId, setBatchId] = useState('');
  const assessmentOptions = useMemo(() => assessments.filter((assessment) => assessment.sections?.length), [assessments]);

  const openCreate = () => {
    setError('');
    setSourceAssessmentId(assessmentOptions[0]?.id || '');
    setTitle('');
    setDayNumber(assessmentOptions[0]?.dayNumber || 1);
    setDurationMinutes(assessmentOptions[0]?.durationMinutes || 60);
    setPurpose(assessmentOptions[0]?.purpose || '');
    setStatus('upcoming');
    setScheduledDate('');
    setBatchId('');
    setEditor({ kind: 'create' });
  };

  const openEdit = (assessment: Assessment) => {
    setError('');
    setTitle(assessment.title);
    setDayNumber(assessment.dayNumber);
    setDurationMinutes(assessment.durationMinutes);
    setPurpose(assessment.purpose);
    setStatus(assessment.status);
    setScheduledDate(assessment.scheduledDate);
    setBatchId((assessment as any).batchId || '');
    setEditor({ kind: 'edit', assessment });
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editor?.kind === 'create') {
        await onCreateAssessment({ sourceAssessmentId, title, status, scheduledDate, dayNumber, durationMinutes, purpose, batchId: batchId || null });
      } else if (editor?.kind === 'edit') {
        await onUpdateAssessment(editor.assessment.id, { title, dayNumber, durationMinutes, purpose, status, scheduledDate, batchId: batchId || null });
      }
      setEditor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save assessment changes.');
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (assessment: Assessment) => {
    if (!window.confirm(`Archive “${assessment.title}”? Past submissions will remain in the database.`)) return;
    try {
      await onArchiveAssessment(assessment.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not archive the assessment.');
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <header className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-bold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300"><FileCheck2 className="h-3.5 w-3.5" />Workspace assessment catalog</div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">Assessments & benchmark tests</h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Assessment templates and schedules saved for this college workspace.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-slate-200/60 bg-slate-50 p-3 text-right dark:border-slate-700 dark:bg-slate-800"><span className="block text-[10px] font-bold uppercase text-slate-400">Workspace assessments</span><span className="text-lg font-extrabold text-indigo-600 dark:text-indigo-400">{assessments.length}</span></div>
          {canManage && <button onClick={openCreate} disabled={!assessmentOptions.length} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50"><Plus className="h-4 w-4" />Create from template</button>}
        </div>
      </header>

      {error && !editor && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
      {assessments.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">No assessments are configured for this workspace yet. Apply the database migration, then refresh this page.</div> : <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {assessments.map((assessment) => {
          const isLive = assessment.status === 'live';
          const isCompleted = assessment.status === 'completed';
          const individualStatusLabel = assessment.studentStatus
            ? assessment.studentStatus === 'submitted'
              ? `Submitted · ${assessment.studentAttemptCount || 1} attempt${assessment.studentAttemptCount === 1 ? '' : 's'}`
              : 'Not started'
            : isLive ? 'Live now' : isCompleted ? 'Completed' : 'Upcoming';
          const questionCount = assessment.sections.reduce((sum, section) => sum + section.questions.length, 0);
          return <article key={assessment.id} id={`assessment-card-${assessment.id}`} className={`flex flex-col justify-between rounded-2xl border bg-white p-5 transition-all dark:bg-slate-900 ${isLive ? 'border-indigo-300 shadow-md ring-1 ring-indigo-500/20 dark:border-indigo-800' : 'border-slate-200/80 shadow-xs dark:border-slate-800'}`}>
            <div>
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2"><span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">Day {assessment.dayNumber}</span><span className={`rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase ${assessment.studentStatus === 'submitted' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' : assessment.studentStatus === 'not_started' ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200' : isLive ? 'animate-pulse bg-rose-500 text-white' : isCompleted ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'}`}>{individualStatusLabel}</span></div>
                {canManage && <div className="flex items-center gap-1"><button onClick={() => openEdit(assessment)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-800" title="Edit assessment"><Pencil className="h-3.5 w-3.5" /></button><button onClick={() => void handleArchive(assessment)} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30" title="Archive assessment"><Archive className="h-3.5 w-3.5" /></button></div>}
              </div>
              <div className="mb-2 flex items-center gap-3 text-xs font-medium text-slate-500"><span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{assessment.durationMinutes} mins</span><span className="flex items-center gap-1"><Award className="h-3.5 w-3.5" />{assessment.totalMarks} marks</span><span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{assessment.scheduledDate}</span></div>
              <h2 className="text-base font-bold leading-snug text-slate-900 dark:text-white">{assessment.title}</h2>
              <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">{assessment.purpose}</p>
              <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800"><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Topics evaluated</span><div className="flex flex-wrap gap-1.5">{assessment.coverage.map((topic, idx) => <span key={`${assessment.id}-${idx}`} className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">{topic}</span>)}</div></div>
              <div className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400"><Layers className="h-3.5 w-3.5" /><span>{(assessment as any).batchId ? batches.find((batch) => batch.id === (assessment as any).batchId)?.name || 'Assigned batch' : 'Workspace-wide'}</span></div>
            </div>
            <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-slate-800"><span className="text-xs font-medium text-slate-400">{assessment.sections.length} sections · {questionCount} questions</span>{canManage ? <button onClick={() => onOpenAssessment(assessment.id)} className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold shadow-xs transition-all ${isLive ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-slate-100 text-slate-800 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'}`}><span>{isLive ? 'Preview assessment' : 'Preview questions'}</span><ArrowRight className="h-3.5 w-3.5" /></button> : isLive ? <button onClick={() => onOpenAssessment(assessment.id)} className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-xs transition-all hover:bg-indigo-700"><span>{assessment.studentStatus === 'submitted' ? 'Retake assessment' : 'Start assessment'}</span><ArrowRight className="h-3.5 w-3.5" /></button> : <span className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">{isCompleted ? 'Closed' : 'Waiting to be opened'}</span>}</div>
          </article>;
        })}
      </div>}

      {editor && createPortal(<div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}><form role="dialog" aria-modal="true" aria-labelledby="assessment-editor-title" onSubmit={(event) => void handleSubmit(event)} className="relative z-[10000] my-auto max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-white">
        <div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-300">Workspace assessment</p><h2 id="assessment-editor-title" className="mt-1 text-xl font-extrabold text-slate-900 dark:text-white">{editor.kind === 'create' ? 'Create from template' : 'Edit assessment'}</h2></div><button type="button" onClick={() => setEditor(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close"><X className="h-5 w-5" /></button></div>
        {editor.kind === 'create' && <label className="block space-y-1.5"><span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Assessment template</span><select required value={sourceAssessmentId} onChange={(e) => { const source = assessmentOptions.find((item) => item.id === e.target.value); setSourceAssessmentId(e.target.value); if (source) { setDayNumber(source.dayNumber); setDurationMinutes(source.durationMinutes); setPurpose(source.purpose); } }} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950">{assessmentOptions.map((assessment) => <option key={assessment.id} value={assessment.id}>{assessment.title}</option>)}</select></label>}
        <label className="block space-y-1.5"><span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Title</span><input required minLength={3} maxLength={191} value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" /></label>
        <div className="grid grid-cols-2 gap-3"><label className="space-y-1.5"><span className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Bootcamp day</span><input required type="number" min={1} max={40} value={dayNumber} onChange={(e) => setDayNumber(Number(e.target.value))} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" /></label><label className="space-y-1.5"><span className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Duration (minutes)</span><input required type="number" min={1} max={600} value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" /></label></div>
        <label className="block space-y-1.5"><span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Purpose</span><textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={3} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" /></label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><label className="space-y-1.5"><span className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Status</span><select value={status} onChange={(e) => setStatus(e.target.value as Assessment['status'])} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"><option value="upcoming">Upcoming</option><option value="live">Live</option><option value="completed">Completed</option></select></label><label className="space-y-1.5 sm:col-span-2"><span className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Schedule label</span><input required maxLength={191} value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} placeholder="e.g. 2026-12-14, 10:00 AM" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" /></label></div>
        <label className="block space-y-1.5"><span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Assign to batch (optional)</span><select value={batchId} onChange={(e) => setBatchId(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"><option value="">Entire workspace</option>{batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.name}</option>)}</select></label>
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800"><button type="button" onClick={() => setEditor(null)} className="rounded-xl px-4 py-2.5 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Cancel</button><button disabled={saving} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-60">{saving ? 'Saving…' : 'Save assessment'}</button></div>
      </form></div>, document.body)}
    </div>
  );
};
