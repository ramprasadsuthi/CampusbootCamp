import React, { useEffect, useState } from 'react';
import { Activity, CalendarDays, CreditCard, LoaderCircle, ShieldCheck, Users } from 'lucide-react';
import { getWorkspaceSubscriptionOverview } from '../services/auth';
import { WorkspaceSubscriptionOverview } from '../types/subscriptions';

const numberFormat = new Intl.NumberFormat('en-IN');
const dateFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const showDate = (value: string | null | undefined) => value ? dateFormat.format(new Date(value)) : 'Not configured';

export const SubscriptionUsage: React.FC = () => {
  const [overview, setOverview] = useState<WorkspaceSubscriptionOverview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getWorkspaceSubscriptionOverview()
      .then((data) => { if (active) setOverview(data); })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load subscription details.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  if (loading) return <div role="status" className="flex items-center justify-center gap-2 p-16 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin"/>Loading subscription and usage…</div>;
  if (error || !overview) return <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{error || 'Subscription details are unavailable.'}</div>;

  const { subscription, plan, usage } = overview;
  const statusLabel: Record<string, string> = {
    not_configured: 'Setup required', trialing: 'Trial', active: 'Active', past_due: 'Past due', canceled: 'Canceled', suspended: 'Suspended',
  };
  const getLimit = (key: string) => plan.limits.find((limit) => limit.key === key)?.value ?? null;
  const limits = [
    { label: 'Active students', current: usage.activeStudents, detail: `${usage.pendingStudentInvitations} pending invitations (capacity checked on acceptance)`, max: getLimit('active_students'), icon: <Users className="h-5 w-5"/> },
    { label: 'Trainer seats', current: usage.trainerSeats, detail: `${usage.pendingTrainerInvitations} pending invitations (capacity checked on acceptance)`, max: getLimit('trainer_seats'), icon: <ShieldCheck className="h-5 w-5"/> },
    { label: 'Active batches', current: usage.activeBatches, detail: `${usage.activeBatches} non-archived batches`, max: getLimit('active_batches'), icon: <Activity className="h-5 w-5"/> },
    { label: 'AI credits this billing period', current: usage.aiCreditsUsed, detail: `Usage period starts ${showDate(usage.aiUsagePeriodStart)}`, max: getLimit('ai_credits_per_period'), icon: <CreditCard className="h-5 w-5"/> },
  ];

  return <div className="mx-auto max-w-6xl space-y-6 animate-fadeIn">
    <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-indigo-600">College workspace</p><h1 className="mt-1 text-2xl font-extrabold text-slate-900 dark:text-white">Subscription &amp; Usage</h1><p className="mt-2 text-sm text-slate-500">View your current plan and workspace capacity usage.</p></div><span className={`rounded-full px-3 py-1.5 text-xs font-bold ${subscription.status === 'active' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : subscription.status === 'past_due' || subscription.status === 'suspended' ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300' : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'}`}>{statusLabel[subscription.status] || subscription.status}</span></div>
      <div className="mt-6 grid gap-4 rounded-2xl bg-slate-50 p-5 dark:bg-slate-950 sm:grid-cols-2 lg:grid-cols-4"><div><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Current plan</p><p className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white">{plan.name}</p></div><div><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Billing interval</p><p className="mt-1 text-sm font-bold capitalize text-slate-800 dark:text-slate-200">{subscription.interval}</p></div><div><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Current period start</p><p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-200">{showDate(subscription.currentPeriodStart)}</p></div><div><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Renewal / period end</p><p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-200">{showDate(subscription.currentPeriodEnd)}</p></div></div>
      {subscription.status === 'not_configured' && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">No paid subscription or trial period is configured for this workspace. Pilot is shown as the planning default; no payment or renewal is active.</p>}
      {subscription.cancelAtPeriodEnd && <p className="mt-3 text-sm font-semibold text-amber-700 dark:text-amber-300">This subscription is set to end on {showDate(subscription.currentPeriodEnd)}.</p>}
    </header>

    <section><div className="mb-3"><h2 className="font-bold text-slate-900 dark:text-white">Workspace usage</h2><p className="mt-1 text-xs text-slate-500">Student and trainer quotas count active memberships; pending invitations are checked when accepted. Archived batches do not count. AI usage is counted per successful provider-generated request.</p></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{limits.map((item) => { const percent = item.max && item.max > 0 ? Math.min(100, Math.round((item.current / item.max) * 100)) : 0; const isAiUntracked = item.label.startsWith('AI') && !usage.aiCreditsTracked; return <article key={item.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-500">{item.label}</span><span className="text-indigo-600">{item.icon}</span></div><p className="mt-3 text-2xl font-extrabold text-slate-900 dark:text-white">{isAiUntracked ? '—' : numberFormat.format(item.current)}<span className="ml-1 text-sm font-semibold text-slate-400">/ {item.max === null ? 'No limit set' : numberFormat.format(item.max)}</span></p>{!isAiUntracked && item.max !== null && <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={`h-full rounded-full ${percent >= 90 ? 'bg-amber-500' : 'bg-indigo-600'}`} style={{ width: `${percent}%` }}/></div>}<p className="mt-2 text-[11px] text-slate-500">{isAiUntracked ? 'AI provider is not configured; usage tracking is inactive.' : item.detail}</p></article>; })}</div></section>

    <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-indigo-600"/><h2 className="font-bold text-slate-900 dark:text-white">Included features</h2></div><div className="mt-4 flex flex-wrap gap-2">{plan.features.map((feature) => <span key={feature} className="rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">{feature.replaceAll('_', ' ')}</span>)}</div><p className="mt-4 text-xs text-slate-500">Plan limits are currently displayed for reference. Quota enforcement and billing actions are not enabled yet.</p></section>
  </div>;
};
