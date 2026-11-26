import React, { FormEvent, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, ArrowRight, Award, Calendar, Clock, FileCheck2, Layers, Pencil, Plus, X } from 'lucide-react';
import { Assessment, AssessmentSection, BatchInfo, QuestionItem } from '../types';
import { AssessmentResultsPanel } from './AssessmentResultsPanel';

interface AssessmentListProps {
  assessments: Assessment[];
  assessmentsLoading: boolean;
  assessmentsError: string;
  batches: BatchInfo[];
  canManage: boolean;
  onOpenAssessment: (assessmentId: string) => void;
  onCreateAssessment: (params: { sourceAssessmentId: string; title: string; status: Assessment['status']; scheduledDate: string; dayNumber: number; durationMinutes: number; purpose: string; batchId?: string | null; sections: AssessmentSection[]; maxAttempts: number; passPercent: number; availableAt: string | null; dueAt: string | null; allowLateSubmission: boolean; resultReleasePolicy: NonNullable<Assessment['resultReleasePolicy']> }) => Promise<void>;
  onUpdateAssessment: (id: string, params: Partial<Pick<Assessment, 'title' | 'dayNumber' | 'durationMinutes' | 'purpose' | 'status' | 'scheduledDate' | 'sections' | 'coverage' | 'maxAttempts' | 'passPercent' | 'availableAt' | 'dueAt' | 'allowLateSubmission' | 'resultReleasePolicy'>> & { batchId?: string | null }) => Promise<void>;
  onArchiveAssessment: (id: string) => Promise<void>;
}

type EditorState = { kind: 'create' } | { kind: 'edit'; assessment: Assessment } | null;

export const AssessmentList: React.FC<AssessmentListProps> = ({
  assessments,
  assessmentsLoading,
  assessmentsError,
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
  const [draftSections, setDraftSections] = useState<AssessmentSection[]>([]);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [passPercent, setPassPercent] = useState(70);
  const [availableAt, setAvailableAt] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [allowLateSubmission, setAllowLateSubmission] = useState(false);
  const [resultReleasePolicy, setResultReleasePolicy] = useState<NonNullable<Assessment['resultReleasePolicy']>>('immediate');
  const [resultsAssessment, setResultsAssessment] = useState<Assessment | null>(null);
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
    setDraftSections(assessmentOptions[0] ? structuredClone(assessmentOptions[0].sections) : []);
    setMaxAttempts(3);
    setPassPercent(70);
    setAvailableAt('');
    setDueAt('');
    setAllowLateSubmission(false);
    setResultReleasePolicy('immediate');
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
    setDraftSections(structuredClone(assessment.sections));
    setMaxAttempts(assessment.maxAttempts || 0);
    setPassPercent(assessment.passPercent ?? 70);
    setAvailableAt(assessment.availableAt ? assessment.availableAt.slice(0, 16).replace(' ', 'T') : '');
    setDueAt(assessment.dueAt ? assessment.dueAt.slice(0, 16).replace(' ', 'T') : '');
    setAllowLateSubmission(Boolean(assessment.allowLateSubmission));
    setResultReleasePolicy(assessment.resultReleasePolicy || 'immediate');
    setEditor({ kind: 'edit', assessment });
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editor?.kind === 'create') {
        await onCreateAssessment({ sourceAssessmentId, title, status, scheduledDate, dayNumber, durationMinutes, purpose, batchId: batchId || null, sections: draftSections, maxAttempts, passPercent, availableAt: availableAt || null, dueAt: dueAt || null, allowLateSubmission, resultReleasePolicy });
      } else if (editor?.kind === 'edit') {
        await onUpdateAssessment(editor.assessment.id, { title, dayNumber, durationMinutes, purpose, status, scheduledDate, batchId: batchId || null, sections: draftSections, maxAttempts, passPercent, availableAt: availableAt || null, dueAt: dueAt || null, allowLateSubmission, resultReleasePolicy });
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

  const updateQuestion = (sectionIndex: number, questionIndex: number, update: (item: QuestionItem) => QuestionItem) => {
    setDraftSections((current) => current.map((section, index) => index === sectionIndex
      ? { ...section, questions: section.questions.map((item, itemIndex) => itemIndex === questionIndex ? update(item) : item) }
      : section));
  };

  const addMultipleChoiceQuestion = () => {
    setDraftSections((current) => {
      const section = current[0] || { id: `section-${Date.now()}`, name: 'General', questions: [] };
      const question: QuestionItem = { type: 'mcq', data: {
        id: `question-${Date.now()}`, section: section.name, text: 'New question',
        options: ['Option 1', 'Option 2', 'Option 3', 'Option 4'], correctIndex: 0, explanation: '', marks: 1,
      } };
      return current.length ? current.map((item, index) => index === 0 ? { ...item, questions: [...item.questions, question] } : item)
        : [{ ...section, questions: [question] }];
    });
  };

  const addCodingQuestion = () => {
    setDraftSections((current) => {
      const section = current[0] || { id: `section-${Date.now()}`, name: 'General', questions: [] };
      const question: QuestionItem = { type: 'coding', data: {
        id: `coding-${Date.now()}`, title: 'New coding question', difficulty: 'Easy', category: 'General',
        description: 'Describe the task and expected behavior.', constraints: [], examples: [],
        templates: { c: '// Starter code', cpp: '// Starter code', java: '// Starter code', python: '# Starter code', javascript: '// Starter code' },
        testCases: [{ input: '', expected: '', hidden: false }], marks: 30,
      } as any };
      return current.length ? current.map((item, index) => index === 0 ? { ...item, questions: [...item.questions, question] } : item)
        : [{ ...section, questions: [question] }];
    });
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
      {assessmentsLoading ? <div role="status" className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">Loading assessments…</div>
        : assessmentsError ? <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30">Could not load assessments: {assessmentsError}. Please refresh, and contact your administrator if this continues.</div>
          : assessments.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">{canManage ? 'No assessment templates are available. Verify the database migration, then refresh this page.' : 'No assessments are assigned to your account or batch yet. Ask your college administrator to confirm your batch assignment and assessment schedule.'}</div> : <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {assessments.map((assessment) => {
          const isLive = assessment.status === 'live';
          const isCompleted = assessment.status === 'completed';
          const individualStatusLabel = assessment.studentStatus
            ? assessment.studentStatus === 'submitted'
              ? assessment.studentLatestGradingStatus === 'pending_review' || !assessment.studentLatestResultReleased
                ? 'Submitted · awaiting review'
                : `Submitted · ${assessment.studentAttemptCount || 1} attempt${assessment.studentAttemptCount === 1 ? '' : 's'}`
              : 'Not started'
            : isLive ? 'Live now' : isCompleted ? 'Completed' : 'Upcoming';
          const questionCount = assessment.sections.reduce((sum, section) => sum + section.questions.length, 0);
          return <article key={assessment.id} id={`assessment-card-${assessment.id}`} className={`flex flex-col justify-between rounded-2xl border bg-white p-5 transition-all dark:bg-slate-900 ${isLive ? 'border-indigo-300 shadow-md ring-1 ring-indigo-500/20 dark:border-indigo-800' : 'border-slate-200/80 shadow-xs dark:border-slate-800'}`}>
            <div>
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2"><span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">Day {assessment.dayNumber}</span><span className={`rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase ${assessment.studentStatus === 'submitted' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' : assessment.studentStatus === 'not_started' ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200' : isLive ? 'animate-pulse bg-rose-500 text-white' : isCompleted ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'}`}>{individualStatusLabel}</span></div>
                {canManage && <div className="flex items-center gap-1"><button onClick={() => setResultsAssessment(assessment)} className="rounded-lg px-2 py-1 text-[10px] font-bold text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40">Results</button><button onClick={() => openEdit(assessment)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-800" title="Edit assessment"><Pencil className="h-3.5 w-3.5" /></button><button onClick={() => void handleArchive(assessment)} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30" title="Archive assessment"><Archive className="h-3.5 w-3.5" /></button></div>}
              </div>
              <div className="mb-2 flex items-center gap-3 text-xs font-medium text-slate-500"><span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{assessment.durationMinutes} mins</span><span className="flex items-center gap-1"><Award className="h-3.5 w-3.5" />{assessment.totalMarks} marks</span><span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{assessment.scheduledDate}</span></div>
              <h2 className="text-base font-bold leading-snug text-slate-900 dark:text-white">{assessment.title}</h2>
              <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">{assessment.purpose}</p>
              <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800"><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Topics evaluated</span><div className="flex flex-wrap gap-1.5">{assessment.coverage.map((topic, idx) => <span key={`${assessment.id}-${idx}`} className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">{topic}</span>)}</div></div>
              <div className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400"><Layers className="h-3.5 w-3.5" /><span>{(assessment as any).batchId ? batches.find((batch) => batch.id === (assessment as any).batchId)?.name || 'Assigned batch' : 'Workspace-wide'}</span></div>
            </div>
            <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-slate-800"><span className="text-xs font-medium text-slate-400">v{assessment.currentVersion || 1} · {assessment.sections.length} sections · {questionCount} questions · {assessment.studentAttemptCount || 0}{assessment.maxAttempts ? `/${assessment.maxAttempts}` : ''} attempts</span>{canManage ? <button onClick={() => onOpenAssessment(assessment.id)} className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold shadow-xs transition-all ${isLive ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-slate-100 text-slate-800 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'}`}><span>{isLive ? 'Preview assessment' : 'Preview questions'}</span><ArrowRight className="h-3.5 w-3.5" /></button> : isLive && assessment.studentCanStart !== false ? <button onClick={() => onOpenAssessment(assessment.id)} className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-xs transition-all hover:bg-indigo-700"><span>{assessment.studentStatus === 'submitted' ? 'Retake assessment' : 'Start assessment'}</span><ArrowRight className="h-3.5 w-3.5" /></button> : <span className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">{isCompleted ? 'Closed' : assessment.studentCanStart === false ? 'Attempts or schedule limit reached' : 'Waiting to be opened'}</span>}</div>
          </article>;
        })}
      </div>}

      {editor && createPortal(<div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}><form role="dialog" aria-modal="true" aria-labelledby="assessment-editor-title" onSubmit={(event) => void handleSubmit(event)} className="relative z-[10000] my-auto max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-white">
        <div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-300">Workspace assessment</p><h2 id="assessment-editor-title" className="mt-1 text-xl font-extrabold text-slate-900 dark:text-white">{editor.kind === 'create' ? 'Create from template' : 'Edit assessment'}</h2></div><button type="button" onClick={() => setEditor(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close"><X className="h-5 w-5" /></button></div>
        {editor.kind === 'create' && <label className="block space-y-1.5"><span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Start from a template</span><select required value={sourceAssessmentId} onChange={(e) => { const source = assessmentOptions.find((item) => item.id === e.target.value); setSourceAssessmentId(e.target.value); if (source) { setDayNumber(source.dayNumber); setDurationMinutes(source.durationMinutes); setPurpose(source.purpose); setDraftSections(structuredClone(source.sections)); } }} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950">{assessmentOptions.map((assessment) => <option key={assessment.id} value={assessment.id}>{assessment.title}</option>)}</select></label>}
        <label className="block space-y-1.5"><span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Title</span><input required minLength={3} maxLength={191} value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" /></label>
        <div className="grid grid-cols-2 gap-3"><label className="space-y-1.5"><span className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Bootcamp day</span><input required type="number" min={1} max={40} value={dayNumber} onChange={(e) => setDayNumber(Number(e.target.value))} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" /></label><label className="space-y-1.5"><span className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Duration (minutes)</span><input required type="number" min={1} max={600} value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" /></label></div>
        <label className="block space-y-1.5"><span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Purpose</span><textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={3} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" /></label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><label className="space-y-1.5"><span className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Status</span><select value={status} onChange={(e) => setStatus(e.target.value as Assessment['status'])} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"><option value="upcoming">Upcoming</option><option value="live">Live</option><option value="completed">Completed</option></select></label><label className="space-y-1.5 sm:col-span-2"><span className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Schedule label</span><input required maxLength={191} value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} placeholder="e.g. 2026-12-14, 10:00 AM" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" /></label></div>
        <label className="block space-y-1.5"><span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Assign to batch (optional)</span><select value={batchId} onChange={(e) => setBatchId(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"><option value="">Entire workspace</option>{batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.name}</option>)}</select></label>
        <section className="space-y-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
          <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-bold">Questions</h3><p className="text-[11px] text-slate-500">Changes create a new immutable assessment version. Custom coding questions use stdin and stdout; bundled DSA templates use server-side function harnesses.</p></div><div className="flex gap-2"><button type="button" onClick={addMultipleChoiceQuestion} className="rounded-lg border border-indigo-200 px-3 py-2 text-xs font-bold text-indigo-700 dark:border-indigo-900 dark:text-indigo-300">Add MCQ</button><button type="button" disabled={draftSections.flatMap((section) => section.questions).filter((question) => question.type === 'coding').length >= 3} onClick={addCodingQuestion} className="rounded-lg border border-indigo-200 px-3 py-2 text-xs font-bold text-indigo-700 disabled:opacity-40 dark:border-indigo-900 dark:text-indigo-300">Add coding</button></div></div>
          <div className="max-h-72 space-y-3 overflow-y-auto">{draftSections.map((section, sectionIndex) => <div key={section.id} className="space-y-2"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{section.name}</p>{section.questions.map((question, questionIndex) => <div key={question.data.id} className="space-y-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-950">
            {question.type === 'mcq' ? <>
              <textarea aria-label={`Question ${questionIndex + 1} prompt`} value={question.data.text} onChange={(event) => updateQuestion(sectionIndex, questionIndex, (item) => item.type === 'mcq' ? { ...item, data: { ...item.data, text: event.target.value } } : item)} rows={2} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900" />
              <div className="grid grid-cols-2 gap-2">{question.data.options.map((option, optionIndex) => <input key={optionIndex} aria-label={`Question ${questionIndex + 1} option ${optionIndex + 1}`} value={option} onChange={(event) => updateQuestion(sectionIndex, questionIndex, (item) => item.type === 'mcq' ? { ...item, data: { ...item.data, options: item.data.options.map((value, index) => index === optionIndex ? event.target.value : value) } } : item)} className="min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs dark:border-slate-700 dark:bg-slate-900" />)}</div>
              <div className="grid grid-cols-2 gap-2"><label className="text-[10px] text-slate-500">Correct option<select value={question.data.correctIndex} onChange={(event) => updateQuestion(sectionIndex, questionIndex, (item) => item.type === 'mcq' ? { ...item, data: { ...item.data, correctIndex: Number(event.target.value) } } : item)} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs dark:border-slate-700 dark:bg-slate-900">{question.data.options.map((option, index) => <option value={index} key={index}>{index + 1}: {option}</option>)}</select></label><label className="text-[10px] text-slate-500">Marks<input type="number" min={1} max={100} value={question.data.marks} onChange={(event) => updateQuestion(sectionIndex, questionIndex, (item) => item.type === 'mcq' ? { ...item, data: { ...item.data, marks: Number(event.target.value) } } : item)} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs dark:border-slate-700 dark:bg-slate-900" /></label></div>
            </> : <div className="space-y-2"><input aria-label="Coding question title" value={question.data.title} onChange={(event) => updateQuestion(sectionIndex, questionIndex, (item) => item.type === 'coding' ? { ...item, data: { ...item.data, title: event.target.value } } : item)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900" /><textarea aria-label="Coding question instructions" value={question.data.description} onChange={(event) => updateQuestion(sectionIndex, questionIndex, (item) => item.type === 'coding' ? { ...item, data: { ...item.data, description: event.target.value } } : item)} rows={3} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900" /><div className="grid grid-cols-2 gap-2"><label className="text-[10px] text-slate-500">Marks<input type="number" min={1} max={100} value={(question.data as any).marks || 30} onChange={(event) => updateQuestion(sectionIndex, questionIndex, (item) => item.type === 'coding' ? { ...item, data: { ...item.data, marks: Number(event.target.value) } as any } : item)} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs dark:border-slate-700 dark:bg-slate-900" /></label><p className="self-end text-[10px] text-amber-700">Judge0 evaluates saved test cases at submission.</p></div><div className="grid grid-cols-2 gap-2">{question.data.testCases.map((testCase, testIndex) => <React.Fragment key={testIndex}><input aria-label={`Coding test ${testIndex + 1} input`} value={testCase.input} onChange={(event) => updateQuestion(sectionIndex, questionIndex, (item) => item.type === 'coding' ? { ...item, data: { ...item.data, testCases: item.data.testCases.map((test, index) => index === testIndex ? { ...test, input: event.target.value } : test) } } : item)} placeholder="Test input" className="min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs dark:border-slate-700 dark:bg-slate-900" /><input aria-label={`Coding test ${testIndex + 1} expected output`} value={testCase.expected} onChange={(event) => updateQuestion(sectionIndex, questionIndex, (item) => item.type === 'coding' ? { ...item, data: { ...item.data, testCases: item.data.testCases.map((test, index) => index === testIndex ? { ...test, expected: event.target.value } : test) } } : item)} placeholder="Expected output" className="min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs dark:border-slate-700 dark:bg-slate-900" /><label className="col-span-2 flex items-center gap-1 text-[10px] text-slate-500"><input type="checkbox" checked={Boolean(testCase.hidden)} onChange={(event) => updateQuestion(sectionIndex, questionIndex, (item) => item.type === 'coding' ? { ...item, data: { ...item.data, testCases: item.data.testCases.map((test, index) => index === testIndex ? { ...test, hidden: event.target.checked } : test) } } : item)} />Hidden case</label><button type="button" aria-label={`Remove test case ${testIndex + 1}`} disabled={question.data.testCases.length <= 1} onClick={() => updateQuestion(sectionIndex, questionIndex, (item) => item.type === "coding" ? { ...item, data: { ...item.data, testCases: item.data.testCases.filter((_test, index) => index !== testIndex) } } : item)} className="col-span-2 justify-self-end text-[10px] font-bold text-rose-600 disabled:opacity-40">Remove test case</button></React.Fragment>)}</div><button type="button" disabled={question.data.testCases.length >= 10} onClick={() => updateQuestion(sectionIndex, questionIndex, (item) => item.type === 'coding' ? { ...item, data: { ...item.data, testCases: [...item.data.testCases, { input: '', expected: '', hidden: false }] } } : item)} className="text-[10px] font-bold text-indigo-600 disabled:opacity-40">Add test case</button></div>}
            <button type="button" onClick={() => setDraftSections((current) => current.map((item, index) => index === sectionIndex ? { ...item, questions: item.questions.filter((_q, qIndex) => qIndex !== questionIndex) } : item))} className="text-[10px] font-bold text-rose-600">Remove question</button>
          </div>)}</div>)}</div>
        </section>
        <section className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 p-4 sm:grid-cols-2 dark:border-slate-700">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Maximum attempts (0 = unlimited)<input type="number" min={0} max={100} value={maxAttempts} onChange={(event) => setMaxAttempts(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" /></label>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Passing score (%)<input type="number" min={0} max={100} value={passPercent} onChange={(event) => setPassPercent(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" /></label>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Release results<select value={resultReleasePolicy} onChange={(event) => setResultReleasePolicy(event.target.value as NonNullable<Assessment['resultReleasePolicy']>)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"><option value="immediate">Immediately after grading</option><option value="after_due">After due date</option><option value="manual">Manual release</option></select></label>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Available from<input type="datetime-local" value={availableAt} onChange={(event) => setAvailableAt(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" /></label>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Due date<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" /></label>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300 sm:col-span-2"><input type="checkbox" checked={allowLateSubmission} onChange={(event) => setAllowLateSubmission(event.target.checked)} />Allow submissions after the due date</label>
        </section>
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800"><button type="button" onClick={() => setEditor(null)} className="rounded-xl px-4 py-2.5 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Cancel</button><button disabled={saving} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-60">{saving ? 'Saving…' : 'Save assessment'}</button></div>
      </form></div>, document.body)}
      {resultsAssessment && <AssessmentResultsPanel assessment={resultsAssessment} onClose={() => setResultsAssessment(null)} />}
    </div>
  );
};
