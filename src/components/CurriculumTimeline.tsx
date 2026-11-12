import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
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
  FileText,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
  Play,
} from 'lucide-react';
import { BOOTCAMP_PHASES, CURRICULUM_40_DAYS } from '../data/curriculumData';
import { BootcampPhaseId, CurriculumDay, CurriculumMaterial, CurriculumMaterialType } from '../types';
import { createCurriculumMaterial, deleteCurriculumMaterial, fetchCurriculumMaterials, updateCurriculumMaterial, updateCurriculumMaterialProgress } from '../services/api';

function embeddedVideoUrl(source: string) {
  try {
    const url = new URL(source);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') {
      const video = new URL(`https://www.youtube-nocookie.com/embed/${url.pathname.split('/').filter(Boolean)[0] || ''}`);
      video.searchParams.set('controls', '1');
      video.searchParams.set('fs', '0');
      video.searchParams.set('disablekb', '1');
      video.searchParams.set('iv_load_policy', '3');
      return video.toString();
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      const id = url.searchParams.get('v') || url.pathname.match(/\/(?:embed|shorts)\/([^/]+)/)?.[1];
      if (!id) return source;
      const video = new URL(`https://www.youtube-nocookie.com/embed/${id}`);
      video.searchParams.set('controls', '1');
      video.searchParams.set('fs', '0');
      video.searchParams.set('disablekb', '1');
      video.searchParams.set('iv_load_policy', '3');
      return video.toString();
    }
    if (host === 'vimeo.com') {
      const id = url.pathname.split('/').filter(Boolean).pop();
      return id ? `https://player.vimeo.com/video/${id}` : source;
    }
    return source;
  } catch {
    return source;
  }
}

function isDirectVideo(source: string) {
  try { return /\.(mp4|webm|ogg)$/i.test(new URL(source).pathname); } catch { return false; }
}

function embeddedPdfUrl(source: string) {
  try {
    const url = new URL(source);
    const host = url.hostname.toLowerCase();
    if (host !== 'drive.google.com' && host !== 'docs.google.com') return `${source}#toolbar=0&navpanes=0&scrollbar=0`;

    const match = url.pathname.match(/\/(file|document|presentation|spreadsheets)\/d\/([^/]+)/i);
    const fileId = match?.[2] || url.searchParams.get('id');
    if (!fileId) return source;

    const preview = host === 'docs.google.com' && match
      ? new URL(`https://docs.google.com/${match[1].toLowerCase()}/d/${encodeURIComponent(fileId)}/preview`)
      : new URL(`https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`);
    if (host === 'drive.google.com') preview.searchParams.set('rm', 'minimal');
    for (const key of ['resourcekey', 'authuser']) {
      const value = url.searchParams.get(key);
      if (value) preview.searchParams.set(key, value);
    }
    return preview.toString();
  } catch {
    return source;
  }
}

function isGoogleHostedPdf(source: string) {
  try {
    const host = new URL(source).hostname.toLowerCase();
    return host === 'drive.google.com' || host === 'docs.google.com';
  } catch {
    return false;
  }
}

interface CurriculumTimelineProps {
  onOpenAssessment: (assessmentId: string) => void;
  completedDayNumbers: number[];
  canTrackProgress: boolean;
  onToggleDayCompletion: (dayNumber: number, completed: boolean) => Promise<void>;
}

export const CurriculumTimeline: React.FC<CurriculumTimelineProps> = ({ onOpenAssessment, completedDayNumbers, canTrackProgress, onToggleDayCompletion }) => {
  const [selectedPhase, setSelectedPhase] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>('all');
  const [updatingDays, setUpdatingDays] = useState<Record<number, boolean>>({});
  const [dayOneMaterials, setDayOneMaterials] = useState<CurriculumMaterial[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(true);
  const [materialsError, setMaterialsError] = useState('');
  const [savingMaterial, setSavingMaterial] = useState(false);
  const [materialDraft, setMaterialDraft] = useState<{ id?: string; title: string; materialType: CurriculumMaterialType; contentUrl: string; contentText: string; isRequired: boolean } | null>(null);
  const [updatingMaterialId, setUpdatingMaterialId] = useState<string | null>(null);
  const [viewingMaterial, setViewingMaterial] = useState<CurriculumMaterial | null>(null);
  const loadDayOneMaterials = useCallback(async () => {
    setMaterialsLoading(true);
    try {
      setDayOneMaterials(await fetchCurriculumMaterials(1));
      setMaterialsError('');
    } catch (error) {
      setMaterialsError(error instanceof Error ? error.message : 'Could not load Day 1 learning materials.');
    } finally {
      setMaterialsLoading(false);
    }
  }, []);
  useEffect(() => { void loadDayOneMaterials(); }, [loadDayOneMaterials]);
  const days = useMemo(
    () => CURRICULUM_40_DAYS.map((day) => ({ ...day, completed: canTrackProgress && completedDayNumbers.includes(day.dayNumber) })),
    [canTrackProgress, completedDayNumbers],
  );
  const completedCount = canTrackProgress ? completedDayNumbers.length : 0;
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
    days.forEach((d) => (all[d.dayNumber] = true));
    setExpandedDays(all);
  };

  const collapseAll = () => {
    setExpandedDays({});
  };

  const filteredDays = days.filter((day) => {
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

  const toggleDayCompletion = async (dayNumber: number, completed: boolean) => {
    setUpdatingDays((current) => ({ ...current, [dayNumber]: true }));
    try {
      await onToggleDayCompletion(dayNumber, completed);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not save this day’s progress.');
    } finally {
      setUpdatingDays((current) => ({ ...current, [dayNumber]: false }));
    }
  };

  const saveMaterial = async (event: FormEvent) => {
    event.preventDefault();
    if (!materialDraft) return;
    setSavingMaterial(true);
    setMaterialsError('');
    try {
      const payload = { title: materialDraft.title, materialType: materialDraft.materialType, contentUrl: materialDraft.contentUrl || undefined, contentText: materialDraft.contentText || undefined, isRequired: materialDraft.isRequired };
      if (materialDraft.id) await updateCurriculumMaterial(materialDraft.id, payload);
      else await createCurriculumMaterial(payload);
      setMaterialDraft(null);
      await loadDayOneMaterials();
    } catch (error) {
      setMaterialsError(error instanceof Error ? error.message : 'Could not save this learning material.');
    } finally {
      setSavingMaterial(false);
    }
  };

  const removeMaterial = async (material: CurriculumMaterial) => {
    if (!window.confirm(`Remove “${material.title}” and its student progress?`)) return;
    try {
      await deleteCurriculumMaterial(material.id);
      setDayOneMaterials((items) => items.filter((item) => item.id !== material.id));
    } catch (error) {
      setMaterialsError(error instanceof Error ? error.message : 'Could not remove this learning material.');
    }
  };

  const markMaterialProgress = async (material: CurriculumMaterial, status: 'in_progress' | 'completed') => {
    setUpdatingMaterialId(material.id);
    try {
      await updateCurriculumMaterialProgress(material.id, status);
      setDayOneMaterials((items) => items.map((item) => item.id === material.id ? { ...item, progressStatus: status } : item));
    } catch (error) {
      setMaterialsError(error instanceof Error ? error.message : 'Could not save your material progress.');
    } finally {
      setUpdatingMaterialId(null);
    }
  };

  return (
    <>
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
            {canTrackProgress && <p className="mt-2 text-xs font-bold text-indigo-600 dark:text-indigo-300">Your progress: {completedCount} of 40 days complete</p>}
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
            All 40 Days ({days.length})
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
            const dayOneRequiredCount = dayOneMaterials.filter((material) => material.isRequired).length;
            const dayOneCompletedCount = dayOneMaterials.filter((material) => material.isRequired && material.progressStatus === 'completed').length;

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
                            {canTrackProgress && day.dayNumber === 1 ? 'Prior completion' : 'Completed'}
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
                    {canTrackProgress && (day.dayNumber === 1 ? <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-2.5 dark:border-indigo-900/60 dark:bg-indigo-950/30"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-semibold text-slate-700 dark:text-slate-200">Required learning materials reviewed</span><span className="text-xs font-bold text-indigo-700 dark:text-indigo-300">{materialsLoading ? 'Loading…' : `${dayOneCompletedCount} of ${dayOneRequiredCount}`}</span></div><p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400">Day completion will be based on learning materials and a learning check. {day.completed ? 'A completion record from the previous tracking method is retained.' : 'The learning check will be added in the next implementation step.'}</p></div> : <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/50"><span className={`text-xs font-semibold ${day.completed ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-600 dark:text-slate-300'}`}>{day.completed ? 'You marked this day complete.' : 'This day is not marked complete yet.'}</span><button type="button" disabled={updatingDays[day.dayNumber]} onClick={() => void toggleDayCompletion(day.dayNumber, !day.completed)} className={`rounded-lg px-3 py-2 text-xs font-bold text-white disabled:opacity-50 ${day.completed ? 'bg-slate-600 hover:bg-slate-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>{updatingDays[day.dayNumber] ? 'Saving…' : day.completed ? 'Mark incomplete' : 'Mark day complete'}</button></div>)}
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

                    {day.dayNumber === 1 && <section className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div><h4 className="text-sm font-bold text-slate-900 dark:text-white">Day 1 learning materials</h4><p className="text-xs text-slate-500">Videos, readings, and PDFs for this day’s topics.</p></div>
                        {!canTrackProgress && <button type="button" onClick={() => setMaterialDraft({ title: '', materialType: 'video', contentUrl: '', contentText: '', isRequired: true })} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-700"><Plus className="h-3.5 w-3.5" />Add material</button>}
                      </div>

                      {materialsError && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{materialsError}{materialsError.includes('migration') && <span> Run <code>npm run db:migrate-auth</code>, then refresh this page.</span>}</div>}
                      {materialDraft && !canTrackProgress && <form onSubmit={(event) => void saveMaterial(event)} className="grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60 sm:grid-cols-2">
                        <label className="space-y-1 sm:col-span-2"><span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Title</span><input required maxLength={191} value={materialDraft.title} onChange={(event) => setMaterialDraft((draft) => draft ? { ...draft, title: event.target.value } : draft)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="e.g. Big-O notation introduction" /></label>
                        <label className="space-y-1"><span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Material type</span><select value={materialDraft.materialType} onChange={(event) => setMaterialDraft((draft) => draft ? { ...draft, materialType: event.target.value as CurriculumMaterialType } : draft)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"><option value="video">Video</option><option value="text">Text / reading</option><option value="pdf">PDF / slides</option></select></label>
                        <label className="flex items-center gap-2 self-end pb-2 text-xs font-medium text-slate-700 dark:text-slate-300"><input type="checkbox" checked={materialDraft.isRequired} onChange={(event) => setMaterialDraft((draft) => draft ? { ...draft, isRequired: event.target.checked } : draft)} />Required for Day 1</label>
                        {materialDraft.materialType === 'text' ? <label className="space-y-1 sm:col-span-2"><span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Reading content</span><textarea required rows={6} maxLength={50000} value={materialDraft.contentText} onChange={(event) => setMaterialDraft((draft) => draft ? { ...draft, contentText: event.target.value } : draft)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="Enter the lesson text students will read…" /></label> : <label className="space-y-1 sm:col-span-2"><span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{materialDraft.materialType === 'video' ? 'Video URL' : 'PDF URL'}</span><input required type="url" value={materialDraft.contentUrl} onChange={(event) => setMaterialDraft((draft) => draft ? { ...draft, contentUrl: event.target.value } : draft)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="https://…" /></label>}
                        <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={() => setMaterialDraft(null)} className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700"><X className="h-3.5 w-3.5" />Cancel</button><button disabled={savingMaterial} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><Save className="h-3.5 w-3.5" />{savingMaterial ? 'Saving…' : materialDraft.id ? 'Save changes' : 'Add material'}</button></div>
                      </form>}

                      {materialsLoading ? <p className="text-xs text-slate-500">Loading Day 1 materials…</p> : dayOneMaterials.length === 0 ? <p className="rounded-lg bg-slate-50 px-3 py-4 text-xs text-slate-500 dark:bg-slate-800/50">{canTrackProgress ? 'Your trainer has not added Day 1 materials yet.' : 'No materials have been published for Day 1.'}</p> : <div className="space-y-2">{dayOneMaterials.map((material) => <article key={material.id} className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
                        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h5 className="text-sm font-semibold text-slate-900 dark:text-white">{material.title}</h5><span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">{material.materialType === 'text' ? 'Reading' : material.materialType === 'pdf' ? 'PDF' : 'Video'}</span><span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${material.isRequired ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>{material.isRequired ? 'Required' : 'Optional'}</span>{canTrackProgress && material.progressStatus === 'completed' && <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">Reviewed</span>}</div>
                          {material.materialType === 'text' ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">{material.contentText}</p> : <button type="button" onClick={() => { setViewingMaterial(material); if (canTrackProgress && material.progressStatus === 'not_started') void markMaterialProgress(material, 'in_progress'); }} className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-300">{material.materialType === 'pdf' ? <FileText className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}{material.materialType === 'pdf' ? 'View PDF' : 'Play video'}</button>}
                        </div><div className="flex shrink-0 items-center gap-2">{canTrackProgress ? <button type="button" disabled={updatingMaterialId === material.id} onClick={() => void markMaterialProgress(material, material.progressStatus === 'completed' ? 'in_progress' : 'completed')} className={`rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-50 ${material.progressStatus === 'completed' ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>{updatingMaterialId === material.id ? 'Saving…' : material.progressStatus === 'completed' ? 'Undo review' : material.materialType === 'video' ? 'Mark watched' : material.materialType === 'pdf' ? 'Mark reviewed' : 'Mark as read'}</button> : <><button type="button" title="Edit material" onClick={() => setMaterialDraft({ id: material.id, title: material.title, materialType: material.materialType, contentUrl: material.contentUrl || '', contentText: material.contentText || '', isRequired: material.isRequired })} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-800"><Pencil className="h-4 w-4" /></button><button type="button" title="Delete material" onClick={() => void removeMaterial(material)} className="rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-slate-800"><Trash2 className="h-4 w-4" /></button></>}</div>
                      </div></article>)}</div>}
                      {canTrackProgress && dayOneRequiredCount > 0 && <p className="text-[11px] text-slate-500">Your material status is saved to your student account. Video and document review is currently self-reported; it does not mark the whole day complete.</p>}
                    </section>}

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
    {viewingMaterial && createPortal(<div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/75 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewingMaterial(null); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="learning-resource-title" className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 dark:border-slate-700 sm:px-6"><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-300">Day 1 learning material</p><h2 id="learning-resource-title" className="truncate text-base font-bold text-slate-900 dark:text-white">{viewingMaterial.title}</h2></div><button type="button" onClick={() => setViewingMaterial(null)} aria-label="Close viewer" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button></header>
        <div className="min-h-[50vh] flex-1 bg-slate-100 dark:bg-slate-950 sm:min-h-[65vh]">
          {viewingMaterial.materialType === 'pdf' ? <div className="relative h-[72vh] min-h-[50vh] w-full"><iframe title={viewingMaterial.title} src={embeddedPdfUrl(viewingMaterial.contentUrl || '')} referrerPolicy="strict-origin-when-cross-origin" className="h-full w-full border-0" />{isGoogleHostedPdf(viewingMaterial.contentUrl || '') && <div aria-hidden="true" onClick={(event) => { event.preventDefault(); event.stopPropagation(); }} className="absolute right-0 top-0 z-10 h-14 w-14 cursor-default rounded-bl-md bg-[#1f1f1f]" />}</div> : viewingMaterial.materialType === 'video' && isDirectVideo(viewingMaterial.contentUrl || '') ? <video src={viewingMaterial.contentUrl || undefined} controls controlsList="nodownload noplaybackrate noremoteplayback nofullscreen" disablePictureInPicture className="mx-auto max-h-[75vh] w-full bg-black" /> : <iframe title={viewingMaterial.title} src={embeddedVideoUrl(viewingMaterial.contentUrl || '')} allow="accelerometer; autoplay; encrypted-media; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" className="h-[72vh] min-h-[50vh] w-full border-0" />}
        </div>
        <p className="border-t border-slate-200 px-4 py-2 text-[11px] text-slate-500 dark:border-slate-700 sm:px-6">This preview keeps you in the course. A browser preview cannot fully prevent copying, screen capture, or access to an externally hosted source.</p>
      </section>
    </div>, document.body)}
    </>
  );
};
