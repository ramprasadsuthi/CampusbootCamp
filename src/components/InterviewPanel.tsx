import React, { useEffect, useState } from 'react';
import {
  Code,
  User,
  Star,
  CheckCircle2,
  AlertCircle,
  Briefcase,
  Sparkles,
  Save,
  MessageSquare,
  Building,
  GraduationCap,
} from 'lucide-react';
import { StudentProfile } from '../types';
import { fetchStudentInterviewHistory } from '../services/api';

interface InterviewPanelProps {
  students: StudentProfile[];
  initialType?: 'tech' | 'hr';
  onUpdateStudentRemarks: (studentId: string, remark: any, newScore: number, evaluation: { ratings: Record<string, number>; recommendation: 'hire' | 'borderline' | 'remedial' }) => Promise<void>;
  evaluatorName: string;
}

export const InterviewPanel: React.FC<InterviewPanelProps> = ({
  students,
  initialType = 'tech',
  onUpdateStudentRemarks,
  evaluatorName,
}) => {
  const [interviewType, setInterviewType] = useState<'tech' | 'hr'>(initialType);
  const [selectedStudentId, setSelectedStudentId] = useState<string>(students[0]?.id || 'std-1');
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [interviewHistory, setInterviewHistory] = useState<any[]>([]);

  // Technical interview criteria scores (out of 10)
  const [techScores, setTechScores] = useState({
    coding: 5,
    sql: 5,
    oop: 5,
    projects: 5,
    problemSolving: 5,
    communication: 5,
  });

  // HR interview criteria scores (out of 10)
  const [hrScores, setHrScores] = useState({
    resumeReview: 5,
    confidence: 5,
    communication: 5,
    behavioralStar: 5,
    leadership: 5,
    teamwork: 5,
    adaptability: 5,
  });

  const [remarks, setRemarks] = useState<string>('');

  const [verdict, setVerdict] = useState<'hire' | 'borderline' | 'remedial'>('borderline');

  const currentStudent = students.find((s) => s.id === selectedStudentId) || students[0];

  useEffect(() => {
    if (!currentStudent?.id) {
      setInterviewHistory([]);
      return;
    }
    fetchStudentInterviewHistory(currentStudent.id)
      .then(setInterviewHistory)
      .catch((error) => console.error('Failed to load interview history:', error));
  }, [currentStudent?.id, savedSuccess]);

  const handleSaveEvaluation = async () => {
    if (!currentStudent?.id || !remarks.trim()) {
      setSaveError('Select a student and enter interview feedback before saving.');
      return;
    }
    // Calculate aggregate score
    let totalScore = 0;
    if (interviewType === 'tech') {
      const vals: number[] = Object.values(techScores);
      totalScore = Math.round((vals.reduce((a: number, b: number) => a + b, 0) / (vals.length * 10)) * 100);
    } else {
      const vals: number[] = Object.values(hrScores);
      totalScore = Math.round((vals.reduce((a: number, b: number) => a + b, 0) / (vals.length * 10)) * 100);
    }

    setSaving(true);
    setSaveError('');
    try {
      await onUpdateStudentRemarks(
        currentStudent.id,
        {
          id: `rem-${Date.now()}`,
          trainerName: evaluatorName,
          date: new Date().toISOString().slice(0, 10),
          comment: remarks.trim(),
          type: interviewType,
          score: totalScore,
        },
        totalScore,
        { ratings: interviewType === 'tech' ? techScores : hrScores, recommendation: verdict },
      );
      setSavedSuccess(true);
      window.setTimeout(() => setSavedSuccess(false), 3000);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save the evaluation.');
    } finally {
      setSaving(false);
    }
  };

  if (!currentStudent) {
    return <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">No students are assigned to your accessible batches yet.</div>;
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-xs font-bold mb-2">
            <Briefcase className="w-3.5 h-3.5" />
            <span>Trainer & Panelist Evaluation Portal</span>
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Mock Interview Evaluation Console
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Conduct structured technical round reviews (DSA/SQL/OOP) and HR behavioral interviews using the STAR method.
          </p>
        </div>

        {/* Tab Switcher: Tech vs HR */}
        <div className="flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
          <button
            onClick={() => setInterviewType('tech')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              interviewType === 'tech'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <Code className="w-3.5 h-3.5" />
            Technical Round
          </button>
          <button
            onClick={() => setInterviewType('hr')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              interviewType === 'hr'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            HR & Behavioral Round
          </button>
        </div>
      </div>

      {/* Main Grid: Student Picker & Evaluation Form */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Col: Candidate Selector (4 Cols) */}
        <div className="lg:col-span-4 bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Select Candidate to Evaluate
          </h2>

          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {students.map((st) => {
              const isSelected = st.id === selectedStudentId;
              return (
                <div
                  key={st.id}
                  onClick={() => {
                    setSelectedStudentId(st.id);
                    setSavedSuccess(false);
                  }}
                  className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center gap-3 ${
                    isSelected
                      ? 'bg-indigo-50/80 dark:bg-indigo-950/40 border-indigo-500 dark:border-indigo-600 shadow-xs'
                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200/60 dark:border-slate-700/60 hover:bg-slate-100'
                  }`}
                >
                  <img
                    src={st.photo}
                    alt={st.name}
                    className="w-11 h-11 rounded-xl object-cover border border-slate-200 dark:border-slate-700"
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      {st.name}
                    </h3>
                    <p className="text-[11px] text-slate-500 truncate">Roll: {st.rollNo}</p>
                    <p className="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold truncate">
                      {st.batch}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-black text-slate-800 dark:text-slate-200">
                      {interviewType === 'tech' ? `${st.metrics.techInterview}%` : `${st.metrics.hrInterview}%`}
                    </span>
                    <p className="text-[9px] text-slate-400">Current</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Col: Interactive Rubric & Grading (8 Cols) */}
        <div className="lg:col-span-8 bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-6">
          {/* Candidate Quick Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <img
                src={currentStudent.photo}
                alt={currentStudent.name}
                className="w-12 h-12 rounded-xl object-cover border border-indigo-200"
              />
              <div>
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                  {currentStudent.name}
                </h3>
                <p className="text-xs text-slate-500">
                  {currentStudent.branch} • {currentStudent.college}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-bold px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
                Placement Score: {currentStudent.placementReadinessScore}%
              </span>
            </div>
          </div>

          {/* Technical Round Rubric */}
          {interviewType === 'tech' && (
            <div className="space-y-4">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                Technical Competency Rubric (1 - 10 Scale)
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { key: 'coding', label: 'Algorithmic Problem Solving & DSA', icon: Code },
                  { key: 'sql', label: 'SQL Queries & Relational Design', icon: Building },
                  { key: 'oop', label: 'OOPs Concepts & Clean Architecture', icon: GraduationCap },
                  { key: 'projects', label: 'Real-world Project Defensibility', icon: Briefcase },
                  { key: 'problemSolving', label: 'Logical & Edge Case Thinking', icon: Sparkles },
                  { key: 'communication', label: 'Technical Explanation & Articulation', icon: MessageSquare },
                ].map((item) => {
                  const score = techScores[item.key as keyof typeof techScores];
                  return (
                    <div
                      key={item.key}
                      className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          {item.label}
                        </span>
                        <span className="text-xs font-extrabold text-indigo-600 dark:text-indigo-400">
                          {score} / 10
                        </span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="10"
                        value={score}
                        onChange={(e) =>
                          setTechScores((prev) => ({
                            ...prev,
                            [item.key]: Number(e.target.value),
                          }))
                        }
                        className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* HR & Behavioral Rubric */}
          {interviewType === 'hr' && (
            <div className="space-y-4">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                HR & Behavioral Competency Rubric (1 - 10 Scale)
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { key: 'resumeReview', label: 'Resume Credibility & Background', icon: GraduationCap },
                  { key: 'confidence', label: 'Poise, Body Language & Confidence', icon: Sparkles },
                  { key: 'communication', label: 'Spoken English & Verbal Fluency', icon: MessageSquare },
                  { key: 'behavioralStar', label: 'STAR Methodology Response Quality', icon: Star },
                  { key: 'leadership', label: 'Initiative & Conflict Resolution', icon: User },
                  { key: 'teamwork', label: 'Collaboration & Cross-functional Fit', icon: Briefcase },
                  { key: 'adaptability', label: 'Cultural Adaptability & Willingness', icon: CheckCircle2 },
                ].map((item) => {
                  const score = hrScores[item.key as keyof typeof hrScores];
                  return (
                    <div
                      key={item.key}
                      className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          {item.label}
                        </span>
                        <span className="text-xs font-extrabold text-indigo-600 dark:text-indigo-400">
                          {score} / 10
                        </span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="10"
                        value={score}
                        onChange={(e) =>
                          setHrScores((prev) => ({
                            ...prev,
                            [item.key]: Number(e.target.value),
                          }))
                        }
                        className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Panel Verdict & Remarks */}
          <div className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div>
              <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                Panel Recommendation & Hiring Verdict
              </label>
              <div className="flex flex-wrap gap-3">
                {[
                  { id: 'hire', label: 'Strong Hire (Tier 1)', color: 'border-emerald-500 text-emerald-700 bg-emerald-50' },
                  { id: 'borderline', label: 'Borderline / Qualified for Tier 2', color: 'border-amber-500 text-amber-700 bg-amber-50' },
                  { id: 'remedial', label: 'Needs Remedial Mock Round', color: 'border-rose-500 text-rose-700 bg-rose-50' },
                ].map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setVerdict(v.id as any)}
                    className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      verdict === v.id
                        ? `${v.color} shadow-xs ring-2 ring-indigo-500`
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50'
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                Detailed Trainer Remarks & Remedial Instructions
              </label>
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={3}
                className="w-full p-3 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Enter feedback for student portfolio, resume tweaks, or conceptual gaps..."
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <div>
                {savedSuccess && (
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 animate-fadeIn">
                    <CheckCircle2 className="w-4 h-4" />
                    Evaluation saved & candidate record updated!
                  </span>
                )}
              </div>

              <button
                id="save-interview-eval-btn"
                onClick={() => void handleSaveEvaluation()}
                disabled={saving}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md transition-all cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>{saving ? 'Saving…' : 'Save Evaluation & Remarks'}</span>
              </button>
            </div>
            {saveError && <p role="alert" className="text-xs font-semibold text-rose-600">{saveError}</p>}
          </div>
        </div>
      </div>
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-100 p-5 dark:border-slate-800"><h2 className="font-bold text-slate-900 dark:text-white">Saved interview evaluations</h2><p className="mt-1 text-xs text-slate-500">History for {currentStudent.name} in this workspace.</p></div>
        {interviewHistory.length === 0 ? <p className="p-5 text-sm text-slate-500">No saved evaluations yet.</p> : <div className="divide-y divide-slate-100 dark:divide-slate-800">{interviewHistory.map((record) => <article key={record.id} className="flex flex-col gap-2 p-5 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold uppercase text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">{record.type === 'tech' ? 'Technical' : 'HR'}</span><span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{record.recommendation}</span><span className="text-[11px] text-slate-400">{record.date}</span></div><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{record.remarks}</p><p className="mt-1 text-[11px] text-slate-400">Panel: {record.panel}</p></div><span className="shrink-0 text-lg font-extrabold text-indigo-600 dark:text-indigo-300">{record.score}%</span></article>)}</div>}
      </section>
    </div>
  );
};
