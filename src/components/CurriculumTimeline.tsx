import React, { useState } from 'react';
import {
  Calendar,
  Search,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  FileCheck2,
  Activity,
  Layers,
  Sparkles,
  BookOpen,
  ArrowRight,
  Filter,
} from 'lucide-react';
import { BOOTCAMP_PHASES, CURRICULUM_40_DAYS } from '../data/curriculumData';
import { BootcampPhaseId, CurriculumDay } from '../types';

interface CurriculumTimelineProps {
  onOpenAssessment: (assessmentId: string) => void;
}

export const CurriculumTimeline: React.FC<CurriculumTimelineProps> = ({ onOpenAssessment }) => {
  const [selectedPhase, setSelectedPhase] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>('all');
  const [expandedDays, setExpandedDays] = useState<Record<number, boolean>>({
    1: true,
    7: true,
    14: true,
    18: true,
    21: true,
    26: true,
    30: true,
    37: true,
    40: true,
  });

  const toggleExpand = (dayNumber: number) => {
    setExpandedDays((prev) => ({
      ...prev,
      [dayNumber]: !prev[dayNumber],
    }));
  };

  const expandAll = () => {
    const all: Record<number, boolean> = {};
    CURRICULUM_40_DAYS.forEach((d) => (all[d.dayNumber] = true));
    setExpandedDays(all);
  };

  const collapseAll = () => {
    setExpandedDays({});
  };

  const filteredDays = CURRICULUM_40_DAYS.filter((day) => {
    const matchesPhase = selectedPhase === 'all' || day.phaseId === selectedPhase;
    const matchesDifficulty =
      selectedDifficulty === 'all' || day.difficulty.toLowerCase() === selectedDifficulty.toLowerCase();
    const matchesSearch =
      day.topic.toLowerCase().includes(searchQuery.toLowerCase()) ||
      day.assessmentTitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
      day.expectedOutcome.toLowerCase().includes(searchQuery.toLowerCase()) ||
      day.subtopics.some((s) => s.toLowerCase().includes(searchQuery.toLowerCase()));

    return matchesPhase && matchesDifficulty && matchesSearch;
  });

  const getPhaseColor = (phaseId: BootcampPhaseId) => {
    const phase = BOOTCAMP_PHASES.find((p) => p.id === phaseId);
    return phase ? phase.color : '#4F46E5';
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header & Overview */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-xs font-bold mb-2">
              <Calendar className="w-3.5 h-3.5" />
              <span>Complete 40-Day Structured Roadmap</span>
            </div>
            <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Curriculum & Daily Milestone Schedule
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Every day includes concept sessions, hands-on coding labs, practice drills, benchmark assessments, and clear expected outcomes.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={expandAll}
              className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
            >
              Expand All
            </button>
            <button
              onClick={collapseAll}
              className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
            >
              Collapse All
            </button>
          </div>
        </div>

        {/* Phase Filter Tabs */}
        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-slate-100 dark:border-slate-800 pt-4">
          <button
            onClick={() => setSelectedPhase('all')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
              selectedPhase === 'all'
                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-xs'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
            }`}
          >
            All 40 Days ({CURRICULUM_40_DAYS.length})
          </button>
          {BOOTCAMP_PHASES.map((phase) => (
            <button
              key={phase.id}
              onClick={() => setSelectedPhase(phase.id)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                selectedPhase === phase.id
                  ? 'text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
              style={{
                backgroundColor: selectedPhase === phase.id ? phase.color : undefined,
              }}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor: selectedPhase === phase.id ? '#ffffff' : phase.color,
                }}
              />
              <span>
                {phase.name} ({phase.daysRange})
              </span>
            </button>
          ))}
        </div>

        {/* Search & Difficulty Filter */}
        <div className="mt-4 flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search topics (e.g. Sliding Window, SQL, Binary Trees, Time & Work, Resume)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Filter className="w-4 h-4 text-slate-400 shrink-0" />
            <select
              value={selectedDifficulty}
              onChange={(e) => setSelectedDifficulty(e.target.value)}
              className="w-full sm:w-auto text-xs font-medium px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All Difficulties</option>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>
        </div>
      </div>

      {/* 40-Day Cards List */}
      <div className="space-y-4">
        {filteredDays.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
            <BookOpen className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">No matching curriculum days found</p>
            <p className="text-xs text-slate-500">Try clearing your search query or phase filter.</p>
          </div>
        ) : (
          filteredDays.map((day) => {
            const isExpanded = expandedDays[day.dayNumber];
            const phaseColor = getPhaseColor(day.phaseId);
            const isCurrent = day.dayNumber === 40;

            return (
              <div
                key={day.dayNumber}
                id={`curriculum-day-card-${day.dayNumber}`}
                className={`bg-white dark:bg-slate-900 rounded-2xl border transition-all overflow-hidden ${
                  isCurrent
                    ? 'border-rose-300 dark:border-rose-900/60 shadow-md ring-1 ring-rose-500/20'
                    : isExpanded
                    ? 'border-indigo-200 dark:border-indigo-900/60 shadow-xs'
                    : 'border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                {/* Header Row */}
                <div
                  onClick={() => toggleExpand(day.dayNumber)}
                  className="p-4 sm:p-5 flex items-center justify-between gap-4 cursor-pointer select-none hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <div className="flex items-center gap-3 sm:gap-4 flex-1">
                    {/* Day Badge */}
                    <div
                      className="w-12 h-12 rounded-xl flex flex-col items-center justify-center font-extrabold shrink-0 shadow-xs text-white"
                      style={{ backgroundColor: phaseColor }}
                    >
                      <span className="text-[9px] uppercase tracking-wider font-semibold opacity-90">Day</span>
                      <span className="text-base leading-none">{day.dayNumber}</span>
                    </div>

                    <div className="space-y-1 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md"
                          style={{
                            backgroundColor: `${phaseColor}15`,
                            color: phaseColor,
                          }}
                        >
                          {day.phaseName}
                        </span>

                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                            day.difficulty === 'Beginner'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : day.difficulty === 'Intermediate'
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                              : 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300'
                          }`}
                        >
                          {day.difficulty}
                        </span>

                        {isCurrent && (
                          <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-rose-500 text-white animate-pulse">
                            Capstone Today
                          </span>
                        )}

                        {day.completed && (
                          <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="w-3 h-3" />
                            Completed
                          </span>
                        )}
                      </div>

                      <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                        {day.topic}
                      </h3>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      aria-label="Toggle details"
                    >
                      {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                {/* Expanded Details Body */}
                {isExpanded && (
                  <div className="px-4 sm:px-6 pb-6 pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-4">
                    {/* Subtopics Pills */}
                    <div>
                      <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1.5">
                        Key Concepts & Modules
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {day.subtopics.map((sub, idx) => (
                          <span
                            key={idx}
                            className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium"
                          >
                            • {sub}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Activities & Practice Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                      <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 space-y-1.5">
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
                          <Activity className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                          <span>Structured Daily Activities</span>
                        </div>
                        <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
                          {day.activities.map((act, idx) => (
                            <li key={idx} className="flex items-start gap-1.5">
                              <span className="text-indigo-500 font-bold">›</span>
                              <span>{act}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 space-y-1.5">
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
                          <Layers className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                          <span>Practice & Problem Volume</span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
                          {day.practice}
                        </p>
                      </div>
                    </div>

                    {/* Assessment & Expected Outcome Card */}
                    <div className="p-4 rounded-xl bg-gradient-to-r from-indigo-50/70 via-blue-50/70 to-purple-50/70 dark:from-indigo-950/40 dark:via-blue-950/40 dark:to-purple-950/40 border border-indigo-100 dark:border-indigo-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <FileCheck2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                          <span className="text-xs font-bold text-slate-900 dark:text-white">
                            {day.assessmentTitle}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 dark:text-slate-300">
                          <span className="font-semibold text-indigo-700 dark:text-indigo-300">Target Outcome:</span>{' '}
                          {day.expectedOutcome}
                        </p>
                      </div>

                      <button
                        onClick={() => onOpenAssessment(`assess-day-${day.dayNumber}`)}
                        className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs transition-all flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
                      >
                        <span>Take / View Test</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
