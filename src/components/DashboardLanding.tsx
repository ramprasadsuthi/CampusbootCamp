import React from 'react';
import {
  Users,
  CheckCircle2,
  TrendingUp,
  AlertTriangle,
  Calendar,
  Code2,
  Brain,
  MessageSquare,
  Sparkles,
  ArrowRight,
  Download,
  Building2,
  Clock,
  Award,
  ChevronRight,
  Flame,
  FileCheck2,
  Target,
} from 'lucide-react';
import { BOOTCAMP_PHASES } from '../data/curriculumData';
import { ASSESSMENTS_CATALOG } from '../data/assessmentData';
import { StudentProfile, UserRole } from '../types';

interface DashboardLandingProps {
  currentRole: UserRole;
  student: StudentProfile;
  onNavigate: (tab: string) => void;
  onOpenAssessment: (assessmentId: string) => void;
  onDownloadReport: () => void;
  onOpenAiInsights: () => void;
}

export const DashboardLanding: React.FC<DashboardLandingProps> = ({
  currentRole,
  student,
  onNavigate,
  onOpenAssessment,
  onDownloadReport,
  onOpenAiInsights,
}) => {
  const currentDay = student.currentDay || 40;

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* 1. TOP 4-CARD HIGH-DENSITY METRICS BAR */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Total Students */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400 text-[11px] font-semibold uppercase tracking-tight">
              Total Students
            </span>
            <span className="text-xs text-green-600 dark:text-green-400 font-bold bg-green-50 dark:bg-green-950/50 px-2 py-0.5 rounded">
              +12% vs last mo
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white">1,482</h3>
            <span className="text-xs text-slate-400">Active in 12 batches</span>
          </div>
          <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-2 flex items-center gap-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Users className="w-3.5 h-3.5 text-indigo-500" />
            <span>333 in current 40-Day Fastrack</span>
          </div>
        </div>

        {/* Metric 2: Avg Placement Readiness */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400 text-[11px] font-semibold uppercase tracking-tight">
              Avg Placement Readiness
            </span>
            <span className="text-xs text-indigo-600 dark:text-indigo-400 font-bold bg-indigo-50 dark:bg-indigo-950/50 px-2 py-0.5 rounded">
              Cohort Rank #1
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white">
              {student.placementReadinessScore}%
            </h3>
            <span className="text-xs text-slate-400">Target: 85% by Day 40</span>
          </div>
          <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
            <div
              className="bg-indigo-600 h-full rounded-full transition-all duration-500"
              style={{ width: `${student.placementReadinessScore}%` }}
            />
          </div>
        </div>

        {/* Metric 3: Coding Score Avg */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400 text-[11px] font-semibold uppercase tracking-tight">
              Coding Score (Avg)
            </span>
            <span className="text-xs text-blue-600 dark:text-blue-400 font-bold bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 rounded">
              +15 pts
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white">
              {student.metrics.coding}%
            </h3>
            <span className="text-xs text-slate-400">540 / 600 pts</span>
          </div>
          <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-2 flex items-center gap-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Code2 className="w-3.5 h-3.5 text-blue-500" />
            <span>DSA, SQL, DP & Two-Pointer</span>
          </div>
        </div>

        {/* Metric 4: Students At Risk */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border-l-4 border-l-amber-500 border-y border-r border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400 text-[11px] font-semibold uppercase tracking-tight">
              Students At Risk
            </span>
            <span className="text-xs text-amber-600 dark:text-amber-400 font-bold bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded">
              Critical Threshold
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white">29</h3>
            <span className="text-xs text-slate-400">8.7% of cohort</span>
          </div>
          <div className="text-[10px] text-amber-600 dark:text-amber-400 font-medium mt-2 flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
            <span>Score &lt; 60% in Coding</span>
            <button
              onClick={() => onNavigate('analytics')}
              className="font-bold underline hover:text-amber-700 cursor-pointer"
            >
              Remedial Queue →
            </button>
          </div>
        </div>
      </div>

      {/* 2. 40-DAY BOOTCAMP PHASE ROADMAP PROGRESS BAR */}
      <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white">
                40-Day Boot Camp Phase Roadmap
              </h2>
              <span className="text-[10px] bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-bold px-2 py-0.5 rounded-full uppercase">
                Sprint Active
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Structured sprint for TCS NQT, Infosys, Accenture, Cognizant, Capgemini & Wipro.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center space-x-1.5 text-xs">
              <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold rounded text-[10px]">
                Technical (Days 1-18)
              </span>
              <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold rounded text-[10px]">
                Aptitude (Days 19-26)
              </span>
              <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-semibold rounded text-[10px]">
                HR & Final (Days 27-40)
              </span>
            </div>

            <button
              onClick={() => onNavigate('curriculum')}
              className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-0.5 ml-2"
            >
              <span>Full Roadmap</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Milestone Steps Bar */}
        <div className="relative pt-2 pb-2">
          <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full w-full relative">
            <div className="h-full bg-indigo-600 rounded-full w-full" />
          </div>

          <div className="flex justify-between mt-[-13px] relative z-10">
            {/* Step 1 */}
            <div className="text-center group cursor-pointer" onClick={() => onNavigate('curriculum')}>
              <div className="w-7 h-7 rounded-full bg-indigo-600 border-2 border-white dark:border-slate-900 shadow-xs flex items-center justify-center text-white font-bold text-[10px] mx-auto">
                01
              </div>
              <span className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mt-1">
                Launch
              </span>
              <span className="block text-[9px] text-slate-400">Diagnostic</span>
            </div>

            {/* Step 2 */}
            <div className="text-center group cursor-pointer" onClick={() => onNavigate('curriculum')}>
              <div className="w-7 h-7 rounded-full bg-indigo-600 border-2 border-white dark:border-slate-900 shadow-xs flex items-center justify-center text-white font-bold text-[10px] mx-auto">
                18
              </div>
              <span className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mt-1">
                Tech Mastery
              </span>
              <span className="block text-[9px] text-slate-400">DSA & SQL</span>
            </div>

            {/* Step 3 */}
            <div className="text-center group cursor-pointer" onClick={() => onNavigate('curriculum')}>
              <div className="w-7 h-7 rounded-full bg-indigo-600 border-2 border-white dark:border-slate-900 shadow-xs flex items-center justify-center text-white font-bold text-[10px] mx-auto">
                26
              </div>
              <span className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mt-1">
                Aptitude
              </span>
              <span className="block text-[9px] text-slate-400">Quant & Logic</span>
            </div>

            {/* Step 4 */}
            <div className="text-center group cursor-pointer" onClick={() => onNavigate('curriculum')}>
              <div className="w-7 h-7 rounded-full bg-indigo-600 border-2 border-white dark:border-slate-900 shadow-xs flex items-center justify-center text-white font-bold text-[10px] mx-auto">
                30
              </div>
              <span className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mt-1">
                HR & GD
              </span>
              <span className="block text-[9px] text-slate-400">Verbal STAR</span>
            </div>

            {/* Step 5 */}
            <div className="text-center group cursor-pointer" onClick={() => onNavigate('curriculum')}>
              <div className="w-7 h-7 rounded-full bg-indigo-600 border-2 border-white dark:border-slate-900 shadow-xs flex items-center justify-center text-white font-bold text-[10px] mx-auto">
                36
              </div>
              <span className="block text-[10px] font-bold text-slate-700 dark:text-slate-300 mt-1">
                Full Mock
              </span>
              <span className="block text-[9px] text-slate-400">Tech Blitz</span>
            </div>

            {/* Step 6 */}
            <div className="text-center group cursor-pointer" onClick={() => onNavigate('assessments')}>
              <div className="w-7 h-7 rounded-full bg-rose-600 border-2 border-white dark:border-slate-900 shadow-xs flex items-center justify-center text-white font-bold text-[10px] mx-auto animate-pulse">
                40
              </div>
              <span className="block text-[10px] font-bold text-rose-600 dark:text-rose-400 mt-1">
                Simulation
              </span>
              <span className="block text-[9px] text-rose-500 font-semibold">Live Today</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. 12-COLUMN HIGH-DENSITY GRID: (Col-8 Table + Col-4 Gauge & AI) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* LEFT COL (Col-8): Upcoming Placement Assessments Table */}
        <div className="lg:col-span-8 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <FileCheck2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>Upcoming Placement Assessments & Key Tests</span>
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Live tests aligned with corporate service-based hiring standards
              </p>
            </div>

            <button
              onClick={() => onNavigate('assessments')}
              className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
            >
              <span>View All 14 Benchmarks</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* High Density Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/80 text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-200 dark:border-slate-800">
                  <th className="px-4 py-2.5">Assessment Name</th>
                  <th className="px-4 py-2.5">Focus Area</th>
                  <th className="px-4 py-2.5">Duration</th>
                  <th className="px-4 py-2.5">Target Drives</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
                {/* Row 1: Day 40 Capstone */}
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors bg-rose-50/20 dark:bg-rose-950/10">
                  <td className="px-4 py-2.5 font-bold text-slate-900 dark:text-white">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping shrink-0" />
                      <span>Day 40: Final Placement Simulation</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">Full Capstone Mock</td>
                  <td className="px-4 py-2.5 text-slate-500">180 Mins • 150 M</td>
                  <td className="px-4 py-2.5 text-indigo-600 dark:text-indigo-400 font-medium">TCS, Infy, Acc</td>
                  <td className="px-4 py-2.5">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500 text-white">
                      Live Today
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => onOpenAssessment('assess-day-40')}
                      className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] transition-colors cursor-pointer"
                    >
                      Start Test
                    </button>
                  </td>
                </tr>

                {/* Row 2: Day 36 Technical */}
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-white">
                    Day 36: Full Technical Benchmark
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">Data Structures & SQL</td>
                  <td className="px-4 py-2.5 text-slate-500">90 Mins • 100 M</td>
                  <td className="px-4 py-2.5 text-indigo-600 dark:text-indigo-400 font-medium">Cognizant, Wipro</td>
                  <td className="px-4 py-2.5">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300">
                      Completed (92%)
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => onOpenAssessment('assess-day-36')}
                      className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[11px] font-medium transition-colors cursor-pointer"
                    >
                      Review
                    </button>
                  </td>
                </tr>

                {/* Row 3: Day 30 Soft Skills */}
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-white">
                    Day 30: HR Mock Interview & Communication
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">STAR Verbal & GD</td>
                  <td className="px-4 py-2.5 text-slate-500">30 Mins • 50 M</td>
                  <td className="px-4 py-2.5 text-indigo-600 dark:text-indigo-400 font-medium">Capgemini, Infosys</td>
                  <td className="px-4 py-2.5">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300">
                      Completed (88%)
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => onOpenAssessment('assess-day-30')}
                      className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[11px] font-medium transition-colors cursor-pointer"
                    >
                      Review
                    </button>
                  </td>
                </tr>

                {/* Row 4: Day 26 Aptitude */}
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-white">
                    Day 26: Aptitude Benchmark 3
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">Arithmetic & Logic</td>
                  <td className="px-4 py-2.5 text-slate-500">60 Mins • 50 M</td>
                  <td className="px-4 py-2.5 text-indigo-600 dark:text-indigo-400 font-medium">TCS NQT, Acc</td>
                  <td className="px-4 py-2.5">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300">
                      Completed (84%)
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => onOpenAssessment('assess-day-26')}
                      className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[11px] font-medium transition-colors cursor-pointer"
                    >
                      Review
                    </button>
                  </td>
                </tr>

                {/* Row 5: Day 14 Coding Benchmark */}
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-white">
                    Day 14: Coding Benchmark 2
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">Arrays, Strings, Two-Pointer</td>
                  <td className="px-4 py-2.5 text-slate-500">90 Mins • 100 M</td>
                  <td className="px-4 py-2.5 text-indigo-600 dark:text-indigo-400 font-medium">All IT Drives</td>
                  <td className="px-4 py-2.5">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300">
                      Completed (90%)
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => onOpenAssessment('assess-day-14')}
                      className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[11px] font-medium transition-colors cursor-pointer"
                    >
                      Review
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="p-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
            <span>Showing 5 of 14 placement assessments</span>
            <button
              onClick={() => onNavigate('curriculum')}
              className="text-indigo-600 dark:text-indigo-400 font-bold hover:underline"
            >
              Browse 40-Day Daily Drills →
            </button>
          </div>
        </div>

        {/* RIGHT COL (Col-4): Radial Readiness Gauge & Dark AI Predictions Card */}
        <div className="lg:col-span-4 space-y-4">
          {/* Card 1: Circular Placement Readiness Gauge */}
          <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-tight">
                Readiness Gauge
              </h2>
              <span className="text-[10px] bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 font-bold px-1.5 py-0.5 rounded">
                Tier 1 Ready
              </span>
            </div>

            <div className="flex items-center justify-center my-3">
              <div className="relative w-36 h-36 flex items-center justify-center">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    stroke="currentColor"
                    strokeWidth="8"
                    className="text-slate-100 dark:text-slate-800"
                    fill="transparent"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    stroke="currentColor"
                    strokeWidth="8"
                    className="text-indigo-600 transition-all duration-1000 ease-out"
                    strokeDasharray="251.2"
                    strokeDashoffset={`${251.2 - (251.2 * student.placementReadinessScore) / 100}`}
                    strokeLinecap="round"
                    fill="transparent"
                  />
                </svg>
                <div className="absolute flex flex-col items-center justify-center text-center">
                  <span className="text-2xl font-black text-slate-900 dark:text-white">
                    {student.placementReadinessScore}%
                  </span>
                  <span className="text-[9px] text-slate-400 uppercase font-semibold">
                    Readiness
                  </span>
                </div>
              </div>
            </div>

            {/* Gauge Breakdown Legend */}
            <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
              <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-indigo-600" />
                  <span>Coding & Problem Solving</span>
                </span>
                <span className="font-bold text-slate-900 dark:text-slate-200">
                  {student.metrics.coding}%
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  <span>Quantitative Aptitude</span>
                </span>
                <span className="font-bold text-slate-900 dark:text-slate-200">
                  {student.metrics.aptitude}%
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  <span>Soft Skills & Interview</span>
                </span>
                <span className="font-bold text-slate-900 dark:text-slate-200">
                  {student.metrics.communication}%
                </span>
              </div>
            </div>
          </div>

          {/* Card 2: High Contrast Dark AI Insights Box */}
          <div className="bg-indigo-900 dark:bg-slate-900 rounded-xl p-4 text-white shadow-xs border border-indigo-800 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 bg-white/10 rounded-lg">
                  <Sparkles className="w-4 h-4 text-amber-300" />
                </div>
                <h3 className="font-bold text-xs">AI Placement Prediction</h3>
              </div>
              <span className="text-[10px] bg-white/20 text-white px-2 py-0.5 rounded-full font-bold">
                Live Model
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="p-2.5 bg-white/10 rounded-lg">
                <span className="text-[10px] text-indigo-200 block uppercase font-bold">
                  Highest Conversion Odds
                </span>
                <p className="font-semibold text-sm text-white mt-0.5">
                  Accenture FSE (92%) & TCS Digital (88%)
                </p>
              </div>

              <div className="p-2.5 bg-white/10 rounded-lg">
                <span className="text-[10px] text-amber-200 block uppercase font-bold">
                  Top Recommended Drill
                </span>
                <p className="font-semibold text-xs text-white mt-0.5">
                  Dynamic Programming Memoization & STAR HR Verbal
                </p>
              </div>
            </div>

            <button
              onClick={onOpenAiInsights}
              className="w-full py-2 rounded-lg bg-white text-indigo-900 font-bold text-xs hover:bg-indigo-50 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>Launch AI Placement Doctor</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* 4. TARGET COMPANIES CLEARANCE MATRIX (High Density) */}
      <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h2 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white flex items-center gap-2">
              <Building2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span>Target Company Clearance Matrix & Eligibility</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Clearance probability calibrated for 2026 campus hiring drives
            </p>
          </div>
          <button
            onClick={() => onNavigate('student_profile')}
            className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            Candidate Profile & Metrics →
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {student.eligibility.map((co, idx) => (
            <div
              key={idx}
              className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: co.logoColor }}
                  />
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                    {co.company}
                  </h4>
                  <span className="text-[9px] px-1.5 py-0.2 rounded font-bold bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 shrink-0">
                    {co.status}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">
                  {co.roleName}
                </p>
                <p className="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold">
                  {co.tier}
                </p>
              </div>

              <div className="text-right pl-2">
                <span className="text-base font-extrabold text-emerald-600 dark:text-emerald-400">
                  {co.currentProbability}%
                </span>
                <p className="text-[9px] text-slate-400">Odds</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
