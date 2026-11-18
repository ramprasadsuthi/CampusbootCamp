/**
 * Product and billing contracts for the college-first subscription model.
 * These types describe Stage 1 scope; they do not enforce access or quotas.
 */

export type SubscriptionPlanId = 'pilot' | 'campus' | 'campus_plus';
export type SubscriptionInterval = 'monthly' | 'annual';
export type SubscriptionStatus =
  | 'not_configured'
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

/**
 * Workspace roles authorize actions; subscription features and limits authorize
 * what the college has purchased. Keep this list separate from plan features.
 */
export type WorkspacePermission =
  | 'profile.read_own' | 'profile.update_own'
  | 'curriculum.read_assigned' | 'curriculum.progress.update_own'
  | 'assessment.read_assigned' | 'assessment.submit_own'
  | 'interview.read_own' | 'report.read_own' | 'certificate.read_own'
  | 'batches.read_assigned' | 'students.read_assigned'
  | 'curriculum.manage_assigned' | 'assessment.manage_assigned'
  | 'interview.evaluate_assigned' | 'analytics.read_assigned' | 'report.export_assigned'
  | 'workspace.configure' | 'members.invite' | 'members.change_role' | 'members.change_status'
  | 'batches.manage' | 'students.enroll' | 'curriculum.manage_workspace'
  | 'assessment.manage_workspace' | 'interview.schedule_workspace'
  | 'analytics.read_workspace' | 'report.export_workspace'
  | 'subscription.read' | 'subscription.manage' | 'billing.manage' | 'audit.read'
  | 'platform.workspaces.manage' | 'platform.plans.manage' | 'platform.subscriptions.manage'
  | 'platform.shared_content.manage' | 'platform.settings.manage' | 'platform.operations.read'
  | 'platform.billing.read' | 'platform.support_data.access';

export type WorkspaceRoleId = 'student' | 'trainer' | 'college_admin';
export type PlatformRoleId = 'platform_admin';

/** Explicit permissions for college roles. Platform operations are intentionally separate. */
export const WORKSPACE_ROLE_PERMISSIONS: Readonly<Record<WorkspaceRoleId, readonly WorkspacePermission[]>> = {
  student: [
    'profile.read_own', 'profile.update_own', 'curriculum.read_assigned', 'curriculum.progress.update_own',
    'assessment.read_assigned', 'assessment.submit_own', 'interview.read_own', 'report.read_own', 'certificate.read_own',
  ],
  trainer: [
    'batches.read_assigned', 'students.read_assigned', 'curriculum.read_assigned', 'curriculum.manage_assigned',
    'assessment.read_assigned', 'assessment.manage_assigned', 'interview.evaluate_assigned',
    'analytics.read_assigned', 'report.export_assigned',
  ],
  college_admin: [
    'profile.read_own', 'profile.update_own', 'workspace.configure', 'members.invite', 'members.change_role', 'members.change_status',
    'batches.manage', 'students.enroll', 'curriculum.manage_workspace', 'assessment.manage_workspace',
    'interview.schedule_workspace', 'analytics.read_workspace', 'report.export_workspace',
    'subscription.read', 'subscription.manage', 'billing.manage', 'audit.read',
  ],
};

/** Platform roles never inherit a college workspace role implicitly. */
export const PLATFORM_ROLE_PERMISSIONS: Readonly<Record<PlatformRoleId, readonly WorkspacePermission[]>> = {
  platform_admin: [
    'platform.workspaces.manage', 'platform.plans.manage', 'platform.subscriptions.manage',
    'platform.shared_content.manage', 'platform.settings.manage', 'platform.operations.read',
    'platform.billing.read', 'platform.support_data.access',
  ],
};

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

const limits = (activeStudents: number, trainerSeats: number, activeBatches: number, aiCredits: number): readonly PlanLimit[] => [
  { key: 'active_students', value: activeStudents, unit: 'students' },
  { key: 'trainer_seats', value: trainerSeats, unit: 'seats' },
  { key: 'active_batches', value: activeBatches, unit: 'batches' },
  { key: 'ai_credits_per_period', value: aiCredits, unit: 'credits' },
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
    limits: limits(100, 5, 3, 500),
  },
  {
    id: 'campus',
    name: 'Campus',
    description: 'Core placement-readiness operations for a college program.',
    currency: 'INR',
    monthlyPricePaise: null,
    annualPricePaise: null,
    features: [...sharedCoreFeatures, 'ai_insights', 'college_analytics'],
    limits: limits(500, 25, 20, 5000),
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
    limits: limits(2000, 100, 100, 25000),
  },
];

export interface CollegeSubscription {
  id: string;
  tenantId: string;
  planId: SubscriptionPlanId;
  status: SubscriptionStatus;
  interval: SubscriptionInterval;
  currency: 'INR';
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt?: string;
  cancelAtPeriodEnd: boolean;
}

export interface WorkspaceSubscriptionOverview {
  subscription: CollegeSubscription;
  plan: SubscriptionPlanDefinition;
  usage: {
    activeStudents: number;
    pendingStudentInvitations: number;
    trainerSeats: number;
    pendingTrainerInvitations: number;
    activeBatches: number;
    aiCreditsUsed: number;
    aiCreditsTracked: boolean;
    aiUsagePeriodStart: string;
  };
}

