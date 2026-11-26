import React, { useEffect, useState } from 'react';
import { Assessment, AssessmentSubmission } from '../types';
import { fetchAssessmentSubmissions, fetchAssessmentVersions, reviewAssessmentSubmission } from '../services/api';
import { Check, X } from 'lucide-react';

interface Props {
  assessment: Assessment;
  onClose: () => void;
}

export const AssessmentResultsPanel: React.FC<Props> = ({ assessment, onClose }) => {
  const [submissions, setSubmissions] = useState<AssessmentSubmission[]>([]);
  const [versions, setVersions] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { score: string; feedback: string; releaseResults: boolean }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([fetchAssessmentSubmissions(assessment.id), fetchAssessmentVersions(assessment.id)]).then(([rows, versionRows]) => {
      if (!active) return;
      setSubmissions(rows);
      setVersions(versionRows);
      setDrafts(Object.fromEntries(rows.map((row) => [row.id, {
        score: String(row.score ?? 0), feedback: row.feedback?.text || '', releaseResults: Boolean(row.resultReleased),
      }])));
    }).catch((err) => setError(err instanceof Error ? err.message : 'Could not load assessment results.'))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [assessment.id]);

  const saveReview = async (submission: AssessmentSubmission) => {
    const draft = drafts[submission.id];
    if (!draft) return;
    setSavingId(submission.id);
    setError('');
    try {
      const response = await reviewAssessmentSubmission(submission.id, {
        score: Number(draft.score), feedback: draft.feedback, releaseResults: draft.releaseResults,
      });
      setSubmissions((current) => current.map((row) => row.id === submission.id ? {
        ...row, score: response.score, percentage: response.percentage, passed: response.passed,
        gradingStatus: 'reviewed', resultReleased: response.resultReleased, feedback: { text: draft.feedback },
      } : row));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the review.');
    } finally {
      setSavingId('');
    }
  };

  return <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="assessment-results-title" className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
      <header className="flex items-center justify-between border-b border-slate-200 p-5 dark:border-slate-700"><div><p className="text-xs font-bold uppercase tracking-wide text-indigo-600">Version {assessment.currentVersion || 1}</p><h2 id="assessment-results-title" className="mt-1 text-lg font-bold">Results · {assessment.title}</h2><p className="mt-1 text-xs text-slate-500">Review coding attempts, update final scores, and release results.</p></div><button onClick={onClose} aria-label="Close results" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={18} /></button></header>
      <div className="overflow-y-auto p-5">
        {error && <p role="alert" className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        <details className="mb-4 rounded-xl border border-slate-200 p-3 dark:border-slate-700"><summary className="cursor-pointer text-xs font-bold">Version history ({versions.length})</summary><div className="mt-2 space-y-2">{versions.map((version) => <div key={version.versionNumber} className="flex justify-between gap-4 text-xs"><span>v{version.versionNumber} · {version.changeSummary || 'Assessment updated'}{version.createdBy ? ` · ${version.createdBy}` : ''}</span><time className="shrink-0 text-slate-500">{new Date(version.createdAt).toLocaleString()}</time></div>)}</div></details>
        {loading ? <p className="py-8 text-center text-sm text-slate-500">Loading submissions…</p>
          : submissions.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No student attempts have been submitted.</p>
            : <div className="space-y-4">{submissions.map((submission) => {
              const draft = drafts[submission.id] || { score: '0', feedback: '', releaseResults: Boolean(submission.resultReleased) };
              const deliveredVersion = versions.find((version) => Number(version.versionNumber) === Number(submission.assessmentVersion || 1));
              const deliveredQuestions = (deliveredVersion?.snapshot?.sections || []).flatMap((section: any) => section.questions || []);
              return <article key={submission.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">{submission.studentName}</h3><p className="text-xs text-slate-500">Attempt {submission.attemptNumber || 1} · Assessment v{submission.assessmentVersion || 1} · {new Date(submission.submittedAt).toLocaleString()}</p></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${submission.gradingStatus === 'pending_review' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>{submission.gradingStatus === 'pending_review' ? 'Needs review' : submission.gradingStatus === 'reviewed' ? 'Reviewed' : 'Auto graded'}</span></div>
                <details className="mt-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-950"><summary className="cursor-pointer text-xs font-semibold">Answer review</summary><div className="mt-2 space-y-2">{deliveredQuestions.map((question: any, index: number) => question.type === 'mcq' ? <div key={question.data.id} className="text-xs"><p className="font-medium">Q{index + 1}. {question.data.text}</p><p className="mt-1 text-slate-500">Submitted: {submission.answers?.[String(index)] == null ? 'No answer' : question.data.options[submission.answers[String(index)]]} · Correct: {question.data.options[question.data.correctIndex]}</p></div> : null)}</div></details>
                {Object.entries(submission.codingResults || {}).map(([questionIndex, rawResult]) => {
                  const result = typeof rawResult === 'number' ? { score: rawResult, results: [] } : rawResult as any;
                  return <details key={`judge-${questionIndex}`} className="mt-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-950"><summary className="cursor-pointer text-xs font-semibold">Judge0 results · Question {Number(questionIndex) + 1} · {result.passedTestCases ?? 0}/{result.totalTestCases ?? 0} tests · {result.score ?? 0} marks</summary><div className="mt-2 space-y-1 text-xs">{(result.results || []).map((test: any) => <p key={test.testCaseId} className={test.passed ? 'text-emerald-700' : 'text-rose-700'}>Case {test.testCaseId}{test.hidden ? ' (hidden)' : ''}: {test.status || (test.passed ? 'Passed' : 'Failed')}{test.expected !== undefined ? ` · Expected ${test.expected} · Got ${test.actual}` : ''}{test.error ? ` · ${test.error}` : ''}</p>)}</div></details>;
                })}
                {Object.entries(submission.codingAnswers || {}).map(([questionIndex, answer]) => <details key={questionIndex} className="mt-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-950"><summary className="cursor-pointer text-xs font-semibold">Coding answer · Question {Number(questionIndex) + 1} · {answer.language}</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs">{answer.code}</pre></details>)}
                <div className="mt-3 grid gap-3 sm:grid-cols-[9rem_1fr]"><label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Final score (/{submission.totalMarks})<input type="number" min={0} max={submission.totalMarks} step="0.5" value={draft.score} onChange={(event) => setDrafts((current) => ({ ...current, [submission.id]: { ...draft, score: event.target.value } }))} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" /></label><label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Feedback<textarea value={draft.feedback} onChange={(event) => setDrafts((current) => ({ ...current, [submission.id]: { ...draft, feedback: event.target.value } }))} maxLength={5000} rows={2} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" /></label></div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300"><input type="checkbox" checked={draft.releaseResults} onChange={(event) => setDrafts((current) => ({ ...current, [submission.id]: { ...draft, releaseResults: event.target.checked } }))} />Release result to student</label><button onClick={() => void saveReview(submission)} disabled={savingId === submission.id} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><Check size={14} />{savingId === submission.id ? 'Saving…' : 'Save review'}</button></div>
              </article>;
            })}</div>}
      </div>
    </section>
  </div>;
};
