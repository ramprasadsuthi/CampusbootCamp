/**
 * Product and billing contracts for the college-first subscription model.
 * These types describe Stage 1 scope; they do not enforce access or quotas.
 */

export type SubscriptionPlanId = 'pilot' | 'campus' | 'campus_plus';
export type SubscriptionInterval = 'monthly' | 'annual';
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'suspended';

export type PlanFeature =
  | 'college_workspace'
  | 'student_and_trainer_access'
  | 'batches'
  | 'curriculum'
  | 'assessments'
  | 'interview_feedback'
  | 'basic_analytics'
  | 'standard_exports'
  | 'ai_insights'
  | 'college_analytics'
  | 'advanced_analytics'
  | 'custom_branding'
  | 'priority_support';

export type PlanLimitKey =
  | 'active_students'
  | 'trainer_seats'
  | 'active_batches'
  | 'ai_credits_per_period';

export interface PlanLimit {
  key: PlanLimitKey;
  /** Null means the commercial limit has not yet been approved/configured. */
  value: number | null;
  unit: 'students' | 'seats' | 'batches' | 'credits';
}

export interface SubscriptionPlanDefinition {
  id: SubscriptionPlanId;
  name: string;
  description: string;
  currency: 'INR';
  /** Pricing is deliberately unset until validated with pilot colleges. */
  monthlyPricePaise: number | null;
  annualPricePaise: number | null;
  features: readonly PlanFeature[];
  limits: readonly PlanLimit[];
}

const sharedCoreFeatures: readonly PlanFeature[] = [
  'college_workspace',
  'student_and_trainer_access',
  'batches',
  'curriculum',
  'assessments',
  'interview_feedback',
  'basic_analytics',
  'standard_exports',
];

const configurableLimits: readonly PlanLimit[] = [
  { key: 'active_students', value: null, unit: 'students' },
  { key: 'trainer_seats', value: null, unit: 'seats' },
  { key: 'active_batches', value: null, unit: 'batches' },
  { key: 'ai_credits_per_period', value: null, unit: 'credits' },
];

/** Initial plan catalog. Limits and pricing require product approval. */
export const SUBSCRIPTION_PLANS: readonly SubscriptionPlanDefinition[] = [
  {
    id: 'pilot',
    name: 'Pilot',
    description: 'A bounded evaluation of TalentEdge with a college cohort.',
    currency: 'INR',
    monthlyPricePaise: null,
    annualPricePaise: null,
    features: [...sharedCoreFeatures, 'ai_insights'],
    limits: configurableLimits,
  },
  {
    id: 'campus',
    name: 'Campus',
    description: 'Core placement-readiness operations for a college program.',
    currency: 'INR',
    monthlyPricePaise: null,
    annualPricePaise: null,
    features: [...sharedCoreFeatures, 'ai_insights', 'college_analytics'],
    limits: configurableLimits,
  },
  {
    id: 'campus_plus',
    name: 'Campus Plus',
    description: 'Expanded capacity and premium analytics and support.',
    currency: 'INR',
    monthlyPricePaise: null,
    annualPricePaise: null,
    features: [
      ...sharedCoreFeatures,
      'ai_insights',
      'college_analytics',
      'advanced_analytics',
      'custom_branding',
      'priority_support',
    ],
    limits: configurableLimits,
  },
];

export interface CollegeSubscription {
  id: string;
  tenantId: string;
  planId: SubscriptionPlanId;
  status: SubscriptionStatus;
  interval: SubscriptionInterval;
  currency: 'INR';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndsAt?: string;
  cancelAtPeriodEnd: boolean;
}

