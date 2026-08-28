import React from 'react';
import {
  FileCheck2,
  Clock,
  Award,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Building2,
  Calendar,
  Layers,
} from 'lucide-react';
import { ASSESSMENTS_CATALOG } from '../data/assessmentData';
import { Assessment } from '../types';

interface AssessmentListProps {
  onOpenAssessment: (assessmentId: string) => void;
}

export const AssessmentList: React.FC<AssessmentListProps> = ({ onOpenAssessment }) => {
  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-xs font-bold mb-2">
            <FileCheck2 className="w-3.5 h-3.5" />
            <span>Campus Assessment Blueprint</span>
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Bootcamp Assessments & Benchmark Tests
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Structured milestone tests conforming to TCS NQT, Infosys SP, Accenture FSE, and Wipro evaluation criteria.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700 text-right">
            <span className="text-[10px] text-slate-400 font-bold uppercase block">Total Benchmarks</span>
            <span className="text-lg font-extrabold text-indigo-600 dark:text-indigo-400">
              14 Scheduled
            </span>
          </div>
        </div>
      </div>

      {/* Assessment Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {ASSESSMENTS_CATALOG.map((assessment) => {
          const isLive = assessment.status === 'live';
          const isCompleted = assessment.status === 'completed';

          return (
            <div
              key={assessment.id}
              id={`assessment-card-${assessment.id}`}
              className={`bg-white dark:bg-slate-900 rounded-2xl p-5 border transition-all flex flex-col justify-between ${
                isLive
                  ? 'border-indigo-300 dark:border-indigo-800 shadow-md ring-1 ring-indigo-500/20'
                  : 'border-slate-200/80 dark:border-slate-800 shadow-xs hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div>
                {/* Card Top Pill Row */}
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      Day {assessment.dayNumber}
                    </span>
                    <span
                      className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md uppercase tracking-wider ${
                        isLive
                          ? 'bg-rose-500 text-white animate-pulse'
                          : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                      }`}
                    >
                      {isLive ? 'Live Now' : 'Completed'}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs font-medium text-slate-500">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {assessment.durationMinutes} Mins
                    </span>
                    <span className="flex items-center gap-1">
                      <Award className="w-3.5 h-3.5" />
                      {assessment.totalMarks} Marks
                    </span>
                  </div>
                </div>

                {/* Title */}
                <h3 className="text-base font-bold text-slate-900 dark:text-white leading-snug">
                  {assessment.title}
                </h3>

                {/* Purpose */}
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-2 line-clamp-2 leading-relaxed">
                  {assessment.purpose}
                </p>

                {/* Coverage Topics */}
                <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                    Topics Evaluated:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {assessment.coverage.map((topic, idx) => (
                      <span
                        key={idx}
                        className="text-[11px] px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium"
                      >
                        {topic}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Target Companies */}
                <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold">
                  <Building2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Mapped: {assessment.targetCompanies.join(', ')}</span>
                </div>
              </div>

              {/* Card Action */}
              <div className="mt-5 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
                <div className="text-xs text-slate-400 font-medium">
                  {assessment.sections.length} Sections ({assessment.sections.reduce((acc, s) => acc + s.questions.length, 0)} Questions)
                </div>

                <button
                  id={`open-assessment-btn-${assessment.id}`}
                  onClick={() => onOpenAssessment(assessment.id)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold shadow-xs transition-all flex items-center gap-1.5 cursor-pointer ${
                    isLive
                      ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-500/20'
                      : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200'
                  }`}
                >
                  <span>{isLive ? 'Start Assessment' : 'Review Assessment'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
