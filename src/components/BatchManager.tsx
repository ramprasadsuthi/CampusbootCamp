import React, { useState } from 'react';
import {
  Users,
  Layers,
  Search,
  Filter,
  Download,
  Plus,
  Building,
  GraduationCap,
  Calendar,
  CheckCircle2,
  ChevronRight,
  TrendingUp,
  UserCheck,
  Award,
} from 'lucide-react';
import { BATCHES_DATA } from '../data/mockData';
import { exportBatchCSV, generateStudentReportPDF } from '../utils/pdfGenerator';
import { BatchInfo, StudentProfile } from '../types';

interface BatchManagerProps {
  students: StudentProfile[];
  onSelectStudent: (student: StudentProfile) => void;
  onNavigateToProfile: () => void;
}

export const BatchManager: React.FC<BatchManagerProps> = ({
  students,
  onSelectStudent,
  onNavigateToProfile,
}) => {
  const [batches, setBatches] = useState<BatchInfo[]>(BATCHES_DATA);
  const [selectedBatchId, setSelectedBatchId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [showAddBatchModal, setShowAddBatchModal] = useState<boolean>(false);
  const [newBatchName, setNewBatchName] = useState<string>('');
  const [newCollegeName, setNewCollegeName] = useState<string>('National Institute of Technology');

  // Filter students
  const filteredStudents = students.filter((s) => {
    const matchesBatch =
      selectedBatchId === 'all' || s.batch.toLowerCase().includes(selectedBatchId.toLowerCase());
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
    const batchStudents = students.filter((s) => s.batch === batch.name);
    exportBatchCSV(batch.name, batchStudents.length > 0 ? batchStudents : students);
  };

  const handleAddBatch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBatchName) return;

    const newB: BatchInfo = {
      id: `batch-${Date.now()}`,
      name: newBatchName,
      college: newCollegeName,
      department: 'Computer Science & Engineering',
      trainer: 'Prof. Rajesh Sharma',
      totalStudents: 120,
      activeStudents: 118,
      avgAttendance: 95.0,
      avgReadiness: 78.5,
      tier1ReadyPercent: 72,
      tier2ReadyPercent: 20,
      atRiskPercent: 8,
      startDate: '2026-08-01',
      endDate: '2026-09-10',
    };

    setBatches((prev) => [newB, ...prev]);
    setNewBatchName('');
    setShowAddBatchModal(false);
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
          <button
            onClick={() => exportBatchCSV('Full_Campus_Bootcamp', students)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold transition-all cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Master CSV</span>
          </button>
          <button
            onClick={() => setShowAddBatchModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md cursor-pointer transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Create Batch</span>
          </button>
        </div>
      </div>

      {/* Batch Overview Cards */}
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
              </div>

              <h3 className="text-sm font-bold text-slate-900 dark:text-white line-clamp-1">
                {batch.college}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">{batch.department}</p>
              <p className="text-[11px] text-slate-400 mt-1">Lead: {batch.trainer}</p>

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
                onClick={() => setSelectedBatchId(batch.name)}
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
              <option value="CS-Alpha-2026">CS-Alpha-2026</option>
              <option value="IT-Beta-2026">IT-Beta-2026</option>
              <option value="ECE-Gamma-2026">ECE-Gamma-2026</option>
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
                    {st.batch}
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

      {/* Add Batch Modal */}
      {showAddBatchModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleAddBatch}
            className="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-md w-full border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 animate-scaleUp"
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Add New Campus Batch
              </h3>
              <button
                type="button"
                onClick={() => setShowAddBatchModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Batch Code / Name
              </label>
              <input
                type="text"
                required
                placeholder="e.g. CS-Delta-2026"
                value={newBatchName}
                onChange={(e) => setNewBatchName(e.target.value)}
                className="w-full p-2.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                College / Institution Name
              </label>
              <input
                type="text"
                required
                value={newCollegeName}
                onChange={(e) => setNewCollegeName(e.target.value)}
                className="w-full p-2.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3">
              <button
                type="button"
                onClick={() => setShowAddBatchModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md"
              >
                Create Batch
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
