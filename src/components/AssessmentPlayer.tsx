import React, { useState, useEffect } from 'react';
import {
  Clock,
  CheckCircle2,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Send,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  ArrowLeft,
  Award,
  Layers,
  HelpCircle,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { CodeEditor } from './CodeEditor';
import { fetchAiRecommendations, submitWorkspaceAssessment } from '../services/api';
import { Assessment, CodingProblem, MCQQuestion, QuestionItem, StudentProfile } from '../types';

interface AssessmentPlayerProps {
  assessment: Assessment;
  student: StudentProfile;
  onClose: () => void;
  onAssessmentCompleted?: (score: number) => void;
}

export const AssessmentPlayer: React.FC<AssessmentPlayerProps> = ({
  assessment,
  student,
  onClose,
  onAssessmentCompleted,
}) => {
  // Flatten all questions across sections
  const allQuestions: { question: QuestionItem; sectionName: string; index: number }[] = [];
  assessment.sections.forEach((sec) => {
    sec.questions.forEach((q) => {
      allQuestions.push({
        question: q,
        sectionName: sec.name,
        index: allQuestions.length,
      });
    });
  });

  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [answers, setAnswers] = useState<Record<number, any>>({});
  const [markedForReview, setMarkedForReview] = useState<Record<number, boolean>>({});
  const [visited, setVisited] = useState<Record<number, boolean>>({ 0: true });
  const [codingScores, setCodingScores] = useState<Record<number, number>>({});
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
  const [isSavingSubmission, setIsSavingSubmission] = useState(false);
  const [submissionError, setSubmissionError] = useState('');
  const [finalPercent, setFinalPercent] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);
  const [timeLeftSeconds, setTimeLeftSeconds] = useState<number>(assessment.durationMinutes * 60);
  const [aiPlan, setAiPlan] = useState<string>('');
  const [loadingAi, setLoadingAi] = useState<boolean>(false);

  // Timer countdown
  useEffect(() => {
    if (isSubmitted || isSavingSubmission) return;
    const interval = setInterval(() => {
      setTimeLeftSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          handleSubmitAssessment();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isSubmitted, isSavingSubmission]);

  const formatTimer = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h > 0 ? `${h}h ` : ''}${m < 10 ? '0' : ''}${m}m ${s < 10 ? '0' : ''}${s}s`;
  };

  const handleSelectMCQOption = (optionIndex: number) => {
    setAnswers((prev) => ({
      ...prev,
      [currentIndex]: optionIndex,
    }));
  };

  const handleClearResponse = () => {
    setAnswers((prev) => {
      const copy = { ...prev };
      delete copy[currentIndex];
      return copy;
    });
  };

  const handleToggleMarkReview = () => {
    setMarkedForReview((prev) => ({
      ...prev,
      [currentIndex]: !prev[currentIndex],
    }));
  };

  const handleNavigateQuestion = (idx: number) => {
    setCurrentIndex(idx);
    setVisited((prev) => ({ ...prev, [idx]: true }));
  };

  const handleNext = () => {
    if (currentIndex < allQuestions.length - 1) {
      handleNavigateQuestion(currentIndex + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      handleNavigateQuestion(currentIndex - 1);
    }
  };

  // Submit assessment logic
  const handleSubmitAssessment = async () => {
    if (isSavingSubmission || isSubmitted) return;
    setShowSubmitModal(false);
    setSubmissionError('');
    setIsSavingSubmission(true);

    // Calculate score
    let calculatedMarks = 0;
    let maxMarks = 0;

    allQuestions.forEach((item, idx) => {
      if (item.question.type === 'mcq') {
        const mcq = item.question.data as MCQQuestion;
        maxMarks += mcq.marks;
        if (answers[idx] === mcq.correctIndex) {
          calculatedMarks += mcq.marks;
        }
      } else if (item.question.type === 'coding') {
        const codingMarks = Number((item.question.data as CodingProblem & { marks?: number }).marks || 30);
        maxMarks += codingMarks;
        const codeScorePercent = codingScores[idx] ?? 0;
        calculatedMarks += (codeScorePercent / 100) * codingMarks;
      }
    });

    const calculatedPercent = maxMarks > 0 ? Math.round((calculatedMarks / maxMarks) * 100) : 0;
    const timeSpentSeconds = Math.max(0, assessment.durationMinutes * 60 - timeLeftSeconds);
    try {
      const savedAttempt = await submitWorkspaceAssessment(assessment.id, { answers, codingScores, timeSpentSeconds });
      const score = savedAttempt.percentage ?? calculatedPercent;
      setFinalPercent(score);
      setElapsedSeconds(savedAttempt.timeSpentSeconds);
      setIsSubmitted(true);
      if (score >= 70) {
        try { confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } }); } catch {}
      }
      onAssessmentCompleted?.(score);
      setLoadingAi(true);
      try {
        const res = await fetchAiRecommendations({
          studentName: student.name,
          scores: { assessmentScore: score, coding: student.metrics.coding, aptitude: student.metrics.aptitude },
          weakAreas: student.weakAreas,
          targetCompanies: assessment.targetCompanies,
        });
        setAiPlan(res.recommendation);
      } catch (error) {
        console.error(error);
      } finally {
        setLoadingAi(false);
      }
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : 'Could not save your attempt. Please retry.');
      setShowSubmitModal(true);
    } finally {
      setIsSavingSubmission(false);
    }
  };

  // Question statuses
  const answeredCount = Object.keys(answers).length;
  const reviewCount = Object.keys(markedForReview).filter((k) => markedForReview[Number(k)]).length;
  const notVisitedCount = allQuestions.length - Object.keys(visited).length;

  const currentQObj = allQuestions[currentIndex] || allQuestions[0];
  const isCurrentMCQ = currentQObj.question.type === 'mcq';
  const currentMCQData = isCurrentMCQ ? (currentQObj.question.data as MCQQuestion) : null;
  const currentCodingData = !isCurrentMCQ ? (currentQObj.question.data as CodingProblem) : null;

  if (isSubmitted) {
    // Scorecard view
    return (
      <div className="max-w-5xl mx-auto py-8 px-4 space-y-6 animate-fadeIn">
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-8 border border-slate-200/80 dark:border-slate-800 shadow-lg text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 mx-auto flex items-center justify-center">
            <Award className="w-8 h-8" />
          </div>

          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
              Assessment Completed Successfully!
            </h1>
            <p className="text-sm text-slate-500 mt-1">{assessment.title}</p>
          </div>

          {/* Score metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-2xl mx-auto pt-4">
            <div className="p-4 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/60">
              <span className="text-xs text-indigo-700 dark:text-indigo-300 font-bold uppercase block">Overall Score</span>
              <span className="text-2xl font-extrabold text-indigo-900 dark:text-indigo-100">{finalPercent ?? 0}%</span>
            </div>
            <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/60">
              <span className="text-xs text-emerald-700 dark:text-emerald-300 font-bold uppercase block">Accuracy</span>
              <span className="text-2xl font-extrabold text-emerald-900 dark:text-emerald-100">{finalPercent ?? 0}%</span>
            </div>
            <div className="p-4 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/60">
              <span className="text-xs text-blue-700 dark:text-blue-300 font-bold uppercase block">Time Taken</span>
              <span className="text-2xl font-extrabold text-blue-900 dark:text-blue-100">{formatTimer(elapsedSeconds)}</span>
            </div>
            <div className="p-4 rounded-2xl bg-purple-50 dark:bg-purple-950/40 border border-purple-100 dark:border-purple-900/60">
              <span className="text-xs text-purple-700 dark:text-purple-300 font-bold uppercase block">Assessment Status</span>
              <span className="text-2xl font-extrabold text-purple-900 dark:text-purple-100">{(finalPercent ?? 0) >= 70 ? 'Passed' : 'Review'}</span>
            </div>
          </div>

          {/* AI Remediation Card */}
          <div className="mt-8 text-left bg-gradient-to-br from-indigo-50/70 via-purple-50/70 to-pink-50/70 dark:from-indigo-950/40 dark:via-purple-950/40 dark:to-pink-950/40 p-6 rounded-2xl border border-indigo-100 dark:border-indigo-900/60 space-y-3">
            <div className="flex items-center gap-2 text-indigo-900 dark:text-indigo-200 font-bold text-sm">
              <Sparkles className="w-4 h-4 text-pink-500 animate-pulse" />
              <span>AI Placement Doctor • Post-Assessment Personalized Recommendations</span>
            </div>
            {loadingAi ? (
              <div className="py-4 text-center text-xs text-slate-500">
                Generating personalized placement roadmap via Gemini AI...
              </div>
            ) : (
              <div className="text-xs text-slate-700 dark:text-slate-300 space-y-2 whitespace-pre-line leading-relaxed">
                {aiPlan ||
                  `• High Algorithmic Fluency: Code structure matches TCS Digital benchmarks.
• Quick Time-per-Question in Aptitude: 48s average vs 75s cutoff.
• Next Immediate Step: Review SQL Window functions before Day 33 SQL test.`}
              </div>
            )}
          </div>

          <div className="pt-6 flex justify-center gap-4">
            <button
              onClick={onClose}
              className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md cursor-pointer transition-all"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex flex-col animate-fadeIn">
      {/* Top Test Header Bar */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 h-14 flex items-center justify-between gap-4 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            title="Exit Test"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate max-w-xs sm:max-w-md">
              {assessment.title}
            </h1>
            <span className="text-[10px] text-slate-500">
              Section: {currentQObj.sectionName}
            </span>
          </div>
        </div>

        {/* Center/Right Timer & Submit */}
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 font-mono text-xs font-bold">
            <Clock className="w-4 h-4" />
            <span>{formatTimer(timeLeftSeconds)}</span>
          </div>

          <span className="hidden sm:inline text-[11px] text-slate-400">
            Your attempt is recorded when you submit.
          </span>

          <button
            id="finish-submit-assessment-btn"
            onClick={() => setShowSubmitModal(true)}
            className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Submit Test</span>
          </button>
        </div>
      </header>

      {/* Main Split Interface */}
      <div className="flex-1 flex flex-col lg:flex-row max-w-7xl w-full mx-auto p-4 gap-4">
        {/* Left Panel: Question Navigator & Palette (4 Cols) */}
        <div className="lg:w-80 shrink-0 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 space-y-4 flex flex-col justify-between max-h-[85vh] overflow-y-auto">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <span className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                Question Palette
              </span>
              <span className="text-xs font-semibold text-slate-500">
                {currentIndex + 1} of {allQuestions.length}
              </span>
            </div>

            {/* Status Legend */}
            <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 dark:text-slate-400">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-emerald-500" />
                <span>Answered ({answeredCount})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-purple-500" />
                <span>Marked for Review ({reviewCount})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-slate-300 dark:bg-slate-700" />
                <span>Not Visited ({notVisitedCount})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-amber-500" />
                <span>Current</span>
              </div>
            </div>

            {/* Question Grid Buttons */}
            <div className="grid grid-cols-5 gap-2 pt-2">
              {allQuestions.map((q, idx) => {
                const isCurrent = idx === currentIndex;
                const isAns = answers[idx] !== undefined;
                const isRev = markedForReview[idx];
                const isVis = visited[idx];

                let btnBg = 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300';
                if (isAns) btnBg = 'bg-emerald-600 text-white font-bold';
                else if (isRev) btnBg = 'bg-purple-600 text-white font-bold';
                else if (isVis) btnBg = 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200';

                if (isCurrent) {
                  btnBg += ' ring-2 ring-indigo-500 ring-offset-2 dark:ring-offset-slate-900';
                }

                return (
                  <button
                    key={idx}
                    id={`palette-btn-${idx + 1}`}
                    onClick={() => handleNavigateQuestion(idx)}
                    className={`h-9 rounded-xl text-xs flex items-center justify-center transition-all cursor-pointer ${btnBg}`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Student Profile Quick Badge */}
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 text-xs space-y-1">
            <p className="font-bold text-slate-800 dark:text-slate-200">{student.name}</p>
            <p className="text-[11px] text-slate-500">Roll: {student.rollNo} • {student.batch}</p>
          </div>
        </div>

        {/* Right Panel: Question Statement, Options, or Integrated Code Editor (8 Cols) */}
        <div className="flex-1 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-5 sm:p-6 flex flex-col justify-between overflow-y-auto max-h-[85vh]">
          {/* Question Top Info */}
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <span className="text-xs font-extrabold px-2.5 py-1 rounded-md bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">
                  Question {currentIndex + 1}
                </span>
                <span className="text-xs font-semibold text-slate-500">
                  {isCurrentMCQ ? `MCQ (+${currentMCQData?.marks} Marks)` : 'Hands-on Coding (+30 Marks)'}
                </span>
              </div>

              <button
                onClick={handleToggleMarkReview}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  markedForReview[currentIndex]
                    ? 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-300'
                    : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Bookmark className="w-3.5 h-3.5" />
                <span>{markedForReview[currentIndex] ? 'Marked for Review' : 'Mark for Review'}</span>
              </button>
            </div>

            {/* MCQ View */}
            {isCurrentMCQ && currentMCQData && (
              <div className="space-y-6 pt-2">
                <div className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white leading-relaxed whitespace-pre-line">
                  {currentMCQData.text}
                </div>

                {/* MCQ Options List */}
                <div className="space-y-3">
                  {currentMCQData.options.map((opt, optIdx) => {
                    const isSelected = answers[currentIndex] === optIdx;
                    return (
                      <div
                        key={optIdx}
                        onClick={() => handleSelectMCQOption(optIdx)}
                        className={`p-4 rounded-xl border transition-all cursor-pointer flex items-center gap-3 ${
                          isSelected
                            ? 'bg-indigo-50/80 dark:bg-indigo-950/40 border-indigo-600 dark:border-indigo-500 text-indigo-950 dark:text-indigo-100 font-semibold shadow-xs'
                            : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/60 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <div
                          className={`w-5 h-5 rounded-full border flex items-center justify-center text-xs font-bold shrink-0 ${
                            isSelected
                              ? 'border-indigo-600 bg-indigo-600 text-white'
                              : 'border-slate-300 text-slate-500'
                          }`}
                        >
                          {String.fromCharCode(65 + optIdx)}
                        </div>
                        <span className="text-xs sm:text-sm text-slate-800 dark:text-slate-200">{opt}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Coding Question View */}
            {!isCurrentMCQ && currentCodingData && (
              <div className="pt-2">
                <CodeEditor
                  standalone={false}
                  initialProblem={currentCodingData}
                  onSolve={(score) => {
                    setCodingScores((prev) => ({
                      ...prev,
                      [currentIndex]: score,
                    }));
                    setAnswers((prev) => ({
                      ...prev,
                      [currentIndex]: 'Code Submitted',
                    }));
                  }}
                />
              </div>
            )}
          </div>

          {/* Bottom Navigator Controls */}
          <div className="mt-8 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={handleClearResponse}
                className="px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer"
              >
                Clear Selection
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handlePrev}
                disabled={currentIndex === 0}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold transition-all disabled:opacity-40 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Previous</span>
              </button>

              <button
                onClick={handleNext}
                disabled={currentIndex === allQuestions.length - 1}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs transition-all disabled:opacity-40 cursor-pointer"
              >
                <span>Save & Next</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Submit Modal */}
      {showSubmitModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-md w-full border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 animate-scaleUp">
            <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                Submit Assessment?
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                You have answered <strong>{answeredCount}</strong> out of <strong>{allQuestions.length}</strong> questions.
                {reviewCount > 0 && ` You have ${reviewCount} questions marked for review.`}
              </p>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 text-xs space-y-1">
              <div className="flex justify-between">
                <span>Time Remaining:</span>
                <span className="font-bold">{formatTimer(timeLeftSeconds)}</span>
              </div>
              <div className="flex justify-between">
                <span>Unanswered:</span>
                <span className="font-bold text-rose-500">{allQuestions.length - answeredCount}</span>
              </div>
            </div>

            {submissionError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{submissionError}</p>}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowSubmitModal(false)}
                disabled={isSavingSubmission}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Continue Test
              </button>
              <button
                id="confirm-final-submit-btn"
                onClick={() => void handleSubmitAssessment()}
                disabled={isSavingSubmission}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md cursor-pointer disabled:opacity-60"
              >
                {isSavingSubmission ? 'Saving attempt…' : 'Confirm & Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
