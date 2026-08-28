import React from 'react';
import {
  User,
  Mail,
  Phone,
  Building,
  GraduationCap,
  Calendar,
  Award,
  Sparkles,
  Download,
  CheckCircle2,
  AlertCircle,
  Clock,
  TrendingUp,
  ShieldCheck,
  Code2,
  Brain,
  Database,
  Layers,
  MessageSquare,
  Briefcase,
} from 'lucide-react';
import { StudentProfile } from '../types';

interface StudentProfileViewProps {
  student: StudentProfile;
  onDownloadReport: () => void;
  onOpenAiInsights: () => void;
}

// Circular progress gauge component
const CircularProgress: React.FC<{
  value: number;
  label: string;
  color: string;
  icon: React.ComponentType<{ className?: string }>;
}> = ({ value, label, color, icon: Icon }) => {
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (value / 100) * circumference;

  return (
    <div className="flex flex-col items-center p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 transition-all hover:shadow-xs">
      <div className="relative w-24 h-24 flex items-center justify-center">
        {/* Background Track */}
        <svg className="w-full h-full transform -rotate-90">
          <circle
            cx="48"
            cy="48"
            r={radius}
            stroke="currentColor"
            strokeWidth="7"
            className="text-slate-200 dark:text-slate-700"
            fill="transparent"
          />
          <circle
            cx="48"
            cy="48"
            r={radius}
            stroke={color}
            strokeWidth="7"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
            fill="transparent"
          />
        </svg>

        {/* Center Text & Icon */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <Icon className="w-4 h-4 mb-0.5" style={{ color }} />
          <span className="text-sm font-extrabold text-slate-900 dark:text-white leading-none">
            {value}%
          </span>
        </div>
      </div>

      <span className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-2 text-center line-clamp-1">
        {label}
      </span>
      <span
        className="text-[10px] font-semibold mt-0.5 px-2 py-0.5 rounded-full"
        style={{
          backgroundColor: `${color}15`,
          color: color,
        }}
      >
        {value >= 80 ? 'Mastered' : value >= 65 ? 'Competent' : 'Focus Area'}
      </span>
    </div>
  );
};

export const StudentProfileView: React.FC<StudentProfileViewProps> = ({
  student,
  onDownloadReport,
  onOpenAiInsights,
}) => {
  const circularGauges = [
    { label: 'Coding & DSA', value: student.metrics.coding, color: '#4F46E5', icon: Code2 },
    { label: 'Aptitude & Math', value: student.metrics.aptitude, color: '#2563EB', icon: Brain },
    { label: 'Reasoning Logic', value: student.metrics.reasoning, color: '#7C3AED', icon: Layers },
    { label: 'SQL & Database', value: student.metrics.sql, color: '#059669', icon: Database },
    { label: 'CS Fundamentals', value: student.metrics.csFundamentals, color: '#D97706', icon: GraduationCap },
    { label: 'Communication', value: student.metrics.communication, color: '#DB2777', icon: MessageSquare },
    { label: 'Technical Interview', value: student.metrics.techInterview, color: '#0284C7', icon: Briefcase },
    { label: 'HR Interview (STAR)', value: student.metrics.hrInterview, color: '#10B981', icon: ShieldCheck },
    { label: 'Overall Readiness', value: student.metrics.overallReadiness, color: '#E11D48', icon: Sparkles },
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Student Profile Card Header */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-8 border border-slate-200/80 dark:border-slate-800 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          {/* Photo & Basic Details */}
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 text-center sm:text-left">
            <img
              src={student.photo}
              alt={student.name}
              className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl object-cover border-2 border-indigo-500/30 shadow-md"
            />
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">
                  {student.name}
                </h1>
                <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  {student.rollNo}
                </span>
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
                  Verified Candidate
                </span>
              </div>

              <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                {student.branch} • {student.department}
              </p>

              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <Building className="w-3.5 h-3.5" />
                  {student.college}
                </span>
                <span className="flex items-center gap-1">
                  <Mail className="w-3.5 h-3.5" />
                  {student.email}
                </span>
                <span className="flex items-center gap-1">
                  <Phone className="w-3.5 h-3.5" />
                  {student.phone}
                </span>
              </div>

              <div className="pt-1 flex flex-wrap items-center justify-center sm:justify-start gap-3 text-xs font-medium">
                <span className="px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 font-semibold">
                  Batch: {student.batch}
                </span>
                <span className="text-slate-500">Trainer: {student.trainer}</span>
                <span className="text-emerald-600 font-bold">Attendance: {student.attendancePercent}%</span>
              </div>
            </div>
          </div>

          {/* Action CTAs & Score Box */}
          <div className="flex flex-col sm:flex-row lg:flex-col items-center lg:items-end justify-between gap-4">
            <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-600 to-blue-700 text-white text-center sm:text-right shadow-md w-full sm:w-auto">
              <span className="text-[10px] font-bold uppercase tracking-wider opacity-90 block">
                Placement Readiness Score
              </span>
              <span className="text-3xl sm:text-4xl font-black">
                {student.placementReadinessScore}%
              </span>
              <span className="text-[11px] block opacity-90 font-medium mt-0.5">
                Top 5% Cohort Percentile
              </span>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                id="profile-ai-btn"
                onClick={onOpenAiInsights}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-purple-50 dark:bg-purple-950/50 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 text-xs font-bold hover:bg-purple-100 transition-colors cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>AI Insights</span>
              </button>
              <button
                id="profile-download-pdf-btn"
                onClick={onDownloadReport}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md cursor-pointer transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Dossier (PDF)</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 9 Beautiful Circular Progress Gauges */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              <span>Multi-Domain Skill Readiness Telemetry</span>
            </h2>
            <p className="text-xs text-slate-500">
              Interactive competency breakdown across all 40-Day curriculum tracks
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 pt-2">
          {circularGauges.map((gauge, idx) => (
            <CircularProgress
              key={idx}
              value={gauge.value}
              label={gauge.label}
              color={gauge.color}
              icon={gauge.icon}
            />
          ))}
        </div>
      </div>

      {/* Target Companies Eligibility Grid */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Building className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              <span>Target IT Companies Eligibility & Drive Clearance Probability</span>
            </h2>
            <p className="text-xs text-slate-500">
              Calculated against institutional drive cutoffs and previous batch historical clearance benchmarks
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {student.eligibility.map((co, idx) => (
            <div
              key={idx}
              className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 space-y-3 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: co.logoColor }}
                    />
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      {co.company}
                    </h3>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
                    {co.status}
                  </span>
                </div>

                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {co.roleName}
                </p>
                <p className="text-[11px] text-indigo-600 dark:text-indigo-400 font-medium">
                  {co.tier}
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-500">Drive Clearance Odds:</span>
                  <span className="font-extrabold text-emerald-600 dark:text-emerald-400">
                    {co.currentProbability}%
                  </span>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                    style={{ width: `${co.currentProbability}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Strengths, Weaknesses & Trainer Remarks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Strengths & Weaknesses */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <span>Key Strengths & Identified Weak Areas</span>
          </h2>

          <div className="space-y-3">
            <div>
              <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300 block mb-1.5">
                Demonstrated Strengths:
              </span>
              <div className="space-y-1.5">
                {student.strengths.map((str, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/40 text-xs text-emerald-950 dark:text-emerald-200 flex items-center gap-2"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>{str}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-2">
              <span className="text-xs font-bold text-rose-700 dark:text-rose-300 block mb-1.5">
                Priority Action Areas:
              </span>
              <div className="space-y-1.5">
                {student.weakAreas.map((weak, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 rounded-xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900/40 text-xs text-rose-950 dark:text-rose-200 flex items-center gap-2"
                  >
                    <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                    <span>{weak}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Official Trainer Endorsements & Remarks */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <span>Trainer Remarks & Mock Panel Logs</span>
          </h2>

          <div className="space-y-3">
            {student.recentRemarks.map((rem, idx) => (
              <div
                key={idx}
                className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900 dark:text-white">
                    {rem.trainerName}
                  </span>
                  <span className="text-[10px] font-semibold text-slate-400">
                    {rem.date}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 italic leading-relaxed">
                  "{rem.comment}"
                </p>
                <span className="inline-block text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">
                  {rem.type === 'tech' ? 'Technical Panel' : rem.type === 'hr' ? 'HR Panel' : 'General'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
