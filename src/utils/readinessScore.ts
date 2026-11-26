export const READINESS_MODEL_VERSION = 'readiness-weighted-v1';

export const READINESS_FACTORS = [
  { key: 'coding', label: 'Coding & DSA', weight: 25 },
  { key: 'aptitude', label: 'Aptitude', weight: 15 },
  { key: 'reasoning', label: 'Reasoning', weight: 10 },
  { key: 'sql', label: 'SQL & database', weight: 10 },
  { key: 'csFundamentals', label: 'CS fundamentals', weight: 10 },
  { key: 'communication', label: 'Communication', weight: 10 },
  { key: 'techInterview', label: 'Technical interview', weight: 10 },
  { key: 'hrInterview', label: 'HR interview', weight: 10 },
] as const;

export type ReadinessInput = Partial<Record<typeof READINESS_FACTORS[number]['key'], number | string | null | undefined>>;

export interface ReadinessExplanation {
  modelVersion: string;
  score: number;
  factors: Array<{ key: string; label: string; weight: number; score: number | null; contribution: number }>;
  availableWeight: number;
  missingFactors: string[];
  interpretation: string;
}

export function explainReadiness(input: ReadinessInput): ReadinessExplanation {
  const factors = READINESS_FACTORS.map((factor) => {
    const raw = input[factor.key];
    const parsed = raw === null || raw === undefined || raw === '' ? null : Number(raw);
    const score = parsed !== null && Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : null;
    return { ...factor, score, contribution: score === null ? 0 : score * factor.weight / 100 };
  });
  const availableWeight = factors.filter((factor) => factor.score !== null).reduce((total, factor) => total + factor.weight, 0);
  const weightedScore = availableWeight
    ? Math.round(factors.reduce((total, factor) => total + factor.contribution, 0) * 100 / availableWeight)
    : 0;
  return {
    modelVersion: READINESS_MODEL_VERSION,
    score: weightedScore,
    factors,
    availableWeight,
    missingFactors: factors.filter((factor) => factor.score === null).map((factor) => factor.label),
    interpretation: 'A weighted summary of current bootcamp skill indicators. It is not a hiring or placement probability.',
  };
}
