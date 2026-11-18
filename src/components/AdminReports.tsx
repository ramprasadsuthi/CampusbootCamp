import React, { useEffect, useMemo, useState } from 'react';
import { Award, BarChart3, CalendarClock, Download, FileText, History, LoaderCircle, Search, Users, X } from 'lucide-react';
import { BatchInfo, StudentProfile } from '../types';
import { InterviewReportRow, InterviewReportResult, PlacementOutcomeHistoryRow, PlacementOutcomeRow, ReportActivityType, WorkspaceActivityRow } from '../types/reports';
import { fetchInterviewAnalytics, fetchPlacementOutcomeHistory, fetchPlacementOutcomeReport, fetchWorkspaceActivityReport } from '../services/api';
import { exportActivityReportCSV, exportBatchCSV, generateStudentReportPDF } from '../utils/pdfGenerator';

interface Props {
  students: StudentProfile[];
  batches: BatchInfo[];
  selectedStudent: StudentProfile;
  atRiskBelow: number;
  tierOneAtOrAbove: number;
}

const reportNames: Record<ReportActivityType, string> = {
  placement_readiness: 'Placement readiness',
  assessment_submitted: 'Assessment submissions',
  interview_scheduled: 'Scheduled interviews',
  interview_completed: 'Completed interview evaluations',
};

const tierNames: Record<string, string> = { all: 'All tiers', tier1: 'Tier 1 ready', tier2: 'Tier 2 ready', at_risk: 'At risk' };

export const AdminReports: React.FC<Props> = ({ students, batches, selectedStudent, atRiskBelow, tierOneAtOrAbove }) => {
  const [reportType, setReportType] = useState<ReportActivityType>('placement_readiness');
  const [batchId, setBatchId] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [tier, setTier] = useState('all');
  const [query, setQuery] = useState('');
  const [activities, setActivities] = useState<WorkspaceActivityRow[]>([]);
  const [activityTruncated, setActivityTruncated] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState('');

  const filteredStudents = useMemo(() => students.filter((student) => {
    const batch = batches.find((item) => item.id === student.batchId);
    const batchStartDate = batch?.startDate ? String(batch.startDate).slice(0, 10) : '';
    const matchesBatch = batchId === 'all' || student.batchId === batchId;
    const matchesDate = (!dateFrom && !dateTo) || (!!batchStartDate && (!dateFrom || batchStartDate >= dateFrom) && (!dateTo || batchStartDate <= dateTo));
    const matchesTier = tier === 'all'
      || (tier === 'tier1' && student.placementReadinessScore >= tierOneAtOrAbove)
      || (tier === 'tier2' && student.placementReadinessScore >= atRiskBelow && student.placementReadinessScore < tierOneAtOrAbove)
      || (tier === 'at_risk' && student.placementReadinessScore < atRiskBelow);
    const needle = query.trim().toLowerCase();
    const matchesQuery = !needle || [student.name, student.email, student.rollNo, student.batch].some((value) => String(value || '').toLowerCase().includes(needle));
    return matchesBatch && matchesDate && matchesTier && matchesQuery;
  }), [students, batches, batchId, dateFrom, dateTo, tier, query, atRiskBelow, tierOneAtOrAbove]);

  useEffect(() => {
    if (reportType === 'placement_readiness') {
      setActivities([]);
      setActivityTruncated(false);
      setActivityError('');
      setActivityLoading(false);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setActivityLoading(true);
      setActivityError('');
      fetchWorkspaceActivityReport({ activityType: reportType, batchId, dateFrom, dateTo, tier, query })
        .then((result) => {
          if (!active) return;
          setActivities(result.rows);
          setActivityTruncated(result.truncated);
        })
        .catch((error) => {
          if (!active) return;
          setActivities([]);
          setActivityError(error instanceof Error ? error.message : 'Could not load activity report data.');
        })
        .finally(() => { if (active) setActivityLoading(false); });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [reportType, batchId, dateFrom, dateTo, tier, query]);

  const isReadinessReport = reportType === 'placement_readiness';
  const dateBasis = reportType === 'placement_readiness'
    ? 'Batch start date'
    : reportType === 'assessment_submitted'
      ? 'Assessment submission timestamp (UTC)'
      : reportType === 'interview_scheduled'
        ? 'Interview scheduled timestamp (UTC; cancelled appointments excluded)'
        : 'Interview evaluation date';
  const dateFromLabel = reportType === 'placement_readiness' ? 'Batch started from' : 'Activity date from';
  const dateToLabel = reportType === 'placement_readiness' ? 'Batch started to' : 'Activity date to';
  const selectedBatchName = batchId === 'all' ? 'All batches' : batches.find((batch) => batch.id === batchId)?.name || 'Selected batch';
  const criteria: Array<[string, string]> = [
    ['Activity date basis', dateBasis],
    ['Batch', selectedBatchName],
    ['Readiness tier', tierNames[tier] || tier],
    ['Student or activity search', query.trim() || 'All'],
    ['Date from', dateFrom || 'Any'],
    ['Date to', dateTo || 'Any'],
    ['Readiness calculation', `Current profile score; Tier 1 >= ${tierOneAtOrAbove}%, at risk < ${atRiskBelow}%`],
    ['Batch rule', 'Uses each student’s current batch assignment'],
  ];

  const averageReadiness = filteredStudents.length
    ? Math.round(filteredStudents.reduce((sum, student) => sum + Number(student.placementReadinessScore || 0), 0) / filteredStudents.length)
    : 0;
  const averageActivityScore = (() => {
    const scores = activities.map((activity) => activity.score).filter((score): score is number => score !== null && Number.isFinite(Number(score)));
    return scores.length ? Math.round(scores.reduce((sum, score) => sum + Number(score), 0) / scores.length) : null;
  })();
  const uniqueActivityStudents = new Set(activities.map((activity) => activity.studentId)).size;

  const handleExport = () => {
    if (isReadinessReport) {
      exportBatchCSV(batchId === 'all' ? 'Workspace' : selectedBatchName, filteredStudents, criteria);
    } else {
      exportActivityReportCSV(reportNames[reportType], activities, criteria);
    }
  };

  const clearFilters = () => { setBatchId('all'); setDateFrom(''); setDateTo(''); setTier('all'); setQuery(''); };

  return <div className="space-y-6 animate-fadeIn">
    <section className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-widest text-indigo-600">Workspace reporting</p><h1 className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-white">Reports &amp; Export</h1><p className="mt-2 max-w-3xl text-sm text-slate-500">Build a readiness snapshot or review dated assessment and interview activity. The selected report type defines which event date the date range filters.</p></div>
        <button disabled={isReadinessReport ? !filteredStudents.length : activityLoading || !activities.length} onClick={handleExport} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"><Download size={16}/> Export filtered CSV</button>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 xl:col-span-2">Report type<select value={reportType} onChange={(event) => setReportType(event.target.value as ReportActivityType)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950">{Object.entries(reportNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 xl:col-span-2">Batch<select value={batchId} onChange={(event) => setBatchId(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"><option value="all">All batches</option>{batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.name}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">{dateFromLabel}<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"/></label>
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">{dateToLabel}<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"/></label>
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Readiness tier<select value={tier} onChange={(event) => setTier(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"><option value="all">All tiers</option><option value="tier1">Tier 1 ready</option><option value="tier2">Tier 2 ready</option><option value="at_risk">At risk</option></select></label>
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 xl:col-span-2">Find student{!isReadinessReport ? ' or activity' : ''}<div className="relative mt-1.5"><Search size={15} className="absolute left-3 top-3 text-slate-400"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={isReadinessReport ? 'Name, email, roll no' : 'Student, roll no, assessment'} className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950"/></div></label>
      </div>
      <button onClick={clearFilters} className="mt-3 text-xs font-bold text-indigo-600 hover:text-indigo-700">Clear filters</button>
      <p className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:bg-slate-950 dark:text-slate-300"><strong>Date basis:</strong> {dateBasis}. <strong>Readiness tier:</strong> uses each student’s current profile score, not their score at the time of the event. <strong>Batch:</strong> uses the student’s current batch assignment.</p>

      {isReadinessReport
        ? <div className="mt-5 grid gap-3 sm:grid-cols-3"><Metric label="Students matched" value={filteredStudents.length.toLocaleString()} icon={<Users size={17}/>} /><Metric label="Average readiness" value={`${averageReadiness}%`} icon={<FileText size={17}/>} /><Metric label="At risk" value={filteredStudents.filter((student) => student.placementReadinessScore < atRiskBelow).length.toLocaleString()} icon={<Users size={17}/>} /></div>
        : <div className="mt-5 grid gap-3 sm:grid-cols-3"><Metric label="Activities matched" value={activityLoading ? '…' : activities.length.toLocaleString()} icon={<FileText size={17}/>} /><Metric label="Students represented" value={activityLoading ? '…' : uniqueActivityStudents.toLocaleString()} icon={<Users size={17}/>} /><Metric label="Average activity score" value={activityLoading ? '…' : averageActivityScore === null ? '—' : `${averageActivityScore}%`} icon={<FileText size={17}/>} /></div>}
    </section>

    {isReadinessReport ? <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-800"><div><h2 className="font-bold text-slate-900 dark:text-white">Student readiness report</h2><p className="text-xs text-slate-500">Showing {filteredStudents.length} of {students.length} students · readiness is the current profile snapshot</p></div><button disabled={!selectedStudent.id} onClick={() => generateStudentReportPDF(selectedStudent)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200">Export selected student PDF</button></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-950"><tr>{['Student','Roll no','Batch','Day','Attendance','Readiness','Status'].map((heading) => <th key={heading} className="px-4 py-3 font-bold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{filteredStudents.slice(0, 100).map((student) => <tr key={student.id}><td className="px-4 py-3"><div className="font-semibold text-slate-900 dark:text-white">{student.name}</div><div className="text-xs text-slate-500">{student.email}</div></td><td className="px-4 py-3">{student.rollNo || '—'}</td><td className="px-4 py-3">{student.batch || 'Unassigned'}</td><td className="px-4 py-3">{student.currentDay || 0}/40</td><td className="px-4 py-3">{Math.round(Number(student.attendancePercent || 0))}%</td><td className="px-4 py-3 font-semibold">{Math.round(Number(student.placementReadinessScore || 0))}%</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${student.placementReadinessScore >= tierOneAtOrAbove ? 'bg-emerald-50 text-emerald-700' : student.placementReadinessScore >= atRiskBelow ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>{student.placementReadinessScore >= tierOneAtOrAbove ? 'Tier 1 ready' : student.placementReadinessScore >= atRiskBelow ? 'Tier 2 ready' : 'At risk'}</span></td></tr>)}{filteredStudents.length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-500">No students match these filters.</td></tr>}</tbody></table></div>
      {filteredStudents.length > 100 && <p className="p-3 text-center text-xs text-slate-500">Showing first 100 rows. CSV export contains all {filteredStudents.length} matching students.</p>}
    </section> : <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-100 p-4 dark:border-slate-800"><h2 className="font-bold text-slate-900 dark:text-white">{reportNames[reportType]}</h2><p className="text-xs text-slate-500">Activity records are workspace-scoped. CSV includes the selected filters and date definition.</p></div>
      {activityError && <p role="alert" className="m-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{activityError}</p>}
      {activityLoading ? <div role="status" className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin"/>Loading activity records…</div> : <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-950"><tr>{['Date','Activity','Student','Roll no','Batch','Score','Current readiness','Outcome'].map((heading) => <th key={heading} className="px-4 py-3 font-bold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{activities.map((activity) => <tr key={`${activity.activityType}-${activity.id}`}><td className="whitespace-nowrap px-4 py-3">{activity.activityDate}</td><td className="px-4 py-3"><div className="font-semibold text-slate-900 dark:text-white">{activity.activityName}</div><div className="text-[11px] text-slate-500">{activity.activityType.replaceAll('_', ' ')}</div></td><td className="px-4 py-3">{activity.studentName}</td><td className="px-4 py-3">{activity.rollNo || '—'}</td><td className="px-4 py-3">{activity.batchName}</td><td className="px-4 py-3">{activity.score === null ? '—' : `${Math.round(Number(activity.score))}%`}</td><td className="px-4 py-3">{Math.round(Number(activity.readinessScore))}%</td><td className="px-4 py-3">{activity.outcome}</td></tr>)}{activities.length === 0 && !activityError && <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-500">No activity records match these filters.</td></tr>}</tbody></table></div>}
      {activityTruncated && <p className="border-t border-slate-100 p-3 text-center text-xs text-amber-700 dark:border-slate-800 dark:text-amber-300">Showing and exporting the latest 1,000 matching activity records. Narrow the date range or batch to reduce the results.</p>}
    </section>}
    <InterviewAnalytics batches={batches} />
    <PlacementOutcomes batches={batches} />
  </div>;
};

const lifecycleNames: Record<string, string> = { all: 'All lifecycle states', scheduled: 'Scheduled', awaiting_evaluation: 'Awaiting evaluation', completed: 'Completed', cancelled: 'Cancelled' };
const typeNames: Record<string, string> = { tech: 'Technical', hr: 'HR / behavioral' };
const followUpNames: Record<string, string> = { needs_another_interview: 'Needs another interview', referred_for_placement: 'Referred for placement', offer_confirmed: 'Offer confirmed', no_further_action: 'No further action' };

const PlacementOutcomes: React.FC<{ batches: BatchInfo[] }> = ({ batches }) => {
  const [batchId, setBatchId] = useState('all');
  const [outcome, setOutcome] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [rows, setRows] = useState<PlacementOutcomeRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [historyFor, setHistoryFor] = useState<PlacementOutcomeRow | null>(null);
  const [history, setHistory] = useState<PlacementOutcomeHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true); setError('');
      fetchPlacementOutcomeReport({ batchId, outcome, dateFrom, dateTo })
        .then((result) => { if (active) { setRows(result.rows); setTruncated(result.truncated); } })
        .catch((reason) => { if (active) { setRows([]); setError(reason instanceof Error ? reason.message : 'Could not load placement outcome records.'); } })
        .finally(() => { if (active) setLoading(false); });
    }, 150);
    return () => { active = false; window.clearTimeout(timer); };
  }, [batchId, outcome, dateFrom, dateTo]);

  const openHistory = async (row: PlacementOutcomeRow) => {
    setHistoryFor(row); setHistory([]); setHistoryError(''); setHistoryLoading(true);
    try { setHistory(await fetchPlacementOutcomeHistory(row.scheduleId)); }
    catch (reason) { setHistoryError(reason instanceof Error ? reason.message : 'Could not load outcome history.'); }
    finally { setHistoryLoading(false); }
  };
  const exportCsv = () => {
    const columns = ['Student', 'Email', 'Roll number', 'Batch', 'Interview type', 'Interview date (UTC)', 'Placement outcome', 'Last updated (UTC)', 'Admin-only notes', 'Student-facing notes'];
    const csvRows = [columns, ...rows.map((row) => [row.studentName, row.email, row.rollNo, row.batchName, typeNames[row.interviewType] || row.interviewType, row.interviewDate, followUpNames[row.outcome], row.updatedAt, row.adminNotes, row.studentNotes])];
    const csv = csvRows.map((line) => line.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `placement-outcomes-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const counts = rows.reduce((acc, row) => { acc[row.outcome] = (acc[row.outcome] || 0) + 1; return acc; }, {} as Record<string, number>);

  return <section className="space-y-5 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-7">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-emerald-600">Placement follow-up</p><h2 className="mt-1 text-xl font-extrabold text-slate-900 dark:text-white">Student placement outcomes</h2><p className="mt-1 text-sm text-slate-500">Current status is based on each student’s current batch assignment. Date filters use the latest status update time (UTC).</p></div><button onClick={exportCsv} disabled={!rows.length || loading} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"><Download size={16}/> Export outcomes CSV</button></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><FilterSelect label="Batch" value={batchId} onChange={setBatchId}><option value="all">All batches</option>{batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.name}</option>)}</FilterSelect><FilterSelect label="Outcome" value={outcome} onChange={setOutcome}><option value="all">All outcomes</option>{Object.entries(followUpNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</FilterSelect><FilterDate label="Updated from" value={dateFrom} onChange={setDateFrom}/><FilterDate label="Updated to" value={dateTo} onChange={setDateTo}/></div>
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(followUpNames).map(([key, label]) => <Metric key={key} label={label} value={loading ? '…' : String(counts[key] || 0)} icon={<Users size={17}/>}/>)}</div>
    <div className="overflow-x-auto rounded-2xl border border-slate-100 dark:border-slate-800"><table className="w-full min-w-[1000px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-950"><tr>{['Student','Batch','Interview','Outcome','Last updated (UTC)','Student notes','History'].map((heading) => <th key={heading} className="px-3 py-3 font-bold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{rows.map((row) => <tr key={row.scheduleId}><td className="px-3 py-3"><div className="font-semibold text-slate-900 dark:text-white">{row.studentName}</div><div className="text-xs text-slate-500">{row.rollNo || row.email}</div></td><td className="px-3 py-3">{row.batchName}</td><td className="px-3 py-3">{typeNames[row.interviewType]} · {row.interviewDate}</td><td className="px-3 py-3"><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{followUpNames[row.outcome]}</span></td><td className="whitespace-nowrap px-3 py-3">{row.updatedAt}</td><td className="max-w-[250px] truncate px-3 py-3 text-slate-600 dark:text-slate-300" title={row.studentNotes}>{row.studentNotes || '—'}</td><td className="px-3 py-3"><button onClick={() => void openHistory(row)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 dark:border-slate-700 dark:text-indigo-300"><History size={14}/>History ({row.historyCount})</button></td></tr>)}{!loading && rows.length === 0 && <tr><td colSpan={7} className="p-10 text-center text-slate-500">No placement outcomes match these filters.</td></tr>}{loading && <tr><td colSpan={7} className="p-8 text-center text-slate-500"><LoaderCircle size={16} className="mx-auto animate-spin"/></td></tr>}</tbody></table>{truncated && <p className="border-t border-slate-100 p-3 text-center text-xs text-amber-700 dark:border-slate-800 dark:text-amber-300">Showing the latest 5,000 matching outcomes.</p>}</div>
    {historyFor && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setHistoryFor(null); }}><section role="dialog" aria-modal="true" aria-labelledby="placement-history-title" className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-slate-900"><header className="sticky top-0 flex items-start justify-between border-b border-slate-100 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><div><p className="text-xs font-bold uppercase tracking-wide text-indigo-600">Placement outcome history</p><h3 id="placement-history-title" className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white">{historyFor.studentName}</h3><p className="text-xs text-slate-500">{historyFor.batchName} · {typeNames[historyFor.interviewType]} interview</p></div><button onClick={() => setHistoryFor(null)} aria-label="Close history" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={18}/></button></header><div className="space-y-3 p-5">{historyError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{historyError}</p>}{historyLoading ? <p className="py-8 text-center text-sm text-slate-500">Loading history…</p> : history.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No saved history was found.</p> : history.map((item) => <article key={item.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><div className="flex flex-wrap items-center justify-between gap-2"><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{followUpNames[item.outcome]}</span><span className="text-xs text-slate-500">{item.createdAt} · {item.updatedBy}</span></div>{item.notes && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200"><strong>Admin notes:</strong> {item.notes}</p>}{item.studentNotes && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200"><strong>Student-facing notes:</strong> {item.studentNotes}</p>}</article>)}</div></section></div>}
  </section>;
};

const InterviewAnalytics: React.FC<{ batches: BatchInfo[] }> = ({ batches }) => {
  const [batchId, setBatchId] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [interviewType, setInterviewType] = useState('all');
  const [panelistId, setPanelistId] = useState('all');
  const [lifecycle, setLifecycle] = useState('all');
  const [followUp, setFollowUp] = useState('all');
  const [panelists, setPanelists] = useState<Array<{ id: string; name: string; isActive: boolean }>>([]);
  const [result, setResult] = useState<InterviewReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/interview-panelists').then(async (response) => {
      if (!response.ok) throw new Error('Could not load interview panelists.');
      return response.json();
    }).then((rows) => setPanelists(rows)).catch(() => setPanelists([]));
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      fetchInterviewAnalytics({ batchId, dateFrom, dateTo, interviewType, panelistId, lifecycle, followUp })
        .then((data) => { if (active) setResult(data); })
        .catch((reason) => { if (active) { setResult(null); setError(reason instanceof Error ? reason.message : 'Could not load interview analytics.'); } })
        .finally(() => { if (active) setLoading(false); });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [batchId, dateFrom, dateTo, interviewType, panelistId, lifecycle, followUp]);

  const exportCsv = () => {
    if (!result) return;
    const columns = ['Student', 'Roll number', 'Batch', 'Interview type', 'Scheduled at (UTC)', 'Duration (minutes)', 'Panelist', 'Lifecycle', 'Score', 'Recommendation', 'Evaluation date (UTC)', 'Follow-up outcome', 'Admin-only follow-up notes', 'Student-facing notes'];
    const lines = [columns, ...result.interviews.map((row) => [row.studentName, row.rollNo, row.batchName, typeNames[row.interviewType] || row.interviewType, row.scheduledAt, row.durationMinutes, row.panelist, lifecycleNames[row.lifecycle], row.evaluationScore ?? '', row.recommendation || '', row.evaluationDate || '', followUpNames[row.followUpOutcome || ''] || 'Not recorded', row.followUpNotes || '', row.followUpStudentNotes || ''])];
    const csv = lines.map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `interview-report-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const summary = result?.summary;
  const recs = result?.recommendations;
  const recTotal = recs ? recs.hire + recs.borderline + recs.needImprovement + recs.unrecorded : 0;
  return <section className="space-y-5 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-7">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-bold uppercase tracking-widest text-indigo-600">Interview operations</p><h2 className="mt-1 text-xl font-extrabold text-slate-900 dark:text-white">Interview reporting &amp; analytics</h2><p className="mt-1 text-sm text-slate-500">Filter schedules and evaluations for this workspace. Appointment dates are shown in UTC.</p></div>
      <button onClick={exportCsv} disabled={!result?.interviews.length || loading} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"><Download size={16}/> Export interview CSV</button>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
      <FilterSelect label="Batch" value={batchId} onChange={setBatchId}><option value="all">All batches</option>{batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.name}</option>)}</FilterSelect>
      <FilterSelect label="Interview type" value={interviewType} onChange={setInterviewType}><option value="all">All types</option><option value="tech">Technical</option><option value="hr">HR / behavioral</option></FilterSelect>
      <FilterSelect label="Panelist" value={panelistId} onChange={setPanelistId}><option value="all">All panelists</option>{panelists.map((panelist) => <option key={panelist.id} value={panelist.id}>{panelist.name}{!panelist.isActive ? ' (inactive)' : ''}</option>)}</FilterSelect>
      <FilterSelect label="Lifecycle" value={lifecycle} onChange={setLifecycle}>{Object.entries(lifecycleNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</FilterSelect>
      <FilterSelect label="Follow-up" value={followUp} onChange={setFollowUp}><option value="all">All follow-ups</option><option value="unset">Not recorded</option>{Object.entries(followUpNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</FilterSelect>
      <FilterDate label="Scheduled from" value={dateFrom} onChange={setDateFrom}/><FilterDate label="Scheduled to" value={dateTo} onChange={setDateTo}/>
    </div>
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <Metric label="Matching interviews" value={loading ? '…' : String(summary?.total ?? 0)} icon={<CalendarClock size={17}/>}/>
      <Metric label="Scheduled" value={loading ? '…' : String(summary?.scheduled ?? 0)} icon={<CalendarClock size={17}/>}/>
      <Metric label="Awaiting evaluation" value={loading ? '…' : String(summary?.awaitingEvaluation ?? 0)} icon={<FileText size={17}/>}/>
      <Metric label="Completed" value={loading ? '…' : String(summary?.completed ?? 0)} icon={<Users size={17}/>}/>
      <Metric label="Cancelled" value={loading ? '…' : String(summary?.cancelled ?? 0)} icon={<Users size={17}/>}/>
      <Metric label="Average evaluation score" value={loading ? '…' : summary?.averageScore == null ? '—' : `${summary.averageScore}%`} icon={<Award size={17}/>}/>
    </div>
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
      <div className="mb-3 flex items-center gap-2 font-bold text-slate-800 dark:text-slate-100"><BarChart3 size={17} className="text-indigo-600"/> Recommendation breakdown <span className="text-xs font-normal text-slate-500">({recTotal} completed)</span></div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{[
        ['Hire', recs?.hire ?? 0, 'bg-emerald-500'], ['Borderline', recs?.borderline ?? 0, 'bg-amber-500'], ['Need improvement', recs?.needImprovement ?? 0, 'bg-rose-500'], ['Not recorded', recs?.unrecorded ?? 0, 'bg-slate-400'],
      ].map(([label, count, color]) => <div key={String(label)} className="rounded-xl bg-white p-3 dark:bg-slate-900"><div className="flex justify-between text-sm"><span>{label}</span><strong>{loading ? '…' : count}</strong></div><div className="mt-2 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800"><div className={`h-full rounded-full ${color}`} style={{ width: `${recTotal ? Number(count) / recTotal * 100 : 0}%` }}/></div></div>)}</div>
    </div>
    <div className="overflow-x-auto rounded-2xl border border-slate-100 dark:border-slate-800">
      <table className="w-full min-w-[1250px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-950"><tr>{['Student','Roll no','Batch','Type','Scheduled (UTC)','Panelist','Lifecycle','Score','Recommendation','Follow-up outcome'].map((heading) => <th key={heading} className="px-3 py-3 font-bold">{heading}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{result?.interviews.map((row: InterviewReportRow) => <tr key={row.id}><td className="px-3 py-3 font-semibold text-slate-900 dark:text-white">{row.studentName}</td><td className="px-3 py-3">{row.rollNo || '—'}</td><td className="px-3 py-3">{row.batchName}</td><td className="px-3 py-3">{typeNames[row.interviewType] || row.interviewType}</td><td className="whitespace-nowrap px-3 py-3">{row.scheduledAt}</td><td className="px-3 py-3">{row.panelist}</td><td className="px-3 py-3"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold dark:bg-slate-800">{lifecycleNames[row.lifecycle]}</span></td><td className="px-3 py-3">{row.evaluationScore == null ? '—' : `${row.evaluationScore}%`}</td><td className="px-3 py-3">{row.recommendation || '—'}</td><td className="px-3 py-3">{followUpNames[row.followUpOutcome || ''] || 'Not recorded'}</td></tr>)}{!loading && result?.interviews.length === 0 && <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-500">No interviews match these filters.</td></tr>}{loading && <tr><td colSpan={10} className="p-8 text-center text-slate-500"><span className="inline-flex items-center gap-2"><LoaderCircle size={16} className="animate-spin"/>Loading interview report…</span></td></tr>}</tbody>
      </table>
      {result?.truncated && <p className="border-t border-slate-100 p-3 text-center text-xs text-amber-700 dark:border-slate-800 dark:text-amber-300">Showing and exporting the latest 5,000 interviews. Narrow the filters to focus the report.</p>}
    </div>
  </section>;
};

const FilterSelect: React.FC<{ label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }> = ({ label, value, onChange, children }) => <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950">{children}</select></label>;
const FilterDate: React.FC<{ label: string; value: string; onChange: (value: string) => void }> = ({ label, value, onChange }) => <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">{label}<input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"/></label>;

const Metric: React.FC<{ label: string; value: string; icon: React.ReactNode }> = ({ label, value, icon }) => <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950"><div className="rounded-lg bg-indigo-100 p-2 text-indigo-600 dark:bg-indigo-950">{icon}</div><div><p className="text-xs text-slate-500">{label}</p><p className="text-lg font-extrabold text-slate-900 dark:text-white">{value}</p></div></div>;
