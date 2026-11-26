import React, { FormEvent, useEffect, useState } from 'react';
import { Activity, AlertTriangle, ArrowLeft, ArrowUpRight, Building2, CheckCircle2, Copy, CreditCard, LoaderCircle, LogOut, Plus, Search, Shield, ShieldCheck, Users } from 'lucide-react';
import { acceptCollegeAdminInvite, acceptPlatformAdminInvite, applySharedContent, completePlatformMfaReset, createPlatformAdminInvitation, createPlatformWorkspace, createSharedContentDraft, getCollegeAdminInvite, getPlatformAdminInvite, getPlatformAdmins, getPlatformAuditEvents, getPlatformMfaReset, getPlatformOverview, getPlatformPlans, getPlatformSession, getPlatformSubscriptionHistory, getPlatformWorkspace, getPlatformWorkspaces, getSharedContentApplications, getSharedContentRollout, getSharedContentVersion, getSharedContentVersions, inviteWorkspaceAdmin, platformLogin, platformLogout, publishSharedContent, requestPlatformMfaReset, resendWorkspaceAdminInvitation, revokeWorkspaceAdminInvitation, rollbackSharedContent, savePlatformPlan, saveSharedContentDraft, setPlatformAdminStatus, setPlatformWorkspaceStatus, updatePlatformWorkspaceSubscription, SharedContentApplication, SharedContentRollout, SharedMaterialDraft, SharedContentVersion, PlatformPlan, PlatformSubscriptionChange } from '../services/platformAdmin';
import { PlatformWorkspace } from '../services/platformAdmin';

type PlatformUser = { id: string; name: string; email: string };
const statusLabels: Record<string, string> = { onboarding: 'Onboarding', active: 'Active', suspended: 'Suspended', archived: 'Archived' };
const statusStyles: Record<string, string> = { onboarding: 'bg-amber-100 text-amber-800', active: 'bg-emerald-100 text-emerald-800', suspended: 'bg-rose-100 text-rose-800', archived: 'bg-slate-200 text-slate-700' };
const planLabels: Record<string, string> = { pilot: 'Pilot', campus: 'Campus', campus_plus: 'Campus Plus' };
const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10';

export const PlatformAdminApp: React.FC = () => {
  const query = new URLSearchParams(window.location.search);
  const inviteToken = query.get('invite') || '';
  const collegeInviteToken = query.get('collegeInvite') || '';
  const mfaResetToken = query.get('mfaReset') || '';
  const [user, setUser] = useState<PlatformUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activePage, setActivePage] = useState<'overview' | 'workspaces' | 'plans' | 'subscriptions' | 'admins' | 'audit' | 'content'>('overview');
  const [overview, setOverview] = useState<any>(null);
  const [workspaces, setWorkspaces] = useState<PlatformWorkspace[]>([]);
  const [admins, setAdmins] = useState<Array<{ id: string; name: string; email: string; isActive: boolean; lastLoginAt: string | null; createdAt: string }>>([]);
  const [workspaceDetail, setWorkspaceDetail] = useState<any>(null);
  const [workspaceQuery, setWorkspaceQuery] = useState('');
  const [workspaceStatus, setWorkspaceStatus] = useState('all');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const [collegeWorkspaceName, setCollegeWorkspaceName] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [platformAdminEmail, setPlatformAdminEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (collegeInviteToken) {
      getCollegeAdminInvite(collegeInviteToken).then((data) => { setEmail(data.email); setCollegeWorkspaceName(data.workspaceName); }).catch((err) => setError(err.message)).finally(() => setAuthLoading(false));
      return;
    }
    if (mfaResetToken) {
      getPlatformMfaReset(mfaResetToken).then((data) => { setEmail(data.email); setTotpSecret(data.totpSecret); }).catch((err) => setError(err.message)).finally(() => setAuthLoading(false));
      return;
    }
    if (inviteToken) {
      getPlatformAdminInvite(inviteToken).then((data) => { setEmail(data.email); setTotpSecret(data.totpSecret); }).catch((err) => setError(err.message)).finally(() => setAuthLoading(false));
      return;
    }
    getPlatformSession().then((session) => setUser(session.user)).catch(() => setUser(null)).finally(() => setAuthLoading(false));
  }, []);

  const loadConsole = async () => {
    const [summary, workspaceRows, adminRows] = await Promise.all([getPlatformOverview(), getPlatformWorkspaces({ q: workspaceQuery, status: workspaceStatus }), getPlatformAdmins()]);
    setOverview(summary); setWorkspaces(workspaceRows); setAdmins(adminRows);
  };
  useEffect(() => { if (user && !workspaceDetail) loadConsole().catch((err) => setError(err.message)); }, [user, workspaceQuery, workspaceStatus]);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setNotice(''); setBusy(true);
    try {
      if (mfaResetToken) {
        await completePlatformMfaReset({ token: mfaResetToken, totpSecret, code });
        window.history.replaceState({}, '', '/platform-admin');
        setPassword(''); setCode(''); setTotpSecret('');
        setNotice('Authenticator reset completed. Sign in again with your password and newly enrolled authenticator.');
        return;
      }
      if (collegeInviteToken) {
        await acceptCollegeAdminInvite({ token: collegeInviteToken, name, password });
        window.location.assign('/');
        return;
      }
      if (inviteToken) {
        await acceptPlatformAdminInvite({ token: inviteToken, name, password, totpSecret, code });
        const session = await getPlatformSession(); setUser(session.user); window.history.replaceState({}, '', '/platform-admin');
        return;
      }
      await platformLogin(email, password, code);
      const session = await getPlatformSession(); setUser(session.user);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not complete this request.'); }
    finally { setBusy(false); }
  };

  const signOut = async () => { await platformLogout().catch(() => undefined); setUser(null); setWorkspaceDetail(null); };
  const openWorkspace = async (id: string) => { setError(''); try { setWorkspaceDetail(await getPlatformWorkspace(id)); } catch (err) { setError(err instanceof Error ? err.message : 'Could not open workspace.'); } };
  const changeWorkspaceStatus = async (status: string) => {
    if (!workspaceDetail) return;
    const reason = window.prompt(`Reason for setting ${workspaceDetail.name} to ${statusLabels[status]} (required):`) || '';
    if (reason.trim().length < 5) { setError('Enter a reason of at least five characters.'); return; }
    setError(''); setNotice('');
    try { await setPlatformWorkspaceStatus(workspaceDetail.id, status, reason); setWorkspaceDetail(await getPlatformWorkspace(workspaceDetail.id)); await loadConsole(); setNotice(`${workspaceDetail.name} is now ${statusLabels[status].toLowerCase()}.`); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not update the workspace.'); }
  };

  const changeWorkspaceSubscription = async (payload: { planId: PlatformPlan['id']; status: string; currentPeriodStart: string | null; currentPeriodEnd: string | null; internalNote: string; reason: string }) => {
    if (!workspaceDetail) return;
    await updatePlatformWorkspaceSubscription(workspaceDetail.id, payload);
    setWorkspaceDetail(await getPlatformWorkspace(workspaceDetail.id));
    await loadConsole();
    setNotice(`Manual subscription updated for ${workspaceDetail.name}.`);
  };

  const createWorkspace = async (data: { name: string; adminName: string; adminEmail: string }) => {
    setBusy(true); setError(''); setNotice(''); setInviteLink('');
    try { const created = await createPlatformWorkspace(data); setInviteLink(created.inviteUrl); setNotice('Workspace created in onboarding. Copy the first administrator invitation link and send it through your approved channel.'); await loadConsole(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not create workspace.'); }
    finally { setBusy(false); }
  };

  const inviteAdmin = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setInviteLink('');
    try { const result = await createPlatformAdminInvitation(platformAdminEmail); setInviteLink(result.inviteUrl); setNotice(`Invitation created. Email delivery status: ${result.delivery?.status || 'not configured'}.`); setPlatformAdminEmail(''); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not create invitation.'); }
    finally { setBusy(false); }
  };

  const toggleAdmin = async (admin: { id: string; isActive: boolean }) => {
    const reason = window.prompt(`Reason for ${admin.isActive ? 'deactivating' : 'activating'} this platform admin (required):`) || '';
    if (reason.trim().length < 5) { setError('Enter a reason of at least five characters.'); return; }
    try { await setPlatformAdminStatus(admin.id, !admin.isActive, reason); await loadConsole(); setNotice('Platform administrator access updated.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not update platform administrator.'); }
  };
  const resetAdminMfa = async (admin: { id: string; email: string }) => {
    const reason = window.prompt(`Reason for resetting MFA for ${admin.email} (required):`) || '';
    if (reason.trim().length < 5) { setError('Enter a reason of at least five characters.'); return; }
    try { const result = await requestPlatformMfaReset(admin.id, reason); setInviteLink(result.inviteUrl); setNotice(`One-hour authenticator reset link created for ${result.email}. Deliver it through your approved channel.`); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not reset this authenticator.'); }
  };
  const inviteWorkspaceAdminLink = async (id: string, address: string) => {
    setError(''); setNotice(''); setInviteLink('');
    try { const result = await inviteWorkspaceAdmin(id, address); setInviteLink(result.inviteUrl); setWorkspaceDetail(await getPlatformWorkspace(id)); await loadConsole(); setNotice(`College administrator invitation created for ${address}. Deliver it out of band.`); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not create college administrator invitation.'); }
  };
  const resendWorkspaceInvite = async (workspaceId: string, invitationId: string, address: string) => {
    const reason = window.prompt(`Reason for resending the invitation to ${address} (required):`) || '';
    if (reason.trim().length < 5) { setError('Enter a reason of at least five characters.'); return; }
    setError(''); setNotice(''); setInviteLink('');
    try { const result = await resendWorkspaceAdminInvitation(workspaceId, invitationId, reason); setInviteLink(result.inviteUrl); setWorkspaceDetail(await getPlatformWorkspace(workspaceId)); await loadConsole(); setNotice(`A fresh invitation link was generated for ${address}. The prior pending link is invalidated; deliver the new link out of band.`); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not resend this invitation.'); }
  };
  const revokeWorkspaceInvite = async (workspaceId: string, invitationId: string, address: string) => {
    const reason = window.prompt(`Reason for revoking the invitation to ${address} (required):`) || '';
    if (reason.trim().length < 5) { setError('Enter a reason of at least five characters.'); return; }
    setError(''); setNotice('');
    try { await revokeWorkspaceAdminInvitation(workspaceId, invitationId, reason); setWorkspaceDetail(await getPlatformWorkspace(workspaceId)); await loadConsole(); setNotice(`The pending invitation to ${address} was revoked.`); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not revoke this invitation.'); }
  };

  if (authLoading) return <FullScreenMessage>Loading platform administration…</FullScreenMessage>;

  if (!user) return <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-900"><section className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl"><div className="bg-indigo-700 p-7 text-white"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-indigo-100"><ShieldCheck size={17}/>TalentEdge · Platform</div><h1 className="mt-3 text-2xl font-extrabold">{collegeInviteToken ? 'Join your college workspace' : inviteToken ? 'Accept platform invitation' : mfaResetToken ? 'Reset authenticator' : 'Platform administration'}</h1><p className="mt-2 text-sm text-indigo-100">{collegeInviteToken ? `Set up the first administrator account for ${collegeWorkspaceName || 'your college'}.` : inviteToken ? 'Set up your account and enroll an authenticator before signing in.' : mfaResetToken ? 'An active Platform Admin authorized this one-time authenticator reset.' : 'Sign in with your separate platform account and authenticator code.'}</p></div><form onSubmit={(event) => void submit(event)} className="space-y-4 p-7">
    {collegeInviteToken && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">Workspace: <strong>{collegeWorkspaceName || 'Loading…'}</strong><br/>Email: <strong>{email || 'Loading…'}</strong></p>}
    {(inviteToken || mfaResetToken) && <><p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{inviteToken ? 'Invited email:' : 'Account:'} <strong>{email || 'Loading…'}</strong></p><div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Add this secret to an authenticator app before entering the current six-digit code: <code className="mt-2 block select-all break-all font-bold">{totpSecret || 'Loading…'}</code><p className="mt-2">Use a time-based one-time password (TOTP) with 30-second codes.</p></div></>}
    {!collegeInviteToken && !inviteToken && <label className="block text-xs font-semibold text-slate-600">Email<input required type="email" autoComplete="username" className={`${inputClass} mt-1`} value={email} onChange={(event) => setEmail(event.target.value)}/></label>}
    {(collegeInviteToken || inviteToken) && <label className="block text-xs font-semibold text-slate-600">Full name<input required minLength={2} autoComplete="name" className={`${inputClass} mt-1`} value={name} onChange={(event) => setName(event.target.value)}/></label>}
    {!mfaResetToken && <label className="block text-xs font-semibold text-slate-600">Password<input required minLength={12} type="password" autoComplete="current-password" className={`${inputClass} mt-1`} value={password} onChange={(event) => setPassword(event.target.value)}/><span className="mt-1 block text-[11px] text-slate-400">At least 12 characters.</span></label>}
    {!collegeInviteToken && <label className="block text-xs font-semibold text-slate-600">Authenticator code<input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" className={`${inputClass} mt-1 tracking-[0.3em]`} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}/></label>}
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <button disabled={busy || ((inviteToken || mfaResetToken) && !totpSecret)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{busy && <LoaderCircle size={16} className="animate-spin"/>}{collegeInviteToken ? 'Create college administrator account' : inviteToken ? 'Set up platform account' : mfaResetToken ? 'Update authenticator' : 'Sign in securely'}</button>
    <a href="/" className="block text-center text-xs font-semibold text-slate-500 hover:text-indigo-600">Return to college sign-in</a>
  </form></section></main>;

  return <div className="min-h-screen bg-slate-100 text-slate-900">
    <header className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-5 py-3 text-white"><div className="flex items-center gap-3"><div className="rounded-xl bg-indigo-600 p-2"><Shield size={19}/></div><div><p className="text-sm font-extrabold">TalentEdge Platform</p><p className="text-[10px] text-slate-400">Cross-college operations · all actions audited</p></div></div><div className="flex items-center gap-3"><span className="hidden text-right sm:block"><span className="block text-xs font-bold">{user.name}</span><span className="block text-[10px] text-slate-400">{user.email}</span></span><button onClick={() => void signOut()} className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold hover:bg-slate-800"><LogOut size={14}/>Sign out</button></div></header>
    <div className="mx-auto grid max-w-7xl gap-6 p-4 sm:p-7 lg:grid-cols-[210px_1fr]">
      <aside className="flex gap-2 overflow-x-auto lg:block lg:space-y-1">{([['overview','Overview'],['workspaces','Colleges'],['plans','Plans'],['subscriptions','Subscription history'],['content','Shared content'],['admins','Platform admins'],['audit','Audit log']] as const).map(([key,label]) => <button key={key} onClick={() => { setActivePage(key); setWorkspaceDetail(null); setNotice(''); }} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-left text-sm font-semibold lg:w-full ${activePage === key ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-indigo-50'}`}>{label}</button>)}</aside>
      <main className="min-w-0 space-y-5">
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}<button className="ml-3 font-bold" onClick={() => setError('')}>Dismiss</button></p>}
        {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}
        {inviteLink && <div className="flex flex-col gap-2 rounded-xl border border-indigo-200 bg-white p-4 sm:flex-row sm:items-center"><input readOnly value={inviteLink} className={`${inputClass} min-w-0 flex-1 text-xs`}/><button onClick={() => navigator.clipboard.writeText(inviteLink).then(() => setNotice('Invitation link copied.'))} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white"><Copy size={14}/>Copy invite link</button></div>}
        {workspaceDetail ? <WorkspaceDetail detail={workspaceDetail} onBack={() => setWorkspaceDetail(null)} onStatus={changeWorkspaceStatus} onInviteAdmin={inviteWorkspaceAdminLink} onResendInvite={resendWorkspaceInvite} onRevokeInvite={revokeWorkspaceInvite} onSubscriptionSave={changeWorkspaceSubscription}/> : activePage === 'plans' ? <PlanCatalogPage/> : activePage === 'subscriptions' ? <SubscriptionHistoryPage/> : activePage === 'overview' ? <>
          <div><p className="text-xs font-bold uppercase tracking-widest text-indigo-600">Platform overview</p><h1 className="mt-1 text-2xl font-extrabold">College workspaces</h1><p className="mt-1 text-sm text-slate-500">Operational overview across all colleges. Student-level records are not exposed here.</p></div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[['Total colleges',overview?.totalWorkspaces],['Active',overview?.activeWorkspaces],['Onboarding',overview?.onboardingWorkspaces],['Suspended',overview?.suspendedWorkspaces]].map(([label,value]) => <Metric key={String(label)} label={String(label)} value={value ?? '…'} icon={<Building2 size={18}/>}/>)}<Metric label="Archived" value={overview?.archivedWorkspaces ?? '…'} icon={<Building2 size={18}/>}/><Metric label="Created in last 30 days" value={overview?.createdLast30Days ?? '…'} icon={<Activity size={18}/>}/><Metric label="Active students across colleges" value={overview?.activeStudents ?? '…'} icon={<Users size={18}/>}/></div>
          <OperationalAlerts alerts={overview?.alerts || []} summary={overview?.alertSummary} onOpen={openWorkspace}/>
          <section className="rounded-2xl bg-white p-5 shadow-sm"><h2 className="font-bold">Subscription states</h2><div className="mt-3 flex flex-wrap gap-2">{overview?.subscriptions?.map((item: any) => <span key={item.status} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">{item.status.replaceAll('_',' ')} · {item.count}</span>)}</div><p className="mt-3 text-xs text-slate-500">Plan limits and features are configurable. College subscriptions are managed manually; pricing, invoicing, and payment processing are not enabled.</p></section>
          <WorkspaceDirectory rows={workspaces.slice(0, 8)} query={workspaceQuery} setQuery={setWorkspaceQuery} status={workspaceStatus} setStatus={setWorkspaceStatus} onOpen={openWorkspace} onCreate={createWorkspace} busy={busy}/>
        </> : activePage === 'workspaces' ? <WorkspaceDirectory rows={workspaces} query={workspaceQuery} setQuery={setWorkspaceQuery} status={workspaceStatus} setStatus={setWorkspaceStatus} onOpen={openWorkspace} onCreate={createWorkspace} busy={busy}/> : activePage === 'admins' ? <section className="space-y-5 rounded-2xl bg-white p-5 shadow-sm"><div><p className="text-xs font-bold uppercase tracking-widest text-indigo-600">Access control</p><h1 className="mt-1 text-2xl font-extrabold">Platform administrators</h1><p className="mt-1 text-sm text-slate-500">Invite-only access. Accounts require a password and an authenticator code.</p></div><form onSubmit={(event) => void inviteAdmin(event)} className="flex flex-col gap-2 sm:flex-row"><input required type="email" value={platformAdminEmail} onChange={(event) => setPlatformAdminEmail(event.target.value)} placeholder="New platform admin email" className={`${inputClass} flex-1`}/><button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white"><Plus size={16}/>Create invite</button></form><AdminTable rows={admins} onToggle={toggleAdmin} onResetMfa={resetAdminMfa}/></section> : activePage === 'audit' ? <PlatformAuditLog/> : <SharedContentLibrary/>}
      </main>
    </div>
  </div>;
};

const WorkspaceDirectory: React.FC<{ rows: PlatformWorkspace[]; query: string; setQuery: (value: string) => void; status: string; setStatus: (value: string) => void; onOpen: (id: string) => void; onCreate: (data: { name: string; adminName: string; adminEmail: string }) => void; busy: boolean }> = ({ rows, query, setQuery, status, setStatus, onOpen, onCreate, busy }) => {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState(''); const [adminName, setAdminName] = useState(''); const [adminEmail, setAdminEmail] = useState('');
  return <section className="space-y-4 rounded-2xl bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-indigo-600">Directory</p><h2 className="mt-1 text-xl font-extrabold">College workspaces</h2></div><button onClick={() => setShowCreate((value) => !value)} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white"><Plus size={15}/>Provision college</button></div>
    {showCreate && <form onSubmit={(event) => { event.preventDefault(); onCreate({ name, adminName, adminEmail }); setShowCreate(false); }} className="grid gap-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 sm:grid-cols-2"><label className="text-xs font-bold">College name<input required minLength={2} value={name} onChange={(event) => setName(event.target.value)} className={`${inputClass} mt-1`}/></label><label className="text-xs font-bold">Initial admin name<input required minLength={2} value={adminName} onChange={(event) => setAdminName(event.target.value)} className={`${inputClass} mt-1`}/></label><label className="text-xs font-bold sm:col-span-2">Initial admin email<input required type="email" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} className={`${inputClass} mt-1`}/></label><p className="text-xs text-slate-500 sm:col-span-2">Creates an onboarding workspace with the Pilot planning tier. The first-admin invitation link is shown after creation; deliver it out of band.</p><button disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Create onboarding workspace</button></form>}
    <div className="grid gap-2 sm:grid-cols-[1fr_190px]"><label className="relative"><Search size={15} className="absolute left-3 top-3 text-slate-400"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search colleges or slugs" className={`${inputClass} pl-9`}/></label><select value={status} onChange={(event) => setStatus(event.target.value)} className={inputClass}><option value="all">All workspace states</option>{Object.entries(statusLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr>{['College','State','Plan','Subscription','Students','Staff','Created'].map((item) => <th key={item} className="px-3 py-3">{item}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={row.id} onClick={() => onOpen(row.id)} className="cursor-pointer hover:bg-indigo-50/50"><td className="px-3 py-3"><strong className="block">{row.name}</strong><span className="text-[10px] text-slate-500">{row.slug}</span></td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${statusStyles[row.lifecycleStatus]}`}>{statusLabels[row.lifecycleStatus]}</span></td><td className="px-3 py-3">{row.planName || planLabels[row.planId] || row.planId}</td><td className="px-3 py-3">{row.subscriptionStatus?.replaceAll('_',' ')}</td><td className="px-3 py-3">{row.activeStudents}</td><td className="px-3 py-3">{row.staffCount}</td><td className="px-3 py-3">{row.createdAt}</td></tr>)}{rows.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-slate-500">No workspaces match this filter.</td></tr>}</tbody></table></div>
  </section>;
};

const OperationalAlerts: React.FC<{ alerts: Array<{ id: string; type: string; severity: 'warning' | 'high' | 'critical'; workspaceId: string; workspaceName: string; title: string; message: string; percent?: number }>; summary?: { total: number; critical: number; high: number; warning: number }; onOpen: (workspaceId: string) => void }> = ({ alerts, summary, onOpen }) => {
  const severityStyles = { critical: 'border-rose-200 bg-rose-50 text-rose-900', high: 'border-orange-200 bg-orange-50 text-orange-900', warning: 'border-amber-200 bg-amber-50 text-amber-900' };
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-indigo-600"><AlertTriangle size={15}/>Operations</p><h2 className="mt-1 text-lg font-extrabold">Operational alerts</h2><p className="mt-1 text-xs text-slate-500">Onboarding delays, college-admin invitations, and workspace capacity usage.</p></div><span className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">{summary?.total ?? alerts.length} open</span></header>
    {alerts.length === 0 ? <p className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">No operational alerts. All tracked workspaces are within the configured thresholds.</p> : <div className="mt-4 max-h-[440px] space-y-2 overflow-y-auto pr-1">{alerts.map((alert) => <article key={alert.id} className={`flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between ${severityStyles[alert.severity]}`}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{alert.title}</strong><span className="rounded-full bg-white/70 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide">{alert.severity}</span></div><p className="mt-1 text-xs font-semibold">{alert.workspaceName}</p><p className="mt-1 text-xs opacity-80">{alert.message}</p></div><button onClick={() => onOpen(alert.workspaceId)} className="inline-flex shrink-0 items-center justify-center gap-1 rounded-lg border border-current/20 bg-white/70 px-3 py-2 text-xs font-bold">Review college<ArrowUpRight size={13}/></button></article>)}</div>}
    {summary && summary.total > 0 && <p className="mt-3 text-[10px] text-slate-400">{summary.critical} critical · {summary.high} high · {summary.warning} warning. Capacity warnings begin at 80%; invitation alerts cover expired links or links expiring within 24 hours; onboarding alerts start after 7 days.</p>}
  </section>;
};

const planFeatureLabels: Record<string, string> = {
  college_workspace: 'College workspace', student_and_trainer_access: 'Student and trainer access', batches: 'Batches', curriculum: 'Curriculum',
  assessments: 'Assessments', interview_feedback: 'Interview feedback', basic_analytics: 'Basic analytics', standard_exports: 'Standard exports',
  ai_insights: 'AI insights', college_analytics: 'College analytics', advanced_analytics: 'Advanced analytics', custom_branding: 'Custom branding', priority_support: 'Priority support',
};
const planLimitLabels: Record<string, string> = { active_students: 'Active students', trainer_seats: 'Trainer seats', active_batches: 'Active batches', ai_credits_per_period: 'AI credits per period' };

const PlanCatalogPage: React.FC = () => {
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const reload = async () => setPlans(await getPlatformPlans());
  useEffect(() => { getPlatformPlans().then(setPlans).catch((err) => setError(err.message)).finally(() => setLoading(false)); }, []);
  const updatePlan = (id: PlatformPlan['id'], update: Partial<PlatformPlan>) => setPlans((current) => current.map((plan) => plan.id === id ? { ...plan, ...update } : plan));
  const save = async (plan: PlatformPlan) => {
    const reason = window.prompt(`Reason for changing the ${plan.name} plan configuration (required):`) || '';
    if (reason.trim().length < 5) { setError('Enter a change reason of at least five characters.'); return; }
    setSavingId(plan.id); setError(''); setNotice('');
    try { await savePlatformPlan(plan.id, { name: plan.name, description: plan.description, monthlyPricePaise: plan.monthlyPricePaise, annualPricePaise: plan.annualPricePaise, limits: plan.limits, features: plan.features, isActive: plan.isActive, reason }); await reload(); setNotice(`${plan.name} plan saved. New prices and limits apply to new checkouts.`); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save this plan.'); }
    finally { setSavingId(''); }
  };
  const toggleFeature = (plan: PlatformPlan, feature: string, enabled: boolean) => updatePlan(plan.id, { features: enabled ? [...plan.features, feature] : plan.features.filter((item) => item !== feature) });
  return <section className="space-y-5 rounded-2xl bg-white p-5 shadow-sm">
    <header><p className="text-xs font-bold uppercase tracking-widest text-indigo-600">Commercial setup</p><h1 className="mt-1 text-2xl font-extrabold">Plans & subscriptions</h1><p className="mt-1 text-sm text-slate-500">Configure plan entitlements and INR recurring prices. Customers can check out only when Razorpay credentials are configured.</p></header>
    {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}{notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {loading ? <p className="text-sm text-slate-500">Loading plan catalog…</p> : <div className="grid gap-4 xl:grid-cols-3">{plans.map((plan) => <article key={plan.id} className="space-y-4 rounded-xl border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-2"><div><span className="text-[10px] font-bold uppercase tracking-widest text-indigo-600">{plan.id.replaceAll('_',' ')}</span><h2 className="mt-1 text-lg font-extrabold">{plan.name}</h2></div><label className="flex items-center gap-2 text-[10px] font-bold"><input type="checkbox" checked={plan.isActive} onChange={(event) => updatePlan(plan.id, { isActive: event.target.checked })}/>Available</label></div>
      <label className="block text-xs font-semibold">Display name<input maxLength={120} value={plan.name} onChange={(event) => updatePlan(plan.id, { name: event.target.value })} className={`${inputClass} mt-1`}/></label>
      <label className="block text-xs font-semibold">Description<textarea maxLength={1000} rows={2} value={plan.description} onChange={(event) => updatePlan(plan.id, { description: event.target.value })} className={`${inputClass} mt-1`}/></label>
      <div className="grid grid-cols-2 gap-2"><label className="block text-xs font-semibold">Monthly price (₹)<input type="number" min="1" step="1" value={plan.monthlyPricePaise === null ? '' : plan.monthlyPricePaise / 100} onChange={(event) => updatePlan(plan.id, { monthlyPricePaise: event.target.value === '' ? null : Math.round(Number(event.target.value) * 100) })} className={`${inputClass} mt-1`} placeholder="Not set"/></label><label className="block text-xs font-semibold">Annual price (₹)<input type="number" min="1" step="1" value={plan.annualPricePaise === null ? '' : plan.annualPricePaise / 100} onChange={(event) => updatePlan(plan.id, { annualPricePaise: event.target.value === '' ? null : Math.round(Number(event.target.value) * 100) })} className={`${inputClass} mt-1`} placeholder="Not set"/></label></div>
      <div><h3 className="text-xs font-bold">Capacity limits</h3><div className="mt-2 space-y-2">{plan.limits.map((limit) => <label key={limit.key} className="flex items-center justify-between gap-2 text-[11px] text-slate-600">{planLimitLabels[limit.key]}<input type="number" min={0} value={limit.value ?? ''} placeholder="Unset" onChange={(event) => updatePlan(plan.id, { limits: plan.limits.map((item) => item.key === limit.key ? { ...item, value: event.target.value === '' ? null : Number(event.target.value) } : item) })} className="w-28 rounded-lg border border-slate-200 px-2 py-1.5 text-right text-xs"/></label>)}</div></div>
      <div><h3 className="text-xs font-bold">Included features</h3><div className="mt-2 grid grid-cols-2 gap-2">{Object.entries(planFeatureLabels).map(([feature, label]) => <label key={feature} className="flex items-start gap-2 text-[10px] leading-4 text-slate-600"><input type="checkbox" checked={plan.features.includes(feature)} onChange={(event) => toggleFeature(plan, feature, event.target.checked)} className="mt-0.5"/>{label}</label>)}</div></div>
      <p className="text-[10px] text-slate-400">Last updated: {plan.updatedAt} · Every change is audited. Prices are stored in paise and apply to new checkouts.</p>
      <button disabled={savingId === plan.id} onClick={() => void save(plan)} className="w-full rounded-lg bg-indigo-600 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50">{savingId === plan.id ? 'Saving…' : 'Save plan configuration'}</button>
    </article>)}</div>}
    <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Recurring billing uses Razorpay Subscriptions. Existing provider plans retain their original price; change the plan price only after considering active subscriptions.</p>
  </section>;
};

const SubscriptionAdminForm: React.FC<{ detail: any; onSave: (payload: { planId: PlatformPlan['id']; status: string; currentPeriodStart: string | null; currentPeriodEnd: string | null; internalNote: string; reason: string }) => Promise<void> }> = ({ detail, onSave }) => {
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [planId, setPlanId] = useState<PlatformPlan['id']>(detail.planId || 'pilot');
  const [status, setStatus] = useState(detail.subscriptionStatus || 'not_configured');
  const [start, setStart] = useState(detail.currentPeriodStart || '');
  const [end, setEnd] = useState(detail.currentPeriodEnd || '');
  const [note, setNote] = useState(detail.internalNote || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { getPlatformPlans().then(setPlans).catch((err) => setError(err.message)); }, []);
  useEffect(() => { setPlanId(detail.planId || 'pilot'); setStatus(detail.subscriptionStatus || 'not_configured'); setStart(detail.currentPeriodStart || ''); setEnd(detail.currentPeriodEnd || ''); setNote(detail.internalNote || ''); }, [detail.id, detail.planId, detail.subscriptionStatus, detail.currentPeriodStart, detail.currentPeriodEnd, detail.internalNote]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const reason = window.prompt(`Reason for updating ${detail.name}'s subscription (required):`) || '';
    if (reason.trim().length < 5) { setError('Enter a change reason of at least five characters.'); return; }
    setSaving(true); setError('');
    try { await onSave({ planId, status, currentPeriodStart: start || null, currentPeriodEnd: end || null, internalNote: note, reason }); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save subscription.'); }
    finally { setSaving(false); }
  };
  return <section className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-4"><div><h2 className="font-bold">Manual subscription administration</h2><p className="mt-1 text-xs text-slate-500">Set the college plan, subscription state, term dates, and a platform-only internal note. College administrators cannot see the note.</p></div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-2 text-xs text-rose-700">{error}</p>}
    <form onSubmit={(event) => void submit(event)} className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <label className="text-xs font-semibold">Plan<select value={planId} onChange={(event) => setPlanId(event.target.value as PlatformPlan['id'])} className={`${inputClass} mt-1`}>{plans.map((plan) => <option key={plan.id} value={plan.id} disabled={!plan.isActive && plan.id !== detail.planId}>{plan.name}{plan.isActive ? '' : ' · inactive'}</option>)}</select></label>
      <label className="text-xs font-semibold">Subscription status<select value={status} onChange={(event) => setStatus(event.target.value)} className={`${inputClass} mt-1`}>{[['not_configured','Not configured'],['trialing','Trialing'],['active','Active'],['past_due','Past due'],['canceled','Canceled'],['suspended','Suspended']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-xs font-semibold">Term start<input type="date" value={start} onChange={(event) => setStart(event.target.value)} className={`${inputClass} mt-1`}/></label>
      <label className="text-xs font-semibold">Term end<input type="date" min={start || undefined} value={end} onChange={(event) => setEnd(event.target.value)} className={`${inputClass} mt-1`}/></label>
      <label className="text-xs font-semibold sm:col-span-2">Internal note<textarea maxLength={5000} rows={2} value={note} onChange={(event) => setNote(event.target.value)} className={`${inputClass} mt-1`} placeholder="Internal context for the TalentEdge team"/></label>
      <button disabled={saving || !plans.length} className="self-end rounded-lg bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save subscription'}</button>
    </form>
  </section>;
};

const WorkspaceDetail: React.FC<{ detail: any; onBack: () => void; onStatus: (status: string) => void; onInviteAdmin: (id: string, email: string) => void; onResendInvite: (workspaceId: string, invitationId: string, email: string) => void; onRevokeInvite: (workspaceId: string, invitationId: string, email: string) => void; onSubscriptionSave: (payload: { planId: PlatformPlan['id']; status: string; currentPeriodStart: string | null; currentPeriodEnd: string | null; internalNote: string; reason: string }) => Promise<void> }> = ({ detail, onBack, onStatus, onInviteAdmin, onResendInvite, onRevokeInvite, onSubscriptionSave }) => {
  const [adminEmail, setAdminEmail] = useState('');
  const readiness = detail.onboardingReadiness;
  const firstInvite = detail.initialAdminInvitation;
  const hasActiveAdmin = Boolean(readiness?.hasActiveCollegeAdmin);
  const invitationSummary = firstInvite
    ? `${firstInvite.status[0].toUpperCase()}${firstInvite.status.slice(1)} · ${firstInvite.email}${firstInvite.status === 'pending' ? ` · expires ${firstInvite.expiresAt}` : ''}`
    : 'No initial administrator invitation found.';

  return <section className="space-y-5 rounded-2xl bg-white p-5 shadow-sm">
    <button onClick={onBack} className="inline-flex items-center gap-1 text-xs font-bold text-indigo-700"><ArrowLeft size={14}/>All colleges</button>
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-indigo-600">Workspace details</p><h1 className="mt-1 text-2xl font-extrabold">{detail.name}</h1><p className="mt-1 text-xs text-slate-500">{detail.slug} · Created {detail.createdAt}</p></div><span className={`rounded-full px-3 py-1.5 text-xs font-bold ${statusStyles[detail.lifecycleStatus]}`}>{statusLabels[detail.lifecycleStatus]}</span></header>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Active students" value={detail.activeStudents} icon={<Users size={17}/>}/><Metric label="Staff seats" value={detail.staffCount} icon={<Shield size={17}/>}/><Metric label="Active batches" value={detail.activeBatches} icon={<Building2 size={17}/>}/><Metric label="Plan / subscription" value={`${detail.planName || planLabels[detail.planId] || detail.planId} · ${detail.subscriptionStatus || 'unconfigured'}`} icon={<CreditCard size={17}/>}/></div>

    <SubscriptionAdminForm detail={detail} onSave={onSubscriptionSave}/>

    <section className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
      <h2 className="font-bold">Onboarding readiness</h2>
      <p className="mt-1 text-xs text-slate-500">The first college administrator must accept the invitation and have active workspace access before this college can be activated.</p>
      <div className="mt-3 space-y-2">
        <ReadinessItem label="Workspace registered" complete detail="Workspace record is available in TalentEdge."/>
        <ReadinessItem label="Initial college-admin invitation" complete={firstInvite?.status === 'accepted'} detail={invitationSummary}/>
        <ReadinessItem label="Active college administrator can access the workspace" complete={hasActiveAdmin} detail={hasActiveAdmin ? `${readiness.activeCollegeAdminCount} active administrator${readiness.activeCollegeAdminCount === 1 ? '' : 's'}.` : 'Waiting for an administrator to accept the invitation and activate their account.'}/>
        <ReadinessItem label="First student batch" complete={Number(detail.activeBatches) > 0} optional detail={Number(detail.activeBatches) > 0 ? `${detail.activeBatches} active batch${Number(detail.activeBatches) === 1 ? '' : 'es'} configured.` : 'Recommended after activation; not required to activate the college.'}/>
      </div>
    </section>

    <section className="rounded-xl border border-slate-200 p-4"><h2 className="font-bold">Workspace access lifecycle</h2><p className="mt-1 text-xs text-slate-500">Suspended and archived workspaces cannot sign in. These actions revoke existing college sessions and are reversible.</p><p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">Current reason: {detail.statusReason || 'No status reason recorded.'}</p><div className="mt-3 flex flex-wrap gap-2">{Object.keys(statusLabels).filter((status) => status !== detail.lifecycleStatus).map((status) => <button key={status} disabled={status === 'active' && !hasActiveAdmin} title={status === 'active' && !hasActiveAdmin ? 'An accepted, active college administrator is required.' : undefined} onClick={() => onStatus(status)} className={`rounded-lg px-3 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40 ${statusStyles[status]}`}>Set {statusLabels[status]}</button>)}</div>{!hasActiveAdmin && detail.lifecycleStatus !== 'active' && <p className="mt-2 text-xs font-medium text-amber-800">Set Active is unavailable until an invited college administrator accepts and has active access.</p>}</section>

    <section className="rounded-xl border border-slate-200 p-4">
      <div><h2 className="font-bold">College-admin invitations</h2><p className="mt-1 text-xs text-slate-500">Pending, accepted, expired, and revoked invitations. Resending creates a fresh link and invalidates its previous pending link.</p></div>
      <div className="mt-3 space-y-2">
        {(detail.adminInvitations || []).map((invitation: any) => <div key={invitation.id} className="flex flex-col gap-3 rounded-lg border border-slate-100 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="break-all text-sm">{invitation.email}</strong><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${invitation.status === 'accepted' ? 'bg-emerald-100 text-emerald-800' : invitation.status === 'pending' ? 'bg-amber-100 text-amber-800' : invitation.status === 'expired' ? 'bg-slate-100 text-slate-600' : 'bg-rose-100 text-rose-700'}`}>{invitation.status}</span></div><p className="mt-1 text-[11px] text-slate-500">Created {invitation.createdAt} · {invitation.status === 'accepted' ? `Accepted ${invitation.acceptedAt}` : invitation.status === 'revoked' ? `Revoked ${invitation.revokedAt}` : `Expires ${invitation.expiresAt}`}</p></div>
          <div className="flex shrink-0 gap-2">{invitation.canResend && <button onClick={() => onResendInvite(detail.id, invitation.id, invitation.email)} className="rounded-lg border border-indigo-200 px-3 py-2 text-xs font-bold text-indigo-700">Resend</button>}{invitation.canRevoke && <button onClick={() => onRevokeInvite(detail.id, invitation.id, invitation.email)} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700">Revoke</button>}</div>
        </div>)}
        {(!detail.adminInvitations || detail.adminInvitations.length === 0) && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">No college-admin invitations have been sent.</p>}
      </div>
    </section>

    <section className="rounded-xl border border-slate-200 p-4"><h2 className="font-bold">College administrators</h2><div className="mt-3 divide-y divide-slate-100">{detail.collegeAdmins.map((contact: any) => <div key={contact.email} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><span>{contact.name}<span className="ml-2 text-xs text-slate-500">{contact.email}</span></span><span className={`text-xs capitalize ${contact.status === 'active' && Number(contact.accountActive) === 1 ? 'text-emerald-700' : 'text-slate-500'}`}>{contact.status === 'active' && Number(contact.accountActive) === 1 ? 'Active access' : contact.status === 'active' ? 'Account inactive' : contact.status}</span></div>)}{detail.collegeAdmins.length === 0 && <p className="py-3 text-sm text-slate-500">No college administrator has accepted an invitation yet.</p>}</div><form onSubmit={(event) => { event.preventDefault(); onInviteAdmin(detail.id, adminEmail); }} className="mt-4 flex flex-col gap-2 sm:flex-row"><input required type="email" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} placeholder="New college administrator email" className={`${inputClass} flex-1`}/><button disabled={['suspended','archived'].includes(detail.lifecycleStatus)} className="rounded-lg border border-indigo-200 px-3 py-2 text-xs font-bold text-indigo-700 disabled:opacity-50">Create invite</button></form><p className="mt-2 text-[10px] text-slate-400">Invitation links expire after 72 hours. Creating a replacement for the same email invalidates prior pending links. Email delivery status is returned when an invitation is created.</p></section>

    <section className="rounded-xl border border-slate-200 p-4"><h2 className="flex items-center gap-2 font-bold"><Activity size={16}/>Recent platform activity</h2><div className="mt-3 divide-y divide-slate-100">{detail.recentPlatformActivity.map((item: any, index: number) => <div key={`${item.createdAt}-${index}`} className="py-2 text-xs"><strong>{item.action.replaceAll('.',' ')}</strong><span className="ml-2 text-slate-500">{item.createdAt}</span><p className="mt-1 text-slate-500">{item.reason || '—'}</p></div>)}</div></section>
  </section>;
};

const ReadinessItem: React.FC<{ label: string; complete: boolean; detail: string; optional?: boolean }> = ({ label, complete, detail, optional }) => <div className="flex items-start gap-2 rounded-lg bg-white/80 p-3">
  <CheckCircle2 size={16} className={`mt-0.5 shrink-0 ${complete ? 'text-emerald-600' : optional ? 'text-slate-300' : 'text-amber-500'}`}/>
  <div className="min-w-0 flex-1"><p className="text-xs font-semibold text-slate-800">{label}{optional && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] uppercase tracking-wide text-slate-500">Recommended</span>}</p><p className="mt-1 text-[11px] text-slate-500">{detail}</p></div>
</div>;

const AdminTable: React.FC<{ rows: Array<{ id: string; name: string; email: string; isActive: boolean; lastLoginAt: string | null; createdAt: string }>; onToggle: (admin: { id: string; isActive: boolean }) => void; onResetMfa: (admin: { id: string; email: string }) => void }> = ({ rows, onToggle, onResetMfa }) => <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr>{['Administrator','Status','Last sign in','Access','MFA'].map((text) => <th key={text} className="px-3 py-3">{text}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map((admin) => <tr key={admin.id}><td className="px-3 py-3"><strong className="block">{admin.name}</strong><span className="text-xs text-slate-500">{admin.email}</span></td><td className="px-3 py-3">{admin.isActive ? 'Active' : 'Inactive'}</td><td className="px-3 py-3">{admin.lastLoginAt || 'Never'}</td><td className="px-3 py-3"><button onClick={() => onToggle(admin)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold">{admin.isActive ? 'Deactivate' : 'Activate'}</button></td><td className="px-3 py-3"><button disabled={!admin.isActive} onClick={() => onResetMfa(admin)} className="rounded-lg border border-amber-200 px-2.5 py-1.5 text-xs font-semibold text-amber-800 disabled:opacity-40">Reset MFA</button></td></tr>)}</tbody></table></div>;

const SubscriptionHistoryPage: React.FC = () => {
  const [workspaces, setWorkspaces] = useState<PlatformWorkspace[]>([]);
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ items: PlatformSubscriptionChange[]; total: number; limit: number }>({ items: [], total: 0, limit: 50 });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const loadHistory = async (nextOffset = offset) => {
    setLoading(true); setError('');
    try {
      const result = await getPlatformSubscriptionHistory({ workspaceId: workspaceId || undefined, status: status || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, offset: nextOffset });
      setData(result); setOffset(nextOffset);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load subscription history.'); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    Promise.all([getPlatformWorkspaces({ q: '', status: 'all' }), getPlatformPlans(), getPlatformSubscriptionHistory()])
      .then(([workspaceRows, planRows, history]) => { setWorkspaces(workspaceRows); setPlans(planRows); setData(history); })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load subscription history.'))
      .finally(() => setLoading(false));
  }, []);
  const planName = (id: unknown) => plans.find((plan) => plan.id === id)?.name || String(id || '—');
  const displayValue = (value: unknown) => value === null || value === undefined || value === '' ? '—' : String(value);
  const exportCsv = async () => {
    setExporting(true); setError(''); setNotice('');
    try {
      const result = await getPlatformSubscriptionHistory({ workspaceId: workspaceId || undefined, status: status || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, export: true });
      const columns = ['changedAt','workspaceName','actorName','actorEmail','reason','beforePlan','beforeStatus','beforeStart','beforeEnd','beforeInternalNote','afterPlan','afterStatus','afterStart','afterEnd','afterInternalNote'];
      const rows = result.items.map((item) => [item.changedAt, item.workspaceName, item.actorName, item.actorEmail || '', item.reason, planName(item.before.planId), item.before.status, item.before.currentPeriodStart, item.before.currentPeriodEnd, item.before.internalNote, planName(item.after.planId), item.after.status, item.after.currentPeriodStart, item.after.currentPeriodEnd, item.after.internalNote]);
      const csv = [columns, ...rows].map((row) => row.map((value) => { const raw = String(value ?? ''); const safe = /^[\t\r ]*[=+\-@]/.test(raw) ? `'${raw}` : raw; return `"${safe.replaceAll('"', '""')}"`; }).join(',')).join('\r\n');
      const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = 'talentedge-subscription-history.csv'; link.click(); URL.revokeObjectURL(url);
      setNotice(`Exported ${result.items.length.toLocaleString()} filtered subscription change${result.items.length === 1 ? '' : 's'}${result.total > result.items.length ? ` (first ${result.items.length.toLocaleString()} of ${result.total.toLocaleString()})` : ''}.`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not export subscription history.'); }
    finally { setExporting(false); }
  };
  const formatSnapshot = (snapshot: Record<string, unknown>) => <dl className="grid gap-x-5 gap-y-2 sm:grid-cols-2">{[['planId','Plan'],['status','Status'],['currentPeriodStart','Term start'],['currentPeriodEnd','Term end'],['internalNote','Internal note']].map(([key,label]) => <div key={key}><dt className="text-[9px] font-bold uppercase text-slate-400">{label}</dt><dd className="mt-0.5 whitespace-pre-wrap break-words text-xs text-slate-700">{key === 'planId' ? planName(snapshot[key]) : displayValue(snapshot[key])}</dd></div>)}</dl>;
  return <section className="space-y-5 rounded-2xl bg-white p-5 shadow-sm">
    <header><p className="text-xs font-bold uppercase tracking-widest text-indigo-600">Billing operations</p><h1 className="mt-1 text-2xl font-extrabold">Subscription change history</h1><p className="mt-1 text-sm text-slate-500">Review audited manual plan and subscription changes, including who changed them, the reason, and before/after values.</p></header>
    {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}{notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <div className="grid gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-5"><label className="text-xs font-semibold text-slate-600">College<select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} className={`${inputClass} mt-1`}><option value="">All colleges</option>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label><label className="text-xs font-semibold text-slate-600">Current status<select value={status} onChange={(event) => setStatus(event.target.value)} className={`${inputClass} mt-1`}><option value="">All statuses</option>{[['not_configured','Not configured'],['trialing','Trialing'],['active','Active'],['past_due','Past due'],['canceled','Canceled'],['suspended','Suspended']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-xs font-semibold text-slate-600">From date<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className={`${inputClass} mt-1`}/></label><label className="text-xs font-semibold text-slate-600">To date<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className={`${inputClass} mt-1`}/></label><div className="flex items-end gap-2"><button disabled={loading} onClick={() => void loadHistory(0)} className="flex-1 rounded-lg bg-indigo-600 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50">Apply filters</button><button disabled={exporting || loading} onClick={() => void exportCsv()} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold disabled:opacity-50">{exporting ? 'Exporting…' : 'Export CSV'}</button></div></div>
    <div className="flex items-center justify-between text-xs text-slate-500"><span>{loading ? 'Loading…' : `${data.total.toLocaleString()} matching change${data.total === 1 ? '' : 's'}`}</span><span>Internal notes are visible only to platform administrators.</span></div>
    <div className="space-y-3">{data.items.map((item) => <article key={item.id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-bold">{item.workspaceName}</h2><p className="mt-1 text-[11px] text-slate-500">{item.changedAt} UTC · {item.actorName}{item.actorEmail ? ` · ${item.actorEmail}` : ''}</p></div><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold text-indigo-700">{String(item.after.status || '').replaceAll('_',' ') || 'updated'}</span></div><p className="mt-3 text-xs text-slate-700"><strong>Reason:</strong> {item.reason || '—'}</p><details className="mt-3 rounded-lg bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-bold text-slate-700">Review before and after values</summary><div className="mt-3 grid gap-4 md:grid-cols-2"><div><h3 className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Before</h3>{formatSnapshot(item.before)}</div><div><h3 className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">After</h3>{formatSnapshot(item.after)}</div></div></details></article>)}{!loading && data.items.length === 0 && <p className="rounded-xl border border-slate-100 p-10 text-center text-sm text-slate-500">No subscription changes match these filters.</p>}</div>
    <footer className="flex items-center justify-between gap-3"><span className="text-xs text-slate-500">Showing {data.total ? offset + 1 : 0}–{Math.min(offset + data.limit, data.total)} of {data.total}</span><div className="flex gap-2"><button disabled={offset === 0 || loading} onClick={() => void loadHistory(Math.max(0, offset - data.limit))} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold disabled:opacity-40">Previous</button><button disabled={offset + data.limit >= data.total || loading} onClick={() => void loadHistory(offset + data.limit)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold disabled:opacity-40">Next</button></div></footer>
  </section>;
};

const PlatformAuditLog: React.FC = () => {
  const [query, setQuery] = useState('');
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ items: Array<{ id: string; action: string; targetType: string; targetId: string | null; targetName: string | null; reason: string; createdAt: string; actorName: string; actorEmail: string | null }>; total: number; limit: number }>({ items: [], total: 0, limit: 50 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      getPlatformAuditEvents({ q: query, action, targetType, dateFrom, dateTo, offset })
        .then((result) => { if (current) setData(result); })
        .catch((err) => { if (current) setError(err instanceof Error ? err.message : 'Could not load audit activity.'); })
        .finally(() => { if (current) setLoading(false); });
    }, 200);
    return () => { current = false; window.clearTimeout(timer); };
  }, [query, action, targetType, dateFrom, dateTo, offset]);

  const clearFilters = () => { setQuery(''); setAction(''); setTargetType(''); setDateFrom(''); setDateTo(''); setOffset(0); };
  const firstResult = data.total ? offset + 1 : 0;
  const lastResult = Math.min(offset + data.limit, data.total);

  return <section className="space-y-5 rounded-2xl bg-white p-5 shadow-sm">
    <header><p className="text-xs font-bold uppercase tracking-widest text-indigo-600">Governance</p><h1 className="mt-1 text-2xl font-extrabold">Platform audit log</h1><p className="mt-1 text-sm text-slate-500">Search workspace changes, administrator access, invitations, MFA resets, and recovery activity.</p></header>
    <div className="grid gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-3">
      <label className="text-xs font-semibold text-slate-600 sm:col-span-2 xl:col-span-1">Search<input value={query} onChange={(event) => { setQuery(event.target.value); setOffset(0); }} placeholder="Actor, college, action, reason, or ID" className={`${inputClass} mt-1`}/></label>
      <label className="text-xs font-semibold text-slate-600">Action contains<input value={action} onChange={(event) => { setAction(event.target.value); setOffset(0); }} placeholder="e.g. invitation, lifecycle, mfa" className={`${inputClass} mt-1`}/></label>
      <label className="text-xs font-semibold text-slate-600">Target type<select value={targetType} onChange={(event) => { setTargetType(event.target.value); setOffset(0); }} className={`${inputClass} mt-1`}><option value="">All targets</option><option value="workspace">Workspace</option><option value="platform_admin">Platform administrator</option><option value="platform_admin_invitation">Platform-admin invitation</option></select></label>
      <label className="text-xs font-semibold text-slate-600">From date<input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setOffset(0); }} className={`${inputClass} mt-1`}/></label>
      <label className="text-xs font-semibold text-slate-600">To date<input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setOffset(0); }} className={`${inputClass} mt-1`}/></label>
      <div className="flex items-end justify-between gap-2"><span className="pb-2 text-xs text-slate-500">{loading ? 'Searching…' : `${data.total.toLocaleString()} event${data.total === 1 ? '' : 's'}`}</span><button onClick={clearFilters} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-600">Clear filters</button></div>
    </div>
    {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    <div className="overflow-x-auto rounded-xl border border-slate-100"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr>{['Date and time','Actor','Action','Target','Reason'].map((label) => <th key={label} className="px-3 py-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{data.items.map((event) => <tr key={event.id} className="align-top"><td className="whitespace-nowrap px-3 py-3 text-xs text-slate-600">{event.createdAt} UTC</td><td className="px-3 py-3"><strong className="block text-xs">{event.actorName}</strong>{event.actorEmail && <span className="text-[10px] text-slate-500">{event.actorEmail}</span>}</td><td className="px-3 py-3"><span className="rounded-md bg-indigo-50 px-2 py-1 text-[10px] font-bold text-indigo-700">{event.action.replaceAll('.', ' ')}</span></td><td className="px-3 py-3"><strong className="block text-xs">{event.targetName || event.targetId || '—'}</strong><span className="text-[10px] capitalize text-slate-500">{event.targetType.replaceAll('_', ' ')}</span></td><td className="max-w-sm whitespace-normal px-3 py-3 text-xs text-slate-600">{event.reason || '—'}</td></tr>)}{!loading && data.items.length === 0 && !error && <tr><td colSpan={5} className="p-10 text-center text-sm text-slate-500">No audit events match these filters.</td></tr>}</tbody></table></div>
    <footer className="flex items-center justify-between gap-3"><span className="text-xs text-slate-500">Showing {firstResult}–{lastResult} of {data.total}</span><div className="flex gap-2"><button disabled={offset === 0 || loading} onClick={() => setOffset((value) => Math.max(0, value - data.limit))} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold disabled:opacity-40">Previous</button><button disabled={offset + data.limit >= data.total || loading} onClick={() => setOffset((value) => value + data.limit)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold disabled:opacity-40">Next</button></div></footer>
  </section>;
};

type SharedMaterialForm = { dayNumber: number; title: string; materialType: 'video' | 'text' | 'pdf'; contentUrl: string; contentText: string; contentFormat: 'markdown' | 'html'; isRequired: boolean };
const newSharedMaterialForm = (): SharedMaterialForm => ({ dayNumber: 1, title: '', materialType: 'text', contentUrl: '', contentText: '', contentFormat: 'markdown', isRequired: true });

const SharedContentLibrary: React.FC = () => {
  const [versions, setVersions] = useState<SharedContentVersion[]>([]);
  const [applications, setApplications] = useState<SharedContentApplication[]>([]);
  const [rollout, setRollout] = useState<SharedContentRollout | null>(null);
  const [workspaces, setWorkspaces] = useState<PlatformWorkspace[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getSharedContentVersion>> | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [historyWorkspaceId, setHistoryWorkspaceId] = useState('');
  const [historyDateFrom, setHistoryDateFrom] = useState('');
  const [historyDateTo, setHistoryDateTo] = useState('');
  const [materialForm, setMaterialForm] = useState<SharedMaterialForm>(newSharedMaterialForm());
  const [editingMaterialId, setEditingMaterialId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refreshApplications = async () => setApplications(await getSharedContentApplications({ workspaceId: historyWorkspaceId, dateFrom: historyDateFrom, dateTo: historyDateTo }));
  const refreshRollout = async () => setRollout(await getSharedContentRollout());

  const refreshVersions = async (selectId?: string) => {
    const next = await getSharedContentVersions();
    setVersions(next);
    if (selectId) setSelectedVersionId(selectId);
    else if (!selectedVersionId && next.length) setSelectedVersionId(next[0].id);
  };

  useEffect(() => {
    let current = true;
    Promise.all([getSharedContentVersions(), getPlatformWorkspaces({ q: '', status: 'all' }), getSharedContentApplications(), getSharedContentRollout()])
      .then(([versionRows, workspaceRows, applicationRows, rolloutData]) => {
        if (!current) return;
        setVersions(versionRows);
        setWorkspaces(workspaceRows);
        setApplications(applicationRows);
        setRollout(rolloutData);
        if (versionRows.length) setSelectedVersionId(versionRows[0].id);
      })
      .catch((err) => { if (current) setError(err instanceof Error ? err.message : 'Could not load the shared content library.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (!selectedVersionId) { setDetail(null); return; }
    let current = true;
    setLoading(true); setError(''); setNotice(''); setEditingMaterialId(''); setMaterialForm(newSharedMaterialForm());
    getSharedContentVersion(selectedVersionId)
      .then((version) => { if (current) setDetail(version); })
      .catch((err) => { if (current) setError(err instanceof Error ? err.message : 'Could not load this content version.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [selectedVersionId]);

  const saveDraft = async () => {
    if (!detail || detail.status !== 'draft') return;
    await saveSharedContentDraft(detail.id, { title: detail.title, materials: detail.materials, enabledAssessmentIds: detail.enabledAssessmentIds });
    setDetail(await getSharedContentVersion(detail.id));
    await refreshVersions(detail.id);
  };

  const createDraft = async () => {
    setBusy(true); setError(''); setNotice('');
    try { const draft = await createSharedContentDraft(); await refreshVersions(draft.id); setNotice(`Draft version ${draft.versionNumber} created from the latest published package.`); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not create a content draft.'); }
    finally { setBusy(false); }
  };

  const saveChanges = async () => {
    if (!detail) return;
    setBusy(true); setError(''); setNotice('');
    try { await saveDraft(); setNotice('Draft saved. It is not available to colleges until published and explicitly applied.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save this content draft.'); }
    finally { setBusy(false); }
  };

  const publish = async () => {
    if (!detail || detail.status !== 'draft') return;
    const reason = window.prompt(`Reason for publishing version ${detail.versionNumber} (required):`) || '';
    if (reason.trim().length < 5) { setError('Enter a publish reason of at least five characters.'); return; }
    if (!window.confirm(`Publish ${detail.title}? Published versions are immutable. Colleges will not receive it until you apply it to a workspace.`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await saveDraft();
      await publishSharedContent(detail.id, reason);
      await refreshVersions(detail.id);
      await refreshRollout();
      setDetail(await getSharedContentVersion(detail.id));
      setNotice(`Version ${detail.versionNumber} published. Apply it to each college that should receive this release.`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not publish this content version.'); }
    finally { setBusy(false); }
  };

  const apply = async () => {
    if (!detail || detail.status !== 'published' || !selectedWorkspaceId) return;
    const workspace = workspaces.find((item) => item.id === selectedWorkspaceId);
    const reason = window.prompt(`Reason for applying version ${detail.versionNumber} to ${workspace?.name || 'this college'} (required):`) || '';
    if (reason.trim().length < 5) { setError('Enter an apply reason of at least five characters.'); return; }
    if (!window.confirm(`Apply the published shared materials and assessment templates to ${workspace?.name}? Customized college content and student progress will be preserved.`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await applySharedContent(detail.id, selectedWorkspaceId, reason);
      await refreshVersions(detail.id);
      await refreshApplications();
      await refreshRollout();
      setNotice(`Applied v${result.versionNumber} to ${result.workspaceName}: ${result.materialAdded} materials added, ${result.materialUpdated} shared materials updated, ${result.materialPreserved} customized materials preserved; ${result.assessmentAdded} assessments added, ${result.assessmentUpdated} shared assessments updated, ${result.assessmentPreserved} customized assessments preserved.`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not apply this content version.'); }
    finally { setBusy(false); }
  };

  const rollback = async (application: SharedContentApplication) => {
    const reason = window.prompt(`Reason for rolling ${application.workspaceName} back to version ${application.versionNumber} (required):`) || '';
    if (reason.trim().length < 5) { setError('Enter a rollback reason of at least five characters.'); return; }
    if (!window.confirm(`Reapply published version ${application.versionNumber} to ${application.workspaceName}? This is recorded as a new history entry. College-customized content and student progress will be preserved.`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await rollbackSharedContent(application.versionId, application.workspaceId, reason);
      await refreshApplications();
      await refreshRollout();
      await refreshVersions();
      setNotice(`Rolled ${result.workspaceName} back to shared content v${result.versionNumber}. Customized content and student progress were preserved.`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not roll back shared content.'); }
    finally { setBusy(false); }
  };

  const submitMaterial = (event: FormEvent) => {
    event.preventDefault();
    if (!detail || detail.status !== 'draft') return;
    const current = detail.materials || [];
    if (editingMaterialId) {
      setDetail({ ...detail, materials: current.map((material) => material.id === editingMaterialId ? { ...material, ...materialForm, contentUrl: materialForm.materialType === 'text' ? null : materialForm.contentUrl, contentText: materialForm.materialType === 'text' ? materialForm.contentText : null } : material) });
    } else {
      setDetail({ ...detail, materials: [...current, { id: crypto.randomUUID(), ...materialForm, contentUrl: materialForm.materialType === 'text' ? null : materialForm.contentUrl, contentText: materialForm.materialType === 'text' ? materialForm.contentText : null, position: current.filter((material) => material.dayNumber === materialForm.dayNumber).length }] });
    }
    setEditingMaterialId(''); setMaterialForm(newSharedMaterialForm()); setNotice('Material added to the draft. Save the draft to keep this change.');
  };

  const editMaterial = (material: SharedMaterialDraft) => {
    setEditingMaterialId(material.id);
    setMaterialForm({ dayNumber: material.dayNumber, title: material.title, materialType: material.materialType, contentUrl: material.contentUrl || '', contentText: material.contentText || '', contentFormat: material.contentFormat || 'markdown', isRequired: material.isRequired });
  };

  const removeMaterial = (id: string) => {
    if (!detail || detail.status !== 'draft') return;
    setDetail({ ...detail, materials: detail.materials.filter((material) => material.id !== id) });
    if (editingMaterialId === id) { setEditingMaterialId(''); setMaterialForm(newSharedMaterialForm()); }
    setNotice('Material removed from the draft. It will not delete copies already applied to colleges.');
  };

  const toggleAssessment = (id: string, included: boolean) => {
    if (!detail || detail.status !== 'draft') return;
    const selected = new Set(detail.enabledAssessmentIds);
    if (included) selected.add(id); else selected.delete(id);
    setDetail({ ...detail, enabledAssessmentIds: Array.from(selected) });
  };

  const editable = detail?.status === 'draft';
  const applicableWorkspaces = workspaces.filter((workspace) => ['onboarding', 'active'].includes(workspace.lifecycleStatus));
  const rolloutStatus = (status: string) => status === 'current' ? ['Current', 'bg-emerald-100 text-emerald-800'] : status === 'behind' ? ['Behind latest', 'bg-amber-100 text-amber-900'] : status === 'not_applied' ? ['Not applied', 'bg-rose-100 text-rose-800'] : status === 'excluded' ? ['Excluded', 'bg-slate-100 text-slate-600'] : ['No release', 'bg-slate-100 text-slate-600'];

  if (loading && !versions.length) return <FullScreenMessage>Loading shared content library…</FullScreenMessage>;

  return <section className="space-y-5 rounded-2xl bg-white p-5 shadow-sm">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-indigo-600">TalentEdge content</p><h1 className="mt-1 text-2xl font-extrabold">Shared content library</h1><p className="mt-1 text-sm text-slate-500">Manage versioned learning materials and sample assessment sets. Publish a fixed release, then explicitly apply it to each college.</p></div><button disabled={busy || loading} onClick={() => void createDraft()} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"><Plus size={16}/>Create draft version</button></header>
    {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}{notice && <p role="status" className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {!versions.length && !loading ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">The shared content library is not initialized. Run `npm run db:migrate-auth` and reload this page.</p> : <div className="grid gap-5 xl:grid-cols-[270px_minmax(0,1fr)]">
      <aside className="space-y-2"><h2 className="text-sm font-bold">Release history</h2>{versions.map((version) => <button key={version.id} onClick={() => setSelectedVersionId(version.id)} className={`block w-full rounded-xl border p-3 text-left ${selectedVersionId === version.id ? 'border-indigo-300 bg-indigo-50' : 'border-slate-100 bg-white hover:bg-slate-50'}`}><span className="flex items-center justify-between gap-2"><strong className="text-sm">v{version.versionNumber}</strong><span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${version.status === 'published' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{version.status}</span></span><span className="mt-1 block truncate text-xs text-slate-600">{version.title}</span><span className="mt-2 block text-[10px] text-slate-400">{version.materialCount} materials · {version.assessmentCount} tests · applied to {version.appliedWorkspaceCount} colleges</span></button>)}</aside>
      <div className="min-w-0 space-y-5">{loading && <p className="text-xs text-slate-500">Loading version…</p>}{detail && <>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${editable ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>{detail.status}</span><p className="mt-2 text-xs text-slate-500">Version {detail.versionNumber}{detail.publishedAt ? ` · Published ${detail.publishedAt} UTC` : ' · Changes are still draft-only'}</p><input disabled={!editable} value={detail.title} onChange={(event) => setDetail({ ...detail, title: event.target.value })} className={`${inputClass} mt-2 max-w-xl font-semibold disabled:bg-slate-100`}/></div>{editable && <div className="flex gap-2"><button disabled={busy} onClick={() => void saveChanges()} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold disabled:opacity-50">Save draft</button><button disabled={busy} onClick={() => void publish()} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Publish version</button></div>}</div>

        {detail.status === 'published' && <section className="grid gap-3 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 md:grid-cols-[1fr_auto]"><div><h2 className="text-sm font-bold text-emerald-950">Apply this release to a college</h2><p className="mt-1 text-xs text-emerald-900/70">Adds or updates shared items. College-customized items and student progress are preserved.</p><select value={selectedWorkspaceId} onChange={(event) => setSelectedWorkspaceId(event.target.value)} className={`${inputClass} mt-3`}><option value="">Select an onboarding or active college</option>{applicableWorkspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name} · {workspace.lifecycleStatus}</option>)}</select></div><button disabled={busy || !selectedWorkspaceId} onClick={() => void apply()} className="self-end rounded-lg bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">Apply shared content</button></section>}

        <section className="rounded-xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-2"><div><h2 className="font-bold">Shared learning materials</h2><p className="mt-1 text-xs text-slate-500">Create centrally managed Day 1–40 video, PDF, and text lessons.</p></div><span className="text-xs text-slate-500">{detail.materials.length} items</span></div>
          <div className="mt-3 space-y-2">{detail.materials.map((material) => <div key={material.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 p-3"><div className="min-w-0"><strong className="block truncate text-sm">Day {material.dayNumber} · {material.title}</strong><span className="text-[10px] capitalize text-slate-500">{material.materialType} · {material.isRequired ? 'Required' : 'Optional'}</span></div>{editable && <div className="flex gap-2"><button onClick={() => editMaterial(material)} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-[10px] font-bold">Edit</button><button onClick={() => removeMaterial(material.id)} className="rounded-md border border-rose-200 px-2.5 py-1.5 text-[10px] font-bold text-rose-700">Remove</button></div>}</div>)}{detail.materials.length === 0 && <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">No shared learning materials in this version.</p>}</div>
          {editable && <form onSubmit={submitMaterial} className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2"><label className="text-xs font-semibold">Title<input required minLength={2} maxLength={191} value={materialForm.title} onChange={(event) => setMaterialForm({ ...materialForm, title: event.target.value })} className={`${inputClass} mt-1`}/></label><label className="text-xs font-semibold">Curriculum day<input required type="number" min={1} max={40} value={materialForm.dayNumber} onChange={(event) => setMaterialForm({ ...materialForm, dayNumber: Number(event.target.value) })} className={`${inputClass} mt-1`}/></label><label className="text-xs font-semibold">Material type<select value={materialForm.materialType} onChange={(event) => setMaterialForm({ ...materialForm, materialType: event.target.value as SharedMaterialForm['materialType'] })} className={`${inputClass} mt-1`}><option value="text">Text lesson</option><option value="video">Video</option><option value="pdf">PDF</option></select></label><label className="mt-5 flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={materialForm.isRequired} onChange={(event) => setMaterialForm({ ...materialForm, isRequired: event.target.checked })}/>Required for day completion</label>
            {materialForm.materialType === 'text' ? <><label className="text-xs font-semibold">Format<select value={materialForm.contentFormat} onChange={(event) => setMaterialForm({ ...materialForm, contentFormat: event.target.value as SharedMaterialForm['contentFormat'] })} className={`${inputClass} mt-1`}><option value="markdown">Markdown</option><option value="html">HTML</option></select></label><label className="text-xs font-semibold sm:col-span-2">Lesson content<textarea required rows={6} maxLength={50000} value={materialForm.contentText} onChange={(event) => setMaterialForm({ ...materialForm, contentText: event.target.value })} className={`${inputClass} mt-1 font-mono`} placeholder="# Lesson title&#10;&#10;Write the shared lesson…"/></label></> : <label className="text-xs font-semibold sm:col-span-2">Resource URL<input required type="url" value={materialForm.contentUrl} onChange={(event) => setMaterialForm({ ...materialForm, contentUrl: event.target.value })} className={`${inputClass} mt-1`} placeholder="https://…"/></label>}
            <div className="flex gap-2 sm:col-span-2"><button className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white">{editingMaterialId ? 'Update material in draft' : 'Add material to draft'}</button>{editingMaterialId && <button type="button" onClick={() => { setEditingMaterialId(''); setMaterialForm(newSharedMaterialForm()); }} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold">Cancel edit</button>}</div>
          </form>}
        </section>

        <section className="rounded-xl border border-slate-200 p-4"><div><h2 className="font-bold">Sample assessment templates</h2><p className="mt-1 text-xs text-slate-500">This version snapshots the built-in assessment questions. Choose which templates colleges receive when this release is applied.</p></div><div className="mt-3 divide-y divide-slate-100">{detail.assessmentTemplates.map((assessment) => { const included = detail.enabledAssessmentIds.includes(assessment.id); return <label key={assessment.id} className="flex items-start gap-3 py-3"><input disabled={!editable} type="checkbox" checked={included} onChange={(event) => toggleAssessment(assessment.id, event.target.checked)} className="mt-1"/><span className="min-w-0 flex-1"><strong className="block text-sm">{assessment.title}</strong><span className="text-[10px] text-slate-500">Day {assessment.dayNumber} · {assessment.type.replaceAll('_', ' ')} · {assessment.questionCount} questions · {assessment.totalMarks} marks</span></span><span className="text-[10px] font-semibold text-slate-500">{assessment.durationMinutes} min</span></label>; })}{detail.assessmentTemplates.length === 0 && <p className="py-4 text-xs text-slate-500">No assessment templates are in this snapshot.</p>}</div></section>

        <p className="text-[10px] text-slate-400">Applying a release never deletes college materials or assessments. Shared items customized by a college are preserved on later updates; student material progress and assessment submissions remain linked to their original records.</p>
      </>}</div>
    </div>}
    <section className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold">Rollout status by college</h2><p className="mt-1 text-xs text-slate-500">Compared with the latest published release{rollout?.latestPublishedVersionNumber ? ` v${rollout.latestPublishedVersionNumber}` : ''}. Suspended and archived colleges are excluded from coverage counts.</p></div><button disabled={busy} onClick={() => void refreshRollout()} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold disabled:opacity-50">Refresh rollout</button></div>
      {rollout ? <><div className="mt-4 grid gap-3 sm:grid-cols-4"><div className="rounded-lg bg-slate-50 p-3"><span className="text-[10px] font-semibold uppercase text-slate-500">Eligible colleges</span><strong className="mt-1 block text-xl">{rollout.totalEligible}</strong></div><div className="rounded-lg bg-emerald-50 p-3"><span className="text-[10px] font-semibold uppercase text-emerald-700">Current</span><strong className="mt-1 block text-xl text-emerald-800">{rollout.current}</strong></div><div className="rounded-lg bg-amber-50 p-3"><span className="text-[10px] font-semibold uppercase text-amber-700">Behind latest</span><strong className="mt-1 block text-xl text-amber-900">{rollout.behind}</strong></div><div className="rounded-lg bg-rose-50 p-3"><span className="text-[10px] font-semibold uppercase text-rose-700">Not applied</span><strong className="mt-1 block text-xl text-rose-800">{rollout.notApplied}</strong></div></div>
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="text-[10px] uppercase text-slate-500"><tr><th className="py-2 pr-3">College</th><th className="py-2 pr-3">Lifecycle</th><th className="py-2 pr-3">Currently applied</th><th className="py-2 pr-3">Latest published</th><th className="py-2 pr-3">Applied at</th><th className="py-2">Rollout</th></tr></thead><tbody className="divide-y divide-slate-100">{rollout.colleges.map((college) => { const [label, style] = rolloutStatus(college.status); return <tr key={college.workspaceId}><td className="py-3 pr-3 font-semibold text-slate-800">{college.workspaceName}</td><td className="py-3 pr-3 capitalize text-slate-500">{college.lifecycleStatus}</td><td className="py-3 pr-3 text-slate-700">{college.appliedVersionNumber ? `v${college.appliedVersionNumber} · ${college.appliedVersionTitle}` : '—'}</td><td className="py-3 pr-3 text-slate-700">{college.latestPublishedVersionNumber ? `v${college.latestPublishedVersionNumber} · ${college.latestPublishedTitle}` : 'No published release'}</td><td className="py-3 pr-3 text-slate-500">{college.appliedAt ? `${college.appliedAt} UTC` : '—'}</td><td className="py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${style}`}>{label}</span></td></tr>; })}{rollout.colleges.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-slate-500">No college workspaces found.</td></tr>}</tbody></table></div>
      </> : <p className="mt-4 text-xs text-slate-500">Loading rollout status…</p>}
    </section>
    <section className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold">College application history</h2><p className="mt-1 text-xs text-slate-500">Every publish application and rollback is recorded with its actor, reason, timestamp, and change summary.</p></div></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_auto]"><label className="text-[10px] font-semibold text-slate-500">College<select value={historyWorkspaceId} onChange={(event) => setHistoryWorkspaceId(event.target.value)} className={`${inputClass} mt-1 text-xs`}><option value="">All colleges</option>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label><label className="text-[10px] font-semibold text-slate-500">From date<input type="date" value={historyDateFrom} onChange={(event) => setHistoryDateFrom(event.target.value)} className={`${inputClass} mt-1 text-xs`}/></label><label className="text-[10px] font-semibold text-slate-500">To date<input type="date" value={historyDateTo} onChange={(event) => setHistoryDateTo(event.target.value)} className={`${inputClass} mt-1 text-xs`}/></label><button disabled={busy} onClick={() => void refreshApplications().catch((err) => setError(err.message))} className="self-end rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-bold disabled:opacity-50">Apply filters</button></div>
      {applications.length === 0 ? <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">No shared content has been applied yet.</p> : <div className="mt-4 space-y-3">{applications.map((application) => {
        const latestForWorkspace = applications.find((item) => item.workspaceId === application.workspaceId);
        const canRollback = versions.some((version) => version.id === application.versionId && version.status === 'published') && latestForWorkspace?.id !== application.id && application.versionNumber < (latestForWorkspace?.versionNumber || 0);
        return <article key={application.id} className="rounded-lg border border-slate-100 p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-bold">{application.workspaceName} · v{application.versionNumber}: {application.versionTitle}</p><p className="mt-1 text-[11px] text-slate-500">Applied by {application.appliedBy} · {application.appliedAt} UTC</p><p className="mt-2 text-xs text-slate-700"><span className="font-semibold">Reason:</span> {application.reason}</p><p className="mt-1 text-[10px] text-slate-500">Materials: {application.result.materialAdded || 0} added, {application.result.materialUpdated || 0} updated, {application.result.materialPreserved || 0} preserved, {application.result.materialArchived || 0} archived · Assessments: {application.result.assessmentAdded || 0} added, {application.result.assessmentUpdated || 0} updated, {application.result.assessmentPreserved || 0} preserved, {application.result.assessmentArchived || 0} archived</p></div>{canRollback && <button disabled={busy} onClick={() => void rollback(application)} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900 disabled:opacity-50">Roll back to v{application.versionNumber}</button>}</div></article>;
      })}</div>}
    </section>
  </section>;
};

const Metric: React.FC<{ label: string; value: unknown; icon: React.ReactNode }> = ({ label, value, icon }) => <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-4 shadow-sm"><span className="rounded-lg bg-indigo-50 p-2 text-indigo-700">{icon}</span><span><span className="block text-xs text-slate-500">{label}</span><strong className="mt-0.5 block text-lg">{String(value)}</strong></span></div>;
const FullScreenMessage: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-white">{children}</div>;
