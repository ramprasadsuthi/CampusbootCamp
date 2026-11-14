import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
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
import { BootcampPhaseId, CurriculumDay, CurriculumLearningCheck, CurriculumMaterial, CurriculumMaterialType, CurriculumTextFormat } from '../types';
import { createCurriculumMaterial, deleteCurriculumMaterial, fetchCurriculumLearningCheck, fetchCurriculumMaterials, submitCurriculumLearningCheck, updateCurriculumMaterial, updateCurriculumMaterialProgress } from '../services/api';

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

function renderLessonHtml(source: string, format: CurriculumTextFormat) {
  const parsed = format === 'html' ? source : marked.parse(source, { async: false, gfm: true, breaks: true });
  return DOMPurify.sanitize(parsed, {
    ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'sup', 'sub', 'div', 'span'],
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'alt', 'src', 'width', 'height', 'colspan', 'rowspan', 'start'],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'input', 'button', 'object', 'embed', 'svg', 'math', 'video', 'audio'],
    FORBID_ATTR: ['style', 'srcdoc', 'onerror', 'onclick', 'onload'],
  });
}

function lessonSummary(material: CurriculumMaterial) {
  const source = material.contentText || '';
  const plainText = material.contentFormat === 'html'
    ? source.replace(/<[^>]*>/g, ' ')
    : source.replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_~>#]/g, '');
  return plainText.replace(/\s+/g, ' ').trim().slice(0, 115);
}

interface CurriculumTimelineProps {
  onOpenAssessment: (assessmentId: string) => void;
  completedDayNumbers: number[];
  canTrackProgress: boolean;
  onProgressRefresh: () => Promise<void>;
  focusDayNumber?: number | null;
  onFocusDayHandled?: () => void;
}

export const CurriculumTimeline: React.FC<CurriculumTimelineProps> = ({ onOpenAssessment, completedDayNumbers, canTrackProgress, onProgressRefresh, focusDayNumber, onFocusDayHandled }) => {
  const [selectedPhase, setSelectedPhase] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>('all');
  const [materialsByDay, setMaterialsByDay] = useState<Record<number, CurriculumMaterial[]>>({});
  const [loadingMaterialsByDay, setLoadingMaterialsByDay] = useState<Record<number, boolean>>({});
  const requestedMaterialsDays = useRef(new Set<number>());
  const [materialsError, setMaterialsError] = useState('');
  const [savingMaterial, setSavingMaterial] = useState(false);
  const [materialDraft, setMaterialDraft] = useState<{ id?: string; dayNumber: number; title: string; materialType: CurriculumMaterialType; contentUrl: string; contentText: string; contentFormat: CurriculumTextFormat; isRequired: boolean } | null>(null);
  const [updatingMaterialId, setUpdatingMaterialId] = useState<string | null>(null);
  const [viewingMaterial, setViewingMaterial] = useState<CurriculumMaterial | null>(null);
  const [learningChecksByDay, setLearningChecksByDay] = useState<Record<number, CurriculumLearningCheck>>({});
  const [loadingChecksByDay, setLoadingChecksByDay] = useState<Record<number, boolean>>({});
  const requestedCheckDays = useRef(new Set<number>());
  const [activeLearningCheckDay, setActiveLearningCheckDay] = useState<number | null>(null);
  const activeLearningCheck = activeLearningCheckDay ? learningChecksByDay[activeLearningCheckDay] : null;
  const [learningCheckError, setLearningCheckError] = useState('');
  const [learningCheckOpen, setLearningCheckOpen] = useState(false);
  const [learningCheckAnswers, setLearningCheckAnswers] = useState<Record<number, number>>({});
  const [learningCheckResult, setLearningCheckResult] = useState<{ score: number; passed: boolean } | null>(null);
  const [submittingLearningCheck, setSubmittingLearningCheck] = useState(false);
  const loadDayMaterials = useCallback(async (dayNumber: number, force = false) => {
    if (!force && requestedMaterialsDays.current.has(dayNumber)) return;
    requestedMaterialsDays.current.add(dayNumber);
    setLoadingMaterialsByDay((current) => ({ ...current, [dayNumber]: true }));
    try {
      const materials = await fetchCurriculumMaterials(dayNumber);
      setMaterialsByDay((current) => ({ ...current, [dayNumber]: materials }));
      setMaterialsError('');
    } catch (error) {
      requestedMaterialsDays.current.delete(dayNumber);
      setMaterialsError(error instanceof Error ? error.message : `Could not load Day ${dayNumber} learning materials.`);
    } finally {
      setLoadingMaterialsByDay((current) => ({ ...current, [dayNumber]: false }));
    }
  }, []);
  const loadLearningCheck = useCallback(async (dayNumber: number, force = false) => {
    if (!canTrackProgress) return;
    if (!force && requestedCheckDays.current.has(dayNumber)) return;
    requestedCheckDays.current.add(dayNumber);
    setLoadingChecksByDay((current) => ({ ...current, [dayNumber]: true }));
    try {
      const check = await fetchCurriculumLearningCheck(dayNumber);
      setLearningChecksByDay((current) => ({ ...current, [dayNumber]: check }));
      setLearningCheckError('');
    } catch (error) {
      requestedCheckDays.current.delete(dayNumber);
      setLearningCheckError(error instanceof Error ? error.message : `Could not load the Day ${dayNumber} learning check.`);
    } finally {
      setLoadingChecksByDay((current) => ({ ...current, [dayNumber]: false }));
    }
  }, [canTrackProgress]);
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

  useEffect(() => {
    Object.entries(expandedDays).filter(([, expanded]) => expanded).forEach(([dayNumber]) => {
      const numericDay = Number(dayNumber);
      void loadDayMaterials(numericDay);
      void loadLearningCheck(numericDay);
    });
  }, [expandedDays, loadDayMaterials, loadLearningCheck]);

  useEffect(() => {
    if (!focusDayNumber || focusDayNumber < 1 || focusDayNumber > 40) return;
    setExpandedDays((current) => ({ ...current, [focusDayNumber]: true }));
    const frame = requestAnimationFrame(() => {
      document.getElementById(`curriculum-day-card-${focusDayNumber}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      onFocusDayHandled?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusDayNumber, onFocusDayHandled]);

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

  const saveMaterial = async (event: FormEvent) => {
    event.preventDefault();
    if (!materialDraft) return;
    setSavingMaterial(true);
    setMaterialsError('');
    try {
      const payload = { dayNumber: materialDraft.dayNumber, title: materialDraft.title, materialType: materialDraft.materialType, contentUrl: materialDraft.contentUrl || undefined, contentText: materialDraft.contentText || undefined, contentFormat: materialDraft.contentFormat, isRequired: materialDraft.isRequired };
      if (materialDraft.id) await updateCurriculumMaterial(materialDraft.id, payload);
      else await createCurriculumMaterial(payload);
      const dayNumber = materialDraft.dayNumber;
      setMaterialDraft(null);
      await loadDayMaterials(dayNumber, true);
      if (canTrackProgress) {
        await onProgressRefresh();
        await loadLearningCheck(dayNumber, true);
      }
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
      setMaterialsByDay((current) => ({ ...current, [material.dayNumber]: (current[material.dayNumber] || []).filter((item) => item.id !== material.id) }));
      if (canTrackProgress) await onProgressRefresh();
    } catch (error) {
      setMaterialsError(error instanceof Error ? error.message : 'Could not remove this learning material.');
    }
  };

  const markMaterialProgress = async (material: CurriculumMaterial, status: 'in_progress' | 'completed') => {
    setUpdatingMaterialId(material.id);
    try {
      await updateCurriculumMaterialProgress(material.id, status);
      setMaterialsByDay((current) => ({ ...current, [material.dayNumber]: (current[material.dayNumber] || []).map((item) => item.id === material.id ? { ...item, progressStatus: status } : item) }));
      if (canTrackProgress) {
        await onProgressRefresh();
        await loadLearningCheck(material.dayNumber, true);
      }
    } catch (error) {
      setMaterialsError(error instanceof Error ? error.message : 'Could not save your material progress.');
    } finally {
      setUpdatingMaterialId(null);
    }
  };

  const openMaterial = (material: CurriculumMaterial) => {
    setViewingMaterial(material);
    if (canTrackProgress && material.progressStatus === 'not_started') void markMaterialProgress(material, 'in_progress');
  };

  const submitLearningCheck = async (event: FormEvent) => {
    event.preventDefault();
    const learningCheck = activeLearningCheckDay ? learningChecksByDay[activeLearningCheckDay] : null;
    if (!learningCheck || !activeLearningCheckDay || Object.keys(learningCheckAnswers).length !== learningCheck.questions.length) {
      setLearningCheckError('Answer every question before submitting.');
      return;
    }
    setSubmittingLearningCheck(true);
    setLearningCheckError('');
    try {
      const result = await submitCurriculumLearningCheck(activeLearningCheckDay, learningCheckAnswers);
      setLearningCheckResult({ score: result.score, passed: result.passed });
      setLearningCheckAnswers({});
      await Promise.all([loadLearningCheck(activeLearningCheckDay, true), onProgressRefresh()]);
    } catch (error) {
      setLearningCheckError(error instanceof Error ? error.message : 'Could not submit the learning check.');
    } finally {
      setSubmittingLearningCheck(false);
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
            const dayMaterials = materialsByDay[day.dayNumber] || [];
            const materialsLoading = Boolean(loadingMaterialsByDay[day.dayNumber]);
            const dayLearningCheck = learningChecksByDay[day.dayNumber];
            const dayOneRequiredCount = dayMaterials.filter((material) => material.isRequired).length;
            const dayOneCompletedCount = dayMaterials.filter((material) => material.isRequired && material.progressStatus === 'completed').length;

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
                    {canTrackProgress && <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-3 dark:border-indigo-900/60 dark:bg-indigo-950/30"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-semibold text-slate-700 dark:text-slate-200">Required learning materials reviewed</span><span className="text-xs font-bold text-indigo-700 dark:text-indigo-300">{materialsLoading ? 'Loading…' : `${dayOneCompletedCount} of ${dayOneRequiredCount}`}</span></div><div className="mt-2 flex flex-wrap items-center justify-between gap-2"><p className="text-[11px] text-slate-600 dark:text-slate-400">{day.completed ? `Day ${day.dayNumber} complete — required materials reviewed and learning check passed.` : dayLearningCheck?.latestAttempt ? `Latest check: ${dayLearningCheck.latestAttempt.score}% · ${dayLearningCheck.latestAttempt.passed ? 'Passed' : `Not passed (need ${dayLearningCheck.passingScore}%)`} · ${dayLearningCheck.attemptCount} attempt${dayLearningCheck.attemptCount === 1 ? '' : 's'}` : `Review every required item and pass the Day ${day.dayNumber} learning check to complete this day.`}</p><button type="button" disabled={!dayLearningCheck || !dayOneRequiredCount || materialsLoading || Boolean(loadingChecksByDay[day.dayNumber]) || day.completed} onClick={() => { setActiveLearningCheckDay(day.dayNumber); setLearningCheckResult(null); setLearningCheckAnswers({}); setLearningCheckOpen(true); }} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"><FileCheck2 className="h-3.5 w-3.5" />{day.completed ? 'Day complete' : dayLearningCheck?.latestAttempt ? 'Retake learning check' : 'Start learning check'}</button></div>{!dayOneRequiredCount && !materialsLoading && <p className="mt-2 text-[11px] font-medium text-amber-700 dark:text-amber-300">Your trainer needs to publish at least one required material before this day can be completed.</p>}{learningCheckError && <p role="alert" className="mt-2 text-[11px] text-rose-600 dark:text-rose-300">{learningCheckError}</p>}</div>}
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

                    <section className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div><h4 className="text-sm font-bold text-slate-900 dark:text-white">Day {day.dayNumber} learning materials</h4><p className="text-xs text-slate-500">Videos, readings, and PDFs for this day’s topics.</p></div>
                        {!canTrackProgress && <button type="button" onClick={() => setMaterialDraft({ dayNumber: day.dayNumber, title: '', materialType: 'video', contentUrl: '', contentText: '', contentFormat: 'markdown', isRequired: true })} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-700"><Plus className="h-3.5 w-3.5" />Add material</button>}
                      </div>

                      {materialsError && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{materialsError}{materialsError.includes('migration') && <span> Run <code>npm run db:migrate-auth</code>, then refresh this page.</span>}</div>}
                      {materialDraft && materialDraft.dayNumber === day.dayNumber && !canTrackProgress && <form onSubmit={(event) => void saveMaterial(event)} className="grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60 sm:grid-cols-2">
                        <label className="space-y-1 sm:col-span-2"><span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Title</span><input required maxLength={191} value={materialDraft.title} onChange={(event) => setMaterialDraft((draft) => draft ? { ...draft, title: event.target.value } : draft)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="e.g. Big-O notation introduction" /></label>
                        <label className="space-y-1"><span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Material type</span><select value={materialDraft.materialType} onChange={(event) => setMaterialDraft((draft) => draft ? { ...draft, materialType: event.target.value as CurriculumMaterialType } : draft)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"><option value="video">Video</option><option value="text">Text / reading</option><option value="pdf">PDF / slides</option></select></label>
                        <label className="flex items-center gap-2 self-end pb-2 text-xs font-medium text-slate-700 dark:text-slate-300"><input type="checkbox" checked={materialDraft.isRequired} onChange={(event) => setMaterialDraft((draft) => draft ? { ...draft, isRequired: event.target.checked } : draft)} />Required for Day {day.dayNumber}</label>
                        {materialDraft.materialType === 'text' ? <><label className="space-y-1"><span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Content format</span><select value={materialDraft.contentFormat} onChange={(event) => setMaterialDraft((draft) => draft ? { ...draft, contentFormat: event.target.value as CurriculumTextFormat } : draft)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"><option value="markdown">Markdown</option><option value="html">HTML</option></select></label><p className="self-end pb-2 text-[11px] text-slate-500">{materialDraft.contentFormat === 'markdown' ? 'Supports headings, lists, links, tables, quotes, and code blocks.' : 'HTML is sanitized before display; scripts and embedded content are removed.'}</p><label className="space-y-1 sm:col-span-2"><span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Lesson content</span><textarea required rows={12} maxLength={50000} value={materialDraft.contentText} onChange={(event) => setMaterialDraft((draft) => draft ? { ...draft, contentText: event.target.value } : draft)} className={`w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 ${materialDraft.contentFormat === 'html' ? 'font-mono' : ''}`} placeholder={materialDraft.contentFormat === 'markdown' ? '# Lesson title\n\nWrite your notes using **Markdown**…' : '<h1>Lesson title</h1>\n<p>Write the lesson in HTML…</p>'} /></label></> : <label className="space-y-1 sm:col-span-2"><span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{materialDraft.materialType === 'video' ? 'Video URL' : 'PDF URL'}</span><input required type="url" value={materialDraft.contentUrl} onChange={(event) => setMaterialDraft((draft) => draft ? { ...draft, contentUrl: event.target.value } : draft)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="https://…" /></label>}
                        <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={() => setMaterialDraft(null)} className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700"><X className="h-3.5 w-3.5" />Cancel</button><button disabled={savingMaterial} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><Save className="h-3.5 w-3.5" />{savingMaterial ? 'Saving…' : materialDraft.id ? 'Save changes' : 'Add material'}</button></div>
                      </form>}

                      {materialsLoading ? <p className="text-xs text-slate-500">Loading Day {day.dayNumber} materials…</p> : dayMaterials.length === 0 ? <p className="rounded-lg bg-slate-50 px-3 py-4 text-xs text-slate-500 dark:bg-slate-800/50">{canTrackProgress ? `Your trainer has not added Day ${day.dayNumber} materials yet.` : `No materials have been published for Day ${day.dayNumber}.`}</p> : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{dayMaterials.map((material) => {
                        const MaterialIcon = material.materialType === 'text' ? BookOpen : material.materialType === 'pdf' ? FileText : Play;
                        const materialLabel = material.materialType === 'text' ? 'Text lesson' : material.materialType === 'pdf' ? 'PDF viewer' : 'Video player';
                        const preview = material.materialType === 'text' ? lessonSummary(material) : material.materialType === 'pdf' ? 'Open the document in the course viewer.' : 'Watch this training video in the course viewer.';
                        return <article key={material.id} className="flex min-h-[220px] flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md dark:border-slate-700 dark:bg-slate-900 dark:hover:border-indigo-800">
                          <div className="flex items-start justify-between gap-2"><span className={`inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-bold ${material.materialType === 'text' ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' : material.materialType === 'pdf' ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' : 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300'}`}><MaterialIcon className="h-4 w-4" />{materialLabel}</span>
                            {!canTrackProgress && <div className="flex items-center gap-1"><button type="button" title="Edit material" onClick={() => setMaterialDraft({ id: material.id, dayNumber: material.dayNumber, title: material.title, materialType: material.materialType, contentUrl: material.contentUrl || '', contentText: material.contentText || '', contentFormat: material.contentFormat || 'markdown', isRequired: material.isRequired })} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-800"><Pencil className="h-4 w-4" /></button><button type="button" title="Delete material" onClick={() => void removeMaterial(material)} className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-slate-800"><Trash2 className="h-4 w-4" /></button></div>}
                          </div>
                          <button type="button" onClick={() => openMaterial(material)} className="mt-3 flex flex-1 flex-col text-left"><span className="line-clamp-2 text-sm font-bold leading-5 text-slate-900 dark:text-white">{material.title}</span><span className="mt-2 line-clamp-3 text-xs leading-5 text-slate-500 dark:text-slate-400">{preview}{material.materialType === 'text' && (material.contentText || '').length > 115 ? '…' : ''}</span><span className="mt-auto inline-flex items-center gap-1 pt-3 text-xs font-bold text-indigo-600 dark:text-indigo-300">Open {material.materialType === 'text' ? 'lesson' : material.materialType === 'pdf' ? 'PDF' : 'video'} <ArrowRight className="h-3.5 w-3.5" /></span></button>
                          <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800"><span className={`rounded px-2 py-1 text-[10px] font-semibold ${material.isRequired ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>{material.isRequired ? 'Required' : 'Optional'}</span>{canTrackProgress ? <button type="button" disabled={updatingMaterialId === material.id} onClick={() => void markMaterialProgress(material, material.progressStatus === 'completed' ? 'in_progress' : 'completed')} className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold disabled:opacity-50 ${material.progressStatus === 'completed' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'}`}>{updatingMaterialId === material.id ? 'Saving…' : material.progressStatus === 'completed' ? 'Reviewed ✓ · Undo' : material.materialType === 'text' ? 'Mark read' : material.materialType === 'pdf' ? 'Mark reviewed' : 'Mark watched'}</button> : <span className="text-[11px] font-medium text-slate-400">{material.progressStatus === 'completed' ? 'Reviewed' : ''}</span>}</div>
                        </article>;
                      })}</div>}
                      {canTrackProgress && dayOneRequiredCount > 0 && <p className="text-[11px] text-slate-500">Your material status is saved to your student account. Video and document review is currently self-reported; it does not mark the whole day complete.</p>}
                    </section>

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
    {learningCheckOpen && activeLearningCheck && createPortal(<div className="fixed inset-0 z-[9998] flex items-center justify-center bg-slate-950/75 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setLearningCheckOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="day-learning-check-title" className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700"><div><p className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-300">Day {activeLearningCheckDay} · Learning check</p><h2 id="day-learning-check-title" className="text-lg font-bold text-slate-900 dark:text-white">{activeLearningCheck.title}</h2><p className="mt-1 text-xs text-slate-500">{activeLearningCheck.questions.length} questions · pass mark {activeLearningCheck.passingScore}% · attempts are saved</p></div><button type="button" onClick={() => setLearningCheckOpen(false)} aria-label="Close learning check" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button></header>
        {learningCheckResult ? <div className="overflow-y-auto p-6 text-center"><div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${learningCheckResult.passed ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300'}`}><CheckCircle2 className="h-7 w-7" /></div><h3 className="mt-4 text-xl font-extrabold text-slate-900 dark:text-white">{learningCheckResult.passed ? 'Learning check passed' : 'Keep practicing'}</h3><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Your score: <strong>{learningCheckResult.score}%</strong>. {learningCheckResult.passed ? 'Your result is saved.' : `You need ${activeLearningCheck.passingScore}% to pass. You can review the material and try again.`}</p><p className="mt-2 text-xs text-slate-500">{activeLearningCheck.completion.requiredCount > 0 && activeLearningCheck.completion.completedCount === activeLearningCheck.completion.requiredCount ? learningCheckResult.passed ? 'Your required materials are reviewed, so this day is now complete.' : 'Your materials are reviewed. Pass the check to complete this day.' : `Review ${Math.max(activeLearningCheck.completion.requiredCount - activeLearningCheck.completion.completedCount, 0)} remaining required material${activeLearningCheck.completion.requiredCount - activeLearningCheck.completion.completedCount === 1 ? '' : 's'} to complete this day.`}</p><div className="mt-6 flex justify-center gap-2"><button type="button" onClick={() => learningCheckResult.passed ? setLearningCheckOpen(false) : (setLearningCheckResult(null), setLearningCheckAnswers({}))} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">{learningCheckResult.passed ? 'Done' : 'Try again'}</button></div></div> : <form onSubmit={(event) => void submitLearningCheck(event)} className="flex min-h-0 flex-1 flex-col"><div className="space-y-5 overflow-y-auto p-5">{activeLearningCheck.questions.map((question, questionIndex) => <fieldset key={questionIndex} className="space-y-2"><legend className="mb-2 text-sm font-bold text-slate-900 dark:text-white">{questionIndex + 1}. {question.prompt}</legend>{question.options.map((option, optionIndex) => <label key={optionIndex} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm ${learningCheckAnswers[questionIndex] === optionIndex ? 'border-indigo-400 bg-indigo-50 text-indigo-900 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-100' : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'}`}><input type="radio" name={`learning-check-${questionIndex}`} value={optionIndex} checked={learningCheckAnswers[questionIndex] === optionIndex} onChange={() => setLearningCheckAnswers((current) => ({ ...current, [questionIndex]: optionIndex }))} className="mt-0.5 accent-indigo-600" /><span>{option}</span></label>)}</fieldset>)}</div>{learningCheckError && <p role="alert" className="px-5 pb-2 text-sm text-rose-600">{learningCheckError}</p>}<footer className="flex items-center justify-between border-t border-slate-200 px-5 py-4 dark:border-slate-700"><span className="text-xs text-slate-500">{Object.keys(learningCheckAnswers).length} / {activeLearningCheck.questions.length} answered</span><button type="submit" disabled={submittingLearningCheck || Object.keys(learningCheckAnswers).length !== activeLearningCheck.questions.length} className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">{submittingLearningCheck ? 'Submitting…' : 'Submit learning check'}</button></footer></form>}
      </section>
    </div>, document.body)}
    {viewingMaterial && createPortal(<div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/75 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewingMaterial(null); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="learning-resource-title" className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 dark:border-slate-700 sm:px-6"><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-300">Day {viewingMaterial.dayNumber} learning material</p><h2 id="learning-resource-title" className="truncate text-base font-bold text-slate-900 dark:text-white">{viewingMaterial.title}</h2></div><button type="button" onClick={() => setViewingMaterial(null)} aria-label="Close viewer" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button></header>
        <div className="min-h-[50vh] flex-1 bg-slate-100 dark:bg-slate-950 sm:min-h-[65vh]">
          {viewingMaterial.materialType === 'text' ? <div className="h-[72vh] min-h-[50vh] w-full overflow-y-auto bg-white px-5 py-6 dark:bg-slate-900 sm:px-8"><article className="lesson-rich-content mx-auto max-w-3xl text-sm leading-7 text-slate-700 dark:text-slate-200" dangerouslySetInnerHTML={{ __html: renderLessonHtml(viewingMaterial.contentText || '', viewingMaterial.contentFormat || 'markdown') }} /></div> : viewingMaterial.materialType === 'pdf' ? <div className="relative h-[72vh] min-h-[50vh] w-full"><iframe title={viewingMaterial.title} src={embeddedPdfUrl(viewingMaterial.contentUrl || '')} referrerPolicy="strict-origin-when-cross-origin" className="h-full w-full border-0" />{isGoogleHostedPdf(viewingMaterial.contentUrl || '') && <div aria-hidden="true" onClick={(event) => { event.preventDefault(); event.stopPropagation(); }} className="absolute right-0 top-0 z-10 h-14 w-14 cursor-default rounded-bl-md bg-[#1f1f1f]" />}</div> : viewingMaterial.materialType === 'video' && isDirectVideo(viewingMaterial.contentUrl || '') ? <video src={viewingMaterial.contentUrl || undefined} controls controlsList="nodownload noplaybackrate noremoteplayback nofullscreen" disablePictureInPicture className="mx-auto max-h-[75vh] w-full bg-black" /> : <iframe title={viewingMaterial.title} src={embeddedVideoUrl(viewingMaterial.contentUrl || '')} allow="accelerometer; autoplay; encrypted-media; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" className="h-[72vh] min-h-[50vh] w-full border-0" />}
        </div>
        <p className="border-t border-slate-200 px-4 py-2 text-[11px] text-slate-500 dark:border-slate-700 sm:px-6">This preview keeps you in the course. A browser preview cannot fully prevent copying, screen capture, or access to an externally hosted source.</p>
      </section>
    </div>, document.body)}
    </>
  );
};
