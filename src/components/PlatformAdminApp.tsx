import React, { FormEvent, useEffect, useState } from 'react';
import { Activity, ArrowLeft, Building2, CheckCircle2, Copy, CreditCard, LoaderCircle, LogOut, Plus, Search, Shield, ShieldCheck, Users } from 'lucide-react';
import { acceptCollegeAdminInvite, acceptPlatformAdminInvite, completePlatformMfaReset, createPlatformAdminInvitation, createPlatformWorkspace, getCollegeAdminInvite, getPlatformAdminInvite, getPlatformAdmins, getPlatformMfaReset, getPlatformOverview, getPlatformSession, getPlatformWorkspace, getPlatformWorkspaces, inviteWorkspaceAdmin, platformLogin, platformLogout, requestPlatformMfaReset, setPlatformAdminStatus, setPlatformWorkspaceStatus } from '../services/platformAdmin';
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
  const [activePage, setActivePage] = useState<'overview' | 'workspaces' | 'admins'>('overview');
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

  const createWorkspace = async (data: { name: string; adminName: string; adminEmail: string }) => {
    setBusy(true); setError(''); setNotice(''); setInviteLink('');
    try { const created = await createPlatformWorkspace(data); setInviteLink(created.inviteUrl); setNotice('Workspace created in onboarding. Copy the first administrator invitation link and send it through your approved channel.'); await loadConsole(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not create workspace.'); }
    finally { setBusy(false); }
  };

  const inviteAdmin = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setInviteLink('');
    try { const result = await createPlatformAdminInvitation(platformAdminEmail); setInviteLink(result.inviteUrl); setNotice('Invitation created. Deliver the link out of band; email delivery is not configured.'); setPlatformAdminEmail(''); }
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
    try { const result = await inviteWorkspaceAdmin(id, address); setInviteLink(result.inviteUrl); setNotice(`College administrator invitation created for ${address}. Deliver it out of band.`); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not create college administrator invitation.'); }
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
      <aside className="flex gap-2 overflow-x-auto lg:block lg:space-y-1">{([['overview','Overview'],['workspaces','Colleges'],['admins','Platform admins']] as const).map(([key,label]) => <button key={key} onClick={() => { setActivePage(key); setWorkspaceDetail(null); setNotice(''); }} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-left text-sm font-semibold lg:w-full ${activePage === key ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-indigo-50'}`}>{label}</button>)}</aside>
      <main className="min-w-0 space-y-5">
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}<button className="ml-3 font-bold" onClick={() => setError('')}>Dismiss</button></p>}
        {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}
        {inviteLink && <div className="flex flex-col gap-2 rounded-xl border border-indigo-200 bg-white p-4 sm:flex-row sm:items-center"><input readOnly value={inviteLink} className={`${inputClass} min-w-0 flex-1 text-xs`}/><button onClick={() => navigator.clipboard.writeText(inviteLink).then(() => setNotice('Invitation link copied.'))} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white"><Copy size={14}/>Copy invite link</button></div>}
        {workspaceDetail ? <WorkspaceDetail detail={workspaceDetail} onBack={() => setWorkspaceDetail(null)} onStatus={changeWorkspaceStatus} onInviteAdmin={inviteWorkspaceAdminLink}/> : activePage === 'overview' ? <>
          <div><p className="text-xs font-bold uppercase tracking-widest text-indigo-600">Platform overview</p><h1 className="mt-1 text-2xl font-extrabold">College workspaces</h1><p className="mt-1 text-sm text-slate-500">Operational overview across all colleges. Student-level records are not exposed here.</p></div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[['Total colleges',overview?.totalWorkspaces],['Active',overview?.activeWorkspaces],['Onboarding',overview?.onboardingWorkspaces],['Suspended',overview?.suspendedWorkspaces]].map(([label,value]) => <Metric key={String(label)} label={String(label)} value={value ?? '…'} icon={<Building2 size={18}/>}/>)}<Metric label="Archived" value={overview?.archivedWorkspaces ?? '…'} icon={<Building2 size={18}/>}/><Metric label="Created in last 30 days" value={overview?.createdLast30Days ?? '…'} icon={<Activity size={18}/>}/><Metric label="Active students across colleges" value={overview?.activeStudents ?? '…'} icon={<Users size={18}/>}/></div>
          <section className="rounded-2xl bg-white p-5 shadow-sm"><h2 className="font-bold">Subscription states</h2><div className="mt-3 flex flex-wrap gap-2">{overview?.subscriptions?.map((item: any) => <span key={item.status} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">{item.status.replaceAll('_',' ')} · {item.count}</span>)}</div><p className="mt-3 text-xs text-slate-500">Plans and payment processing remain read-only until commercial terms and a billing provider are approved.</p></section>
          <WorkspaceDirectory rows={workspaces.slice(0, 8)} query={workspaceQuery} setQuery={setWorkspaceQuery} status={workspaceStatus} setStatus={setWorkspaceStatus} onOpen={openWorkspace} onCreate={createWorkspace} busy={busy}/>
        </> : activePage === 'workspaces' ? <WorkspaceDirectory rows={workspaces} query={workspaceQuery} setQuery={setWorkspaceQuery} status={workspaceStatus} setStatus={setWorkspaceStatus} onOpen={openWorkspace} onCreate={createWorkspace} busy={busy}/> : <section className="space-y-5 rounded-2xl bg-white p-5 shadow-sm"><div><p className="text-xs font-bold uppercase tracking-widest text-indigo-600">Access control</p><h1 className="mt-1 text-2xl font-extrabold">Platform administrators</h1><p className="mt-1 text-sm text-slate-500">Invite-only access. Accounts require a password and an authenticator code.</p></div><form onSubmit={(event) => void inviteAdmin(event)} className="flex flex-col gap-2 sm:flex-row"><input required type="email" value={platformAdminEmail} onChange={(event) => setPlatformAdminEmail(event.target.value)} placeholder="New platform admin email" className={`${inputClass} flex-1`}/><button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white"><Plus size={16}/>Create invite</button></form><AdminTable rows={admins} onToggle={toggleAdmin} onResetMfa={resetAdminMfa}/></section>}
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
    <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr>{['College','State','Plan','Subscription','Students','Staff','Created'].map((item) => <th key={item} className="px-3 py-3">{item}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={row.id} onClick={() => onOpen(row.id)} className="cursor-pointer hover:bg-indigo-50/50"><td className="px-3 py-3"><strong className="block">{row.name}</strong><span className="text-[10px] text-slate-500">{row.slug}</span></td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${statusStyles[row.lifecycleStatus]}`}>{statusLabels[row.lifecycleStatus]}</span></td><td className="px-3 py-3">{planLabels[row.planId] || row.planId}</td><td className="px-3 py-3">{row.subscriptionStatus?.replaceAll('_',' ')}</td><td className="px-3 py-3">{row.activeStudents}</td><td className="px-3 py-3">{row.staffCount}</td><td className="px-3 py-3">{row.createdAt}</td></tr>)}{rows.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-slate-500">No workspaces match this filter.</td></tr>}</tbody></table></div>
  </section>;
};

const WorkspaceDetail: React.FC<{ detail: any; onBack: () => void; onStatus: (status: string) => void; onInviteAdmin: (id: string, email: string) => void }> = ({ detail, onBack, onStatus, onInviteAdmin }) => {
  const [adminEmail, setAdminEmail] = useState('');
  return <section className="space-y-5 rounded-2xl bg-white p-5 shadow-sm"><button onClick={onBack} className="inline-flex items-center gap-1 text-xs font-bold text-indigo-700"><ArrowLeft size={14}/>All colleges</button><header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-indigo-600">Workspace details</p><h1 className="mt-1 text-2xl font-extrabold">{detail.name}</h1><p className="mt-1 text-xs text-slate-500">{detail.slug} · Created {detail.createdAt}</p></div><span className={`rounded-full px-3 py-1.5 text-xs font-bold ${statusStyles[detail.lifecycleStatus]}`}>{statusLabels[detail.lifecycleStatus]}</span></header><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Active students" value={detail.activeStudents} icon={<Users size={17}/>}/><Metric label="Staff seats" value={detail.staffCount} icon={<Shield size={17}/>}/><Metric label="Active batches" value={detail.activeBatches} icon={<Building2 size={17}/>}/><Metric label="Plan / subscription" value={`${planLabels[detail.planId] || detail.planId} · ${detail.subscriptionStatus || 'unconfigured'}`} icon={<CreditCard size={17}/>}/></div><section className="rounded-xl border border-slate-200 p-4"><h2 className="font-bold">Workspace access lifecycle</h2><p className="mt-1 text-xs text-slate-500">Suspended and archived workspaces cannot sign in. These actions revoke existing college sessions and are reversible.</p><p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">Current reason: {detail.statusReason || 'No status reason recorded.'}</p><div className="mt-3 flex flex-wrap gap-2">{Object.keys(statusLabels).filter((status) => status !== detail.lifecycleStatus).map((status) => <button key={status} onClick={() => onStatus(status)} className={`rounded-lg px-3 py-2 text-xs font-bold ${statusStyles[status]}`}>Set {statusLabels[status]}</button>)}</div></section><section className="rounded-xl border border-slate-200 p-4"><h2 className="font-bold">College administrators</h2><div className="mt-3 divide-y divide-slate-100">{detail.collegeAdmins.map((contact: any) => <div key={contact.email} className="flex justify-between gap-3 py-2 text-sm"><span>{contact.name}<span className="ml-2 text-xs text-slate-500">{contact.email}</span></span><span className="text-xs capitalize text-slate-500">{contact.status}</span></div>)}{detail.collegeAdmins.length === 0 && <p className="py-3 text-sm text-slate-500">Initial administrator has not accepted the invitation yet.</p>}</div><form onSubmit={(event) => { event.preventDefault(); onInviteAdmin(detail.id, adminEmail); }} className="mt-4 flex flex-col gap-2 sm:flex-row"><input required type="email" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} placeholder="College administrator email" className={`${inputClass} flex-1`}/><button disabled={['suspended','archived'].includes(detail.lifecycleStatus)} className="rounded-lg border border-indigo-200 px-3 py-2 text-xs font-bold text-indigo-700 disabled:opacity-50">Create / resend invite</button></form><p className="mt-2 text-[10px] text-slate-400">Invitation links expire after 72 hours. Deliver them through an approved channel; email is not configured.</p></section><section className="rounded-xl border border-slate-200 p-4"><h2 className="flex items-center gap-2 font-bold"><Activity size={16}/>Recent platform activity</h2><div className="mt-3 divide-y divide-slate-100">{detail.recentPlatformActivity.map((item: any, index: number) => <div key={`${item.createdAt}-${index}`} className="py-2 text-xs"><strong>{item.action.replaceAll('.',' ')}</strong><span className="ml-2 text-slate-500">{item.createdAt}</span><p className="mt-1 text-slate-500">{item.reason || '—'}</p></div>)}</div></section></section>;
};

const AdminTable: React.FC<{ rows: Array<{ id: string; name: string; email: string; isActive: boolean; lastLoginAt: string | null; createdAt: string }>; onToggle: (admin: { id: string; isActive: boolean }) => void; onResetMfa: (admin: { id: string; email: string }) => void }> = ({ rows, onToggle, onResetMfa }) => <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr>{['Administrator','Status','Last sign in','Access','MFA'].map((text) => <th key={text} className="px-3 py-3">{text}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map((admin) => <tr key={admin.id}><td className="px-3 py-3"><strong className="block">{admin.name}</strong><span className="text-xs text-slate-500">{admin.email}</span></td><td className="px-3 py-3">{admin.isActive ? 'Active' : 'Inactive'}</td><td className="px-3 py-3">{admin.lastLoginAt || 'Never'}</td><td className="px-3 py-3"><button onClick={() => onToggle(admin)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold">{admin.isActive ? 'Deactivate' : 'Activate'}</button></td><td className="px-3 py-3"><button disabled={!admin.isActive} onClick={() => onResetMfa(admin)} className="rounded-lg border border-amber-200 px-2.5 py-1.5 text-xs font-semibold text-amber-800 disabled:opacity-40">Reset MFA</button></td></tr>)}</tbody></table></div>;

const Metric: React.FC<{ label: string; value: unknown; icon: React.ReactNode }> = ({ label, value, icon }) => <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-4 shadow-sm"><span className="rounded-lg bg-indigo-50 p-2 text-indigo-700">{icon}</span><span><span className="block text-xs text-slate-500">{label}</span><strong className="mt-0.5 block text-lg">{String(value)}</strong></span></div>;
const FullScreenMessage: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-white">{children}</div>;
