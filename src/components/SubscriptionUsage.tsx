import React, { useEffect, useState } from 'react';
import { Activity, CalendarDays, CreditCard, LoaderCircle, ShieldCheck, Users } from 'lucide-react';
import { cancelWorkspaceSubscription, confirmWorkspaceBillingCheckout, createWorkspaceBillingCheckout, getWorkspaceBillingInvoices, getWorkspaceBillingPlans, getWorkspaceSubscriptionOverview, BillingInvoiceRow, BillingPlanOption } from '../services/auth';
import { WorkspaceSubscriptionOverview } from '../types/subscriptions';

const numberFormat = new Intl.NumberFormat('en-IN');
const dateFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const showDate = (value: string | null | undefined) => value ? dateFormat.format(new Date(value)) : 'Not configured';

export const SubscriptionUsage: React.FC = () => {
  const [overview, setOverview] = useState<WorkspaceSubscriptionOverview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [billingPlans, setBillingPlans] = useState<BillingPlanOption[]>([]);
  const [invoices, setInvoices] = useState<BillingInvoiceRow[]>([]);
  const [billingError, setBillingError] = useState('');
  const [billingNotice, setBillingNotice] = useState('');
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'annual'>('monthly');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([getWorkspaceSubscriptionOverview(), getWorkspaceBillingPlans(), getWorkspaceBillingInvoices()])
      .then(([data, plans, invoiceRows]) => { if (active) { setOverview(data); setBillingPlans(plans); setInvoices(invoiceRows); } })
      .catch((loadError) => {
        if (!active) return;
        getWorkspaceSubscriptionOverview().then((data) => { if (active) setOverview(data); }).catch(() => undefined);
        setBillingError(loadError instanceof Error ? loadError.message : 'Billing self-service is unavailable. Apply the billing migration and configure Razorpay.');
      })
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

  const refreshBilling = async () => {
    const [nextOverview, nextInvoices] = await Promise.all([getWorkspaceSubscriptionOverview(), getWorkspaceBillingInvoices()]);
    setOverview(nextOverview); setInvoices(nextInvoices);
  };

  const checkout = async (plan: BillingPlanOption) => {
    setBusy(true); setBillingError(''); setBillingNotice('');
    try {
      const checkoutData = await createWorkspaceBillingCheckout(plan.id, billingInterval);
      if (!(window as any).Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script'); script.src = 'https://checkout.razorpay.com/v1/checkout.js'; script.onload = () => resolve(); script.onerror = () => reject(new Error('Could not load Razorpay Checkout.')); document.body.appendChild(script);
        });
      }
      const RazorpayCheckout = (window as any).Razorpay;
      if (!RazorpayCheckout) throw new Error('Razorpay Checkout is unavailable.');
      const instance = new RazorpayCheckout({
        key: checkoutData.keyId, subscription_id: checkoutData.subscriptionId,
        name: checkoutData.name, description: checkoutData.description,
        handler: async (response: any) => {
          try {
            const confirmation = await confirmWorkspaceBillingCheckout({ attemptId: checkoutData.attemptId, subscriptionId: response.razorpay_subscription_id, paymentId: response.razorpay_payment_id, signature: response.razorpay_signature });
            setBillingNotice(confirmation.message); await refreshBilling();
          } catch (confirmError) { setBillingError(confirmError instanceof Error ? confirmError.message : 'Could not confirm the billing authorization.'); }
        },
        modal: { ondismiss: () => setBillingNotice('Checkout was closed. Your current subscription remains unchanged.') },
        theme: { color: '#4f46e5' },
      });
      if (checkoutData.effectiveAt) setBillingNotice(`Your current plan remains in effect until ${showDate(checkoutData.effectiveAt)}. The selected plan is scheduled to start after that date.`);
      instance.open();
    } catch (checkoutError) { setBillingError(checkoutError instanceof Error ? checkoutError.message : 'Could not start checkout.'); }
    finally { setBusy(false); }
  };

  const cancelSubscription = async () => {
    if (!window.confirm('Schedule cancellation at the end of the current billing period?')) return;
    setBusy(true); setBillingError('');
    try { await cancelWorkspaceSubscription(); setBillingNotice('Cancellation is scheduled for the end of this billing period.'); await refreshBilling(); }
    catch (cancelError) { setBillingError(cancelError instanceof Error ? cancelError.message : 'Could not schedule cancellation.'); }
    finally { setBusy(false); }
  };

  return <div className="mx-auto max-w-6xl space-y-6 animate-fadeIn">
    <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-indigo-600">College workspace</p><h1 className="mt-1 text-2xl font-extrabold text-slate-900 dark:text-white">Subscription &amp; Usage</h1><p className="mt-2 text-sm text-slate-500">View your current plan and workspace capacity usage.</p></div><span className={`rounded-full px-3 py-1.5 text-xs font-bold ${subscription.status === 'active' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : subscription.status === 'past_due' || subscription.status === 'suspended' ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300' : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'}`}>{statusLabel[subscription.status] || subscription.status}</span></div>
      <div className="mt-6 grid gap-4 rounded-2xl bg-slate-50 p-5 dark:bg-slate-950 sm:grid-cols-2 lg:grid-cols-4"><div><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Current plan</p><p className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white">{plan.name}</p></div><div><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Billing interval</p><p className="mt-1 text-sm font-bold capitalize text-slate-800 dark:text-slate-200">{subscription.interval}</p></div><div><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Current period start</p><p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-200">{showDate(subscription.currentPeriodStart)}</p></div><div><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Renewal / period end</p><p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-200">{showDate(subscription.currentPeriodEnd)}</p></div></div>
      {subscription.status === 'not_configured' && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">No paid subscription or trial period is configured for this workspace. Pilot is shown as the planning default; no payment or renewal is active.</p>}
      {subscription.cancelAtPeriodEnd && <p className="mt-3 text-sm font-semibold text-amber-700 dark:text-amber-300">This subscription is set to end on {showDate(subscription.currentPeriodEnd)}.</p>}
      {billingError && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{billingError}</p>}
      {billingNotice && <p role="status" className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{billingNotice}</p>}
    </header>

    <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-bold text-slate-900 dark:text-white">Plans &amp; billing</h2><p className="mt-1 text-xs text-slate-500">Payments and recurring renewals are handled by Razorpay. Plan changes are scheduled for the current term end when supported.</p></div><label className="text-xs font-semibold text-slate-600">Billing interval<select value={billingInterval} onChange={(event) => setBillingInterval(event.target.value as 'monthly' | 'annual')} className="ml-2 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs dark:bg-slate-950"><option value="monthly">Monthly</option><option value="annual">Annual</option></select></label></div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">{billingPlans.map((option) => { const amount = billingInterval === 'monthly' ? option.monthlyPricePaise : option.annualPricePaise; return <article key={option.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><h3 className="font-bold text-slate-900 dark:text-white">{option.name}</h3><p className="mt-1 min-h-8 text-xs text-slate-500">{option.description}</p><p className="mt-3 text-xl font-extrabold text-slate-900 dark:text-white">{amount === null ? 'Price not set' : `₹${numberFormat.format(amount / 100)}`}<span className="ml-1 text-xs font-semibold text-slate-400">{amount === null ? '' : `/${billingInterval === 'monthly' ? 'month' : 'year'}`}</span></p><button disabled={busy || amount === null} onClick={() => void checkout(option)} className="mt-4 w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Please wait…' : option.id === plan.id && subscription.status === 'active' ? 'Renew / change billing' : 'Choose plan'}</button></article>; })}</div>
      {subscription.status === 'active' && !subscription.cancelAtPeriodEnd && <button disabled={busy} onClick={() => void cancelSubscription()} className="mt-4 rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-50">Cancel at period end</button>}
      <p className="mt-3 text-[11px] text-slate-500">Razorpay credentials and prices must be configured before checkout is available. Hosted invoices are provided by Razorpay when available; this screen does not calculate GST.</p>
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between gap-3"><h2 className="font-bold text-slate-900 dark:text-white">Billing history &amp; invoices</h2><button disabled={busy} onClick={() => void refreshBilling().catch((refreshError) => setBillingError(refreshError.message))} className="text-xs font-bold text-indigo-600 hover:underline">Refresh</button></div>{invoices.length ? <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">{invoices.map((invoice) => <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="text-sm font-bold text-slate-900 dark:text-white">{invoice.invoiceNumber} · {invoice.planName}</p><p className="mt-1 text-xs text-slate-500">{showDate(invoice.issuedAt)} · {invoice.status}{invoice.paymentMethod ? ` · ${invoice.paymentMethod}` : ''}</p></div><div className="flex items-center gap-3"><span className="text-sm font-extrabold">₹{numberFormat.format(invoice.amountPaise / 100)}</span>{invoice.providerInvoiceId && <a href={`/api/workspace/billing/invoices/${encodeURIComponent(invoice.id)}/view`} target="_blank" rel="noreferrer" className="text-xs font-bold text-indigo-600 hover:underline">View invoice</a>}</div></div>)}</div> : <p className="mt-2 text-sm text-slate-500">No billing records yet.</p>}</section>

    <section><div className="mb-3"><h2 className="font-bold text-slate-900 dark:text-white">Workspace usage</h2><p className="mt-1 text-xs text-slate-500">Student and trainer quotas count active memberships; pending invitations are checked when accepted. Archived batches do not count. AI usage is counted per successful provider-generated request.</p></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{limits.map((item) => { const percent = item.max && item.max > 0 ? Math.min(100, Math.round((item.current / item.max) * 100)) : 0; const isAiUntracked = item.label.startsWith('AI') && !usage.aiCreditsTracked; return <article key={item.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-500">{item.label}</span><span className="text-indigo-600">{item.icon}</span></div><p className="mt-3 text-2xl font-extrabold text-slate-900 dark:text-white">{isAiUntracked ? '—' : numberFormat.format(item.current)}<span className="ml-1 text-sm font-semibold text-slate-400">/ {item.max === null ? 'No limit set' : numberFormat.format(item.max)}</span></p>{!isAiUntracked && item.max !== null && <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={`h-full rounded-full ${percent >= 90 ? 'bg-amber-500' : 'bg-indigo-600'}`} style={{ width: `${percent}%` }}/></div>}<p className="mt-2 text-[11px] text-slate-500">{isAiUntracked ? 'External AI processing is disabled or the provider is not configured; usage tracking is inactive.' : item.detail}</p></article>; })}</div></section>

    <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-indigo-600"/><h2 className="font-bold text-slate-900 dark:text-white">Included features</h2></div><div className="mt-4 flex flex-wrap gap-2">{plan.features.map((feature) => <span key={feature} className="rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">{feature.replaceAll('_', ' ')}</span>)}</div><p className="mt-4 text-xs text-slate-500">Features and workspace capacity are enforced by the server. Past due subscriptions remain read only; canceled, suspended, and expired subscriptions cannot use workspace features.</p></section>
  </div>;
};
