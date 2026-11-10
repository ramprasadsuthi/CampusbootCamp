import React, { FormEvent, useState } from 'react';
import {
  Users,
  Layers,
  Search,
  Download,
  CheckCircle2,
  Plus,
  Pencil,
  Archive,
  X,
} from 'lucide-react';
import { exportBatchCSV, generateStudentReportPDF } from '../utils/pdfGenerator';
import { BatchInfo, StudentProfile } from '../types';

interface BatchManagerProps {
  students: StudentProfile[];
  batches: BatchInfo[];
  trainers: Array<{ id: string; name: string; email: string }>;
  canManage: boolean;
  onCreateBatch: (params: { name: string; trainerUserId?: string; startDate: string; completionDate: string }) => Promise<void>;
  onUpdateBatch: (id: string, params: { name?: string; trainerUserId?: string | null; startDate?: string; completionDate?: string; currentDay?: number; isArchived?: boolean }) => Promise<void>;
  onAssignStudent: (studentId: string, batchId: string | null) => Promise<void>;
  onSelectStudent: (student: StudentProfile) => void;
  onNavigateToProfile: () => void;
}

export const BatchManager: React.FC<BatchManagerProps> = ({
  students,
  batches,
  trainers,
  canManage,
  onCreateBatch,
  onUpdateBatch,
  onAssignStudent,
  onSelectStudent,
  onNavigateToProfile,
}) => {
  const [selectedBatchId, setSelectedBatchId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [batchEditor, setBatchEditor] = useState<BatchInfo | 'new' | null>(null);
  const [batchName, setBatchName] = useState('');
  const [trainerUserId, setTrainerUserId] = useState('');
  const [batchStartDate, setBatchStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [batchCompletionDate, setBatchCompletionDate] = useState(() => { const date = new Date(); date.setDate(date.getDate() + 40); return date.toISOString().slice(0, 10); });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Filter students
  const filteredStudents = students.filter((s) => {
    const matchesBatch =
      selectedBatchId === 'all' || s.batchId === selectedBatchId;
    const matchesTier =
      tierFilter === 'all' ||
      (tierFilter === 'tier1' && s.placementReadinessScore >= 80) ||
      (tierFilter === 'tier2' && s.placementReadinessScore >= 65 && s.placementReadinessScore < 80) ||
      (tierFilter === 'at_risk' && s.placementReadinessScore < 65);
    const matchesSearch =
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.rollNo.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.branch.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.college.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesBatch && matchesTier && matchesSearch;
  });

  const handleExportBatch = (batch: BatchInfo) => {
    const batchStudents = students.filter((s) => s.batchId === batch.id);
    exportBatchCSV(batch.name, batchStudents.length > 0 ? batchStudents : students);
  };

  const openCreateBatch = () => {
    setBatchName('');
    setTrainerUserId('');
    setBatchStartDate(new Date().toISOString().slice(0, 10));
    const finish = new Date(); finish.setDate(finish.getDate() + 40);
    setBatchCompletionDate(finish.toISOString().slice(0, 10));
    setFormError('');
    setBatchEditor('new');
  };

  const openEditBatch = (batch: BatchInfo) => {
    setBatchName(batch.name);
    setTrainerUserId(batch.trainerUserId || '');
    setBatchStartDate(batch.startDate);
    setBatchCompletionDate(batch.endDate);
    setFormError('');
    setBatchEditor(batch);
  };

  const submitBatch = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      if (batchEditor === 'new') await onCreateBatch({ name: batchName, trainerUserId: trainerUserId || undefined, startDate: batchStartDate, completionDate: batchCompletionDate });
      else if (batchEditor) await onUpdateBatch(batchEditor.id, { name: batchName, trainerUserId: trainerUserId || null, startDate: batchStartDate, completionDate: batchCompletionDate });
      setBatchEditor(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not save batch.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-xs font-bold mb-2">
            <Layers className="w-3.5 h-3.5" />
            <span>Institutional Management Directory</span>
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Batches & Enrolled Candidates
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Monitor batch-level velocity, student clearance percentages, attendance metrics, and export candidate dossiers.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canManage && <button onClick={openCreateBatch} className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700"><Plus className="h-4 w-4" /><span>Create batch</span></button>}
          <button
            onClick={() => exportBatchCSV('Full_Campus_Bootcamp', students)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold transition-all cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Master CSV</span>
          </button>
        </div>
      </div>

      {/* Batch Overview Cards */}
      {batches.length === 0 && <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">No batches are assigned to this workspace yet.</div>}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {batches.map((batch) => (
          <div
            key={batch.id}
            className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">
                  {batch.name}
                </span>
                <span className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Active Sprint
                </span>
                {canManage && <div className="flex"><button onClick={() => openEditBatch(batch)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-800" title="Edit batch"><Pencil className="h-3.5 w-3.5" /></button><button onClick={() => void onUpdateBatch(batch.id, { isArchived: true }).catch((error) => window.alert(error instanceof Error ? error.message : 'Could not archive batch.'))} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30" title="Archive batch"><Archive className="h-3.5 w-3.5" /></button></div>}
              </div>

              <h3 className="text-sm font-bold text-slate-900 dark:text-white line-clamp-1">
                {batch.college}
              </h3>
              <p className="text-[11px] text-slate-400 mt-1">Trainer: {batch.trainer || 'Unassigned'}</p>

              {/* Batch KPI Row */}
              <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-center">
                <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                  <span className="text-[10px] text-slate-400 font-medium block">Students</span>
                  <span className="text-xs font-extrabold text-slate-800 dark:text-slate-200">
                    {batch.totalStudents}
                  </span>
                </div>
                <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                  <span className="text-[10px] text-slate-400 font-medium block">Avg Score</span>
                  <span className="text-xs font-extrabold text-indigo-600 dark:text-indigo-400">
                    {batch.avgReadiness}%
                  </span>
                </div>
                <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                  <span className="text-[10px] text-slate-400 font-medium block">Tier 1 Ready</span>
                  <span className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400">
                    {batch.tier1ReadyPercent}%
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
              <button
                onClick={() => setSelectedBatchId(batch.id)}
                className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Filter Batch Candidates
              </button>
              <button
                onClick={() => handleExportBatch(batch)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                title="Download CSV"
              >
                <Download className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Student Directory Table with Filters */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Student Directory ({filteredStudents.length})
            </h2>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search candidate or roll no..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-3 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
              />
            </div>

            <select
              value={selectedBatchId}
              onChange={(e) => setSelectedBatchId(e.target.value)}
              className="text-xs font-medium px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
            >
              <option value="all">All Batches</option>
              {batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.name}</option>)}
            </select>

            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value)}
              className="text-xs font-medium px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
            >
              <option value="all">All Readiness Tiers</option>
              <option value="tier1">Tier 1 Ready (≥80%)</option>
              <option value="tier2">Tier 2 Ready (65-79%)</option>
              <option value="at_risk">At Risk (&lt;65%)</option>
            </select>
          </div>
        </div>

        {/* Responsive Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-bold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">Candidate</th>
                <th className="py-3 px-4">Roll No</th>
                <th className="py-3 px-4">Batch</th>
                <th className="py-3 px-4">Coding Score</th>
                <th className="py-3 px-4">Aptitude Score</th>
                <th className="py-3 px-4">Interview</th>
                <th className="py-3 px-4">Overall Readiness</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredStudents.map((st) => (
                <tr
                  key={st.id}
                  className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      <img
                        src={st.photo}
                        alt={st.name}
                        className="w-8 h-8 rounded-full object-cover border border-slate-200"
                      />
                      <div>
                        <span className="font-bold text-slate-900 dark:text-white block">
                          {st.name}
                        </span>
                        <span className="text-[11px] text-slate-400">{st.branch}</span>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 font-mono font-medium text-slate-600 dark:text-slate-300">
                    {st.rollNo}
                  </td>
                  <td className="py-3 px-4 font-semibold text-slate-700 dark:text-slate-300">
                    {canManage ? <select value={st.batchId || ''} onChange={(event) => void onAssignStudent(st.id, event.target.value || null).catch((error) => window.alert(error instanceof Error ? error.message : 'Could not assign student.'))} className="max-w-36 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800"><option value="">Unassigned</option>{batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.name}</option>)}</select> : (batches.find((batch) => batch.id === st.batchId)?.name || st.batch)}
                  </td>
                  <td className="py-3 px-4 font-extrabold text-indigo-600 dark:text-indigo-400">
                    {st.metrics.coding}%
                  </td>
                  <td className="py-3 px-4 font-extrabold text-blue-600 dark:text-blue-400">
                    {st.metrics.aptitude}%
                  </td>
                  <td className="py-3 px-4 font-extrabold text-emerald-600 dark:text-emerald-400">
                    {st.metrics.techInterview}%
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-slate-900 dark:text-white">
                        {st.placementReadinessScore}%
                      </span>
                      <div className="w-16 bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-indigo-600 h-full rounded-full"
                          style={{ width: `${st.placementReadinessScore}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                        st.placementReadinessScore >= 80
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : st.placementReadinessScore >= 65
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                          : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                      }`}
                    >
                      {st.placementReadinessScore >= 80
                        ? 'Tier 1 Ready'
                        : st.placementReadinessScore >= 65
                        ? 'Tier 2 Ready'
                        : 'At Risk'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => {
                          onSelectStudent(st);
                          onNavigateToProfile();
                        }}
                        className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 font-bold transition-colors cursor-pointer"
                      >
                        Inspect
                      </button>
                      <button
                        onClick={() => generateStudentReportPDF(st)}
                        className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                        title="Download Dossier"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {batchEditor && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"><form onSubmit={submitBatch} className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900"><div className="flex items-center justify-between"><h2 className="text-lg font-bold text-slate-900 dark:text-white">{batchEditor === 'new' ? 'Create batch' : 'Edit batch'}</h2><button type="button" onClick={() => setBatchEditor(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button></div><label className="block space-y-1 text-xs font-semibold text-slate-600 dark:text-slate-300">Batch name<input required maxLength={120} value={batchName} onChange={(event) => setBatchName(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800" /></label><label className="block space-y-1 text-xs font-semibold text-slate-600 dark:text-slate-300">Trainer<select value={trainerUserId} onChange={(event) => setTrainerUserId(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"><option value="">Unassigned</option>{trainers.map((trainer) => <option key={trainer.id} value={trainer.id}>{trainer.name} ({trainer.email})</option>)}</select></label><div className="grid grid-cols-2 gap-3"><label className="space-y-1 text-xs font-semibold text-slate-600 dark:text-slate-300">Start date<input type="date" required value={batchStartDate} onChange={(event) => setBatchStartDate(event.target.value)} className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800" /></label><label className="space-y-1 text-xs font-semibold text-slate-600 dark:text-slate-300">Completion date<input type="date" required value={batchCompletionDate} onChange={(event) => setBatchCompletionDate(event.target.value)} className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800" /></label></div>{formError && <p className="text-sm text-rose-600">{formError}</p>}<div className="flex justify-end gap-2"><button type="button" onClick={() => setBatchEditor(null)} className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">Cancel</button><button disabled={saving} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save batch'}</button></div></form></div>}
    </div>
  );
};
