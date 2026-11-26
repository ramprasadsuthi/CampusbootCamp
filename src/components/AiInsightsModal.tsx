import React, { useEffect, useState } from 'react';
import {
  Sparkles,
  Brain,
  Building,
  Target,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Lightbulb,
  FileText,
} from 'lucide-react';
import {
  fetchAiRecommendations,
  predictCompanyReadiness,
  generateTrainerSummary,
  recordReadinessOutcome,
  fetchReadinessPredictionEvaluation,
  fetchPendingReadinessPredictions,
} from '../services/api';
import { StudentProfile } from '../types';

interface AiInsightsModalProps {
  student: StudentProfile;
  isOpen: boolean;
  onClose: () => void;
  canRecordOutcome?: boolean;
}

export const AiInsightsModal: React.FC<AiInsightsModalProps> = ({
  student,
  isOpen,
  onClose,
  canRecordOutcome = false,
}) => {
  const [activeTab, setActiveTab] = useState<'doctor' | 'predict' | 'trainer_notes'>('doctor');
  const [loading, setLoading] = useState<boolean>(false);
  const [doctorResponse, setDoctorResponse] = useState<string>('');
  const [doctorGeneratedByAI, setDoctorGeneratedByAI] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<string>('TCS NQT');
  const [predictionData, setPredictionData] = useState<any>(null);
  const [trainerSummary, setTrainerSummary] = useState<string>('');
  const [trainerGeneratedByAI, setTrainerGeneratedByAI] = useState(false);
  const [aiError, setAiError] = useState('');
  const [outcomeSaved, setOutcomeSaved] = useState('');
  const [predictionEvaluation, setPredictionEvaluation] = useState<any>(null);
  const [pendingOutcomes, setPendingOutcomes] = useState<any[]>([]);

  useEffect(() => {
    if (!isOpen || !canRecordOutcome) return;
    Promise.all([fetchReadinessPredictionEvaluation(), fetchPendingReadinessPredictions()]).then(([evaluation, pending]) => {
      setPredictionEvaluation(evaluation);
      setPendingOutcomes(pending);
    }).catch(() => { setPredictionEvaluation(null); setPendingOutcomes([]); });
  }, [isOpen, canRecordOutcome]);

  if (!isOpen) return null;

  const handleRunDoctor = async () => {
    setLoading(true);
    setAiError('');
    try {
      const res = await fetchAiRecommendations({
        studentId: student.id,
        studentName: student.name,
        scores: {
          overall: student.placementReadinessScore,
          coding: student.metrics.coding,
          aptitude: student.metrics.aptitude,
          reasoning: student.metrics.reasoning,
          sql: student.metrics.sql,
          communication: student.metrics.communication,
        },
        weakAreas: student.weakAreas,
        targetCompanies: ['TCS', 'Infosys', 'Accenture', 'Cognizant', 'Capgemini', 'Wipro'],
      });
      setDoctorResponse(res.recommendation);
      setDoctorGeneratedByAI(res.generatedByAI);
    } catch (e) {
      console.error(e);
      setAiError(e instanceof Error ? e.message : 'Could not generate the AI recommendation.');
    } finally {
      setLoading(false);
    }
  };

  const handlePredictCompany = async () => {
    setLoading(true);
    setAiError('');
    try {
      const res = await predictCompanyReadiness({
        studentId: student.id,
        studentName: student.name,
        targetCompany: selectedCompany,
        scores: student.metrics,
      });
      setPredictionData(res);
      setOutcomeSaved('');
    } catch (e) {
      console.error(e);
      setAiError(e instanceof Error ? e.message : 'Could not generate the readiness prediction.');
    } finally {
      setLoading(false);
    }
  };

  const handleRecordOutcome = async (eventId: string, outcome: 'placed' | 'not_placed') => {
    if (!eventId) return;
    setLoading(true);
    setAiError('');
    try {
      await recordReadinessOutcome(eventId, outcome);
      setOutcomeSaved(outcome === 'placed' ? 'Placed outcome recorded for evaluation.' : 'Not placed outcome recorded for evaluation.');
      fetchReadinessPredictionEvaluation().then(setPredictionEvaluation).catch(() => setPredictionEvaluation(null));
      setPendingOutcomes((current) => current.filter((event) => event.eventId !== eventId));
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'Could not record the actual outcome.');
    } finally { setLoading(false); }
  };

  const handleGenerateTrainerNotes = async () => {
    setLoading(true);
    setAiError('');
    try {
      const res = await generateTrainerSummary({
        batchId: student.batchId || '',
        batchName: student.batch,
        studentsCount: 120,
        averageScore: 78.4,
        weakestTopics: ['Dynamic Programming Memoization', 'Probability & Combinatorics', 'SQL Complex Joins'],
      });
      setTrainerSummary(res.summary);
      setTrainerGeneratedByAI(Boolean(res.generatedByAI));
    } catch (e) {
      console.error(e);
      setAiError(e instanceof Error ? e.message : 'Could not generate trainer notes.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-2xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-scaleUp">
        {/* Modal Header */}
        <div className="p-6 bg-gradient-to-r from-indigo-900 via-indigo-800 to-purple-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-md flex items-center justify-center text-pink-300">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-lg font-bold">AI Placement Doctor & Prediction Hub</h2>
              <p className="text-xs text-indigo-200">
                AI coaching with an explainable readiness indicator • Student: {student.name}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-white/70 hover:text-white hover:bg-white/10"
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center border-b border-slate-200 dark:border-slate-800 px-6 pt-3 gap-4 bg-slate-50 dark:bg-slate-800/40">
          <button
            onClick={() => setActiveTab('doctor')}
            className={`pb-3 text-xs font-bold border-b-2 transition-all ${
              activeTab === 'doctor'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500'
            }`}
          >
            Personalized Remediation
          </button>
          <button
            onClick={() => setActiveTab('predict')}
            className={`pb-3 text-xs font-bold border-b-2 transition-all ${
              activeTab === 'predict'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500'
            }`}
          >
            Readiness indicator
          </button>
          <button
            onClick={() => setActiveTab('trainer_notes')}
            className={`pb-3 text-xs font-bold border-b-2 transition-all ${
              activeTab === 'trainer_notes'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500'
            }`}
          >
            Batch Trainer Insights
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {aiError && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{aiError}</p>}
          {canRecordOutcome && <section className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><h3 className="text-xs font-bold">Prediction monitoring</h3><p className="mt-1 text-[11px] text-slate-500">{predictionEvaluation ? `${predictionEvaluation.labeledExamples} labeled · ${predictionEvaluation.validationStatus.replaceAll('_', ' ')}` : 'Loading evaluation metrics…'}. Record actual outcomes when they are known.</p>{pendingOutcomes.length > 0 && <div className="mt-2 max-h-32 space-y-2 overflow-y-auto">{pendingOutcomes.slice(0, 10).map((event) => <div key={event.eventId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-2 text-[11px] dark:bg-slate-800"><span>{event.studentName} · readiness {event.readinessScore}% · {new Date(event.createdAt).toLocaleDateString()}</span><span className="flex gap-1"><button disabled={loading} onClick={() => void handleRecordOutcome(event.eventId, 'placed')} className="rounded bg-emerald-100 px-2 py-1 font-bold text-emerald-800 disabled:opacity-50">Placed</button><button disabled={loading} onClick={() => void handleRecordOutcome(event.eventId, 'not_placed')} className="rounded bg-slate-200 px-2 py-1 font-bold text-slate-700 disabled:opacity-50">Not placed</button></span></div>)}</div>}</section>}
          {/* Tab 1: AI Remediation Doctor */}
          {activeTab === 'doctor' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/40 text-xs text-slate-700 dark:text-slate-300">
                <p className="font-bold text-indigo-900 dark:text-indigo-200 mb-1">
                  Target Candidate Profile:
                </p>
                <p>
                  Readiness: <strong>{student.placementReadinessScore}%</strong> | Coding: <strong>{student.metrics.coding}%</strong> | Aptitude: <strong>{student.metrics.aptitude}%</strong>
                </p>
                <p className="mt-1 text-slate-500">
                  Identified Gaps: {student.weakAreas.join(', ')}
                </p>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleRunDoctor}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md cursor-pointer disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  <span>Generate Placement Action Plan</span>
                </button>
              </div>

              {doctorResponse && (
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 space-y-2 animate-fadeIn text-xs text-slate-800 dark:text-slate-200 whitespace-pre-line leading-relaxed">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{doctorGeneratedByAI ? 'AI generated · review before use' : 'Local rule-based guidance'}</p>
                  {doctorResponse}
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Company Drive Predictor */}
          {activeTab === 'predict' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Company context (does not change the indicator):
                </label>
                <select
                  value={selectedCompany}
                  onChange={(e) => setSelectedCompany(e.target.value)}
                  className="text-xs font-bold px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                >
                  <option value="TCS NQT">TCS NQT (Digital / Ninja)</option>
                  <option value="Infosys SP">Infosys (Specialist Programmer / SE)</option>
                  <option value="Accenture FSE">Accenture (Full Stack Engineer / ASE)</option>
                  <option value="Cognizant Next">Cognizant (GenC Next / Elevate)</option>
                  <option value="Capgemini">Capgemini (Senior Analyst)</option>
                  <option value="Wipro Turbo">Wipro (Elite / Turbo)</option>
                </select>

                <button
                  onClick={handlePredictCompany}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md cursor-pointer disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Target className="w-3.5 h-3.5" />}
                  <span>Run Prediction</span>
                </button>
              </div>

              {predictionData && (
                <div className="space-y-3 animate-fadeIn">
                  <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300 uppercase block">
                        Readiness indicator · heuristic
                      </span>
                      <span className="text-2xl font-black text-emerald-900 dark:text-emerald-100">
                        {predictionData.readinessIndex}%
                      </span>
                    </div>
                    <span className="text-xs font-bold px-3 py-1 rounded-full bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100">
                      {String(predictionData.readinessTier).replaceAll('_', ' ')}
                    </span>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-2 text-xs">
                    <p className="font-bold text-slate-800 dark:text-slate-200">
                      Readiness summary for {selectedCompany}:
                    </p>
                    <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                      {predictionData.advice}
                    </p>
                    <p className="text-[11px] text-amber-700 dark:text-amber-300">This indicator is not company-specific, a placement probability, or a hiring recommendation. Historical outcomes are being collected to evaluate how well the readiness threshold aligns with placement results.</p>
                    {canRecordOutcome && predictionData.eventId && <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-2 dark:border-slate-700"><span className="text-[11px] text-slate-500">Record actual result:</span><button disabled={loading} onClick={() => void handleRecordOutcome(predictionData.eventId, 'placed')} className="rounded-lg bg-emerald-100 px-3 py-1.5 text-[11px] font-bold text-emerald-800 disabled:opacity-50">Placed</button><button disabled={loading} onClick={() => void handleRecordOutcome(predictionData.eventId, 'not_placed')} className="rounded-lg bg-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-700 disabled:opacity-50">Not placed</button>{outcomeSaved && <span role="status" className="text-[11px] text-emerald-700">{outcomeSaved}</span>}</div>}
                    {canRecordOutcome && predictionEvaluation && <p className="text-[11px] text-slate-500">Evaluation sample: {predictionEvaluation.labeledExamples} labeled outcomes · precision {predictionEvaluation.precision == null ? '—' : `${Math.round(predictionEvaluation.precision * 100)}%`} · recall {predictionEvaluation.recall == null ? '—' : `${Math.round(predictionEvaluation.recall * 100)}%`} · {predictionEvaluation.validationStatus.replaceAll('_', ' ')}. These are descriptive rates, not validated probabilities.</p>}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Batch Trainer Intervention Notes */}
          {activeTab === 'trainer_notes' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                Analyze batch metrics across all 120 students to generate targeted sprint drills.
              </p>

              <div className="flex justify-end">
                <button
                  onClick={handleGenerateTrainerNotes}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md cursor-pointer disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                  <span>Generate Trainer Summary</span>
                </button>
              </div>

              {trainerSummary && (
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-2 text-xs text-slate-800 dark:text-slate-200 whitespace-pre-line leading-relaxed animate-fadeIn">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{trainerGeneratedByAI ? 'AI generated · review before use' : 'Local rule-based guidance'}</p>
                  {trainerSummary}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold hover:bg-slate-300 cursor-pointer"
          >
            Close Doctor
          </button>
        </div>
      </div>
    </div>
  );
};
