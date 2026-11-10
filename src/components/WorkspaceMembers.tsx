import React, { FormEvent, useEffect, useState } from 'react';
import { Building2, Clipboard, KeyRound, LoaderCircle, MailPlus, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { AuthenticatedSession, WorkspaceAuditEvent, WorkspaceMember } from '../types/auth';
import { createWorkspacePasswordReset, getWorkspaceAudit, getWorkspaceMembers, inviteWorkspaceMember, setWorkspaceMemberStatus } from '../services/auth';
import { fetchBatches } from '../services/api';

interface WorkspaceMembersProps {
  session: AuthenticatedSession;
}

const roleLabels: Record<WorkspaceMember['role'], string> = {
  college_admin: 'College administrator',
  trainer: 'Trainer',
  student: 'Student',
};

export const WorkspaceMembers: React.FC<WorkspaceMembersProps> = ({ session }) => {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [auditEvents, setAuditEvents] = useState<WorkspaceAuditEvent[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceMember['role']>('student');
  const [batchId, setBatchId] = useState('');
  const [batches, setBatches] = useState<Array<{ id: string; name: string }>>([]);
  const [inviteUrl, setInviteUrl] = useState('');
  const [resetUrl, setResetUrl] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const isAdmin = session.role === 'college_admin';

  const loadMembers = async () => {
    setError('');
    try {
      const [nextMembers, nextAudit, batchList] = await Promise.all([getWorkspaceMembers(), getWorkspaceAudit(), fetchBatches()]);
      setMembers(nextMembers);
      setAuditEvents(nextAudit);
      setBatches(batchList.filter((batch: any) => !batch.isArchived).map((batch: any) => ({ id: batch.id, name: batch.name })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load members.');
    } finally {
      setLoading(false);
    }
  };

  const changeMemberStatus = async (member: WorkspaceMember) => {
    const status = member.status === 'active' ? 'inactive' : 'active';
    setError('');
    try {
      await setWorkspaceMemberStatus(member.id, status);
      await loadMembers();
      setNotice(`${member.name} was ${status === 'active' ? 'reactivated' : 'deactivated'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update member access.');
    }
  };

  const createResetLink = async (member: WorkspaceMember) => {
    setError('');
    try {
      const result = await createWorkspacePasswordReset(member.id);
      setResetUrl(`${window.location.origin}${result.resetPath}`);
      setNotice(`Password reset link created for ${member.name}. It expires in one hour.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create a reset link.');
    }
  };

  useEffect(() => { void loadMembers(); }, [session.workspace.id]);

  const handleInvite = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await inviteWorkspaceMember(email, role, role === 'student' ? batchId || undefined : undefined);
      const url = `${window.location.origin}${result.invitePath}`;
      setInviteUrl(url);
      setEmail('');
      setBatchId('');
      setNotice(`Invitation created. The link expires in ${result.expiresInDays} days.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create invitation.');
    } finally {
      setBusy(false);
    }
  };

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setNotice('Invitation link copied. Send it to the invited person.');
    } catch {
      setNotice('Copy the invitation link from the field below and send it to the invited person.');
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 animate-fadeIn">
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-8">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-indigo-50 p-3 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300"><Building2 className="h-6 w-6" /></div>
          <div><p className="text-xs font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-300">College workspace</p><h1 className="mt-1 text-2xl font-extrabold text-slate-900 dark:text-white">{session.workspace.name}</h1><p className="mt-2 max-w-2xl text-sm text-slate-500">Manage access for this college. Members and their learning data are scoped to this workspace.</p></div>
        </div>
      </header>

      {isAdmin && <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-5 flex items-center gap-3"><div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300"><MailPlus className="h-5 w-5" /></div><div><h2 className="font-bold text-slate-900 dark:text-white">Invite a member</h2><p className="text-xs text-slate-500">Create a one-time link that expires after 7 days.</p></div></div>
        <form onSubmit={handleInvite} className="grid gap-3 sm:grid-cols-[1fr_190px_1fr_auto]">
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="person@college.edu" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-950" />
          <select value={role} onChange={(e) => setRole(e.target.value as WorkspaceMember['role'])} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"><option value="student">Student</option><option value="trainer">Trainer</option><option value="college_admin">College administrator</option></select>
          {role === 'student' ? <select value={batchId} onChange={(e) => setBatchId(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"><option value="">No batch yet</option>{batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.name}</option>)}</select> : <span />}
          <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <MailPlus className="h-4 w-4" />}Create invite</button>
        </form>
        {inviteUrl && <div className="mt-4 flex flex-col gap-2 sm:flex-row"><input readOnly value={inviteUrl} className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300" /><button onClick={copyInvite} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold dark:border-slate-700"><Clipboard className="h-4 w-4" />Copy link</button></div>}
        <p className="mt-3 text-[11px] text-slate-400">Email delivery is not configured yet. Copy and send the link through your usual channel.</p>
      </section>}

      {resetUrl && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/30"><p className="mb-2 text-xs font-bold text-amber-900 dark:text-amber-200">One-time password reset link</p><div className="flex flex-col gap-2 sm:flex-row"><input readOnly value={resetUrl} className="min-w-0 flex-1 rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs text-slate-600 dark:border-amber-900 dark:bg-slate-950 dark:text-slate-300" /><button onClick={async () => { await navigator.clipboard.writeText(resetUrl).catch(() => undefined); setNotice('Password reset link copied.'); }} className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300 px-4 py-2 text-xs font-bold text-amber-900 dark:border-amber-800 dark:text-amber-200"><Clipboard className="h-4 w-4" />Copy link</button></div><p className="mt-2 text-[11px] text-amber-800 dark:text-amber-300">Send this link to the account owner through a verified channel. Email delivery is not configured.</p></section>}

      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">{notice}</p>}
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800"><div className="flex items-center gap-2"><Users className="h-5 w-5 text-indigo-500" /><h2 className="font-bold text-slate-900 dark:text-white">Workspace members</h2><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{members.length}</span></div><button onClick={() => { setLoading(true); void loadMembers(); }} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title="Refresh members"><RefreshCw className="h-4 w-4" /></button></div>
        {loading ? <div className="p-8 text-center text-sm text-slate-500">Loading workspace members…</div> : members.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">No members are enrolled yet.</div> : <div className="divide-y divide-slate-100 dark:divide-slate-800">{members.map((member) => <div key={member.id} className="flex items-center justify-between gap-4 px-5 py-4"><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900 dark:text-white">{member.name}</p><p className="truncate text-xs text-slate-500">{member.email}</p></div><div className="flex shrink-0 items-center gap-2"><span className="hidden rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 sm:inline">{roleLabels[member.role]}</span><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${member.status === 'active' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>{member.status}</span>{member.id !== session.user.id && isAdmin && member.status === 'active' && <button onClick={() => void createResetLink(member)} className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:border-amber-300 hover:text-amber-700 dark:border-slate-700" title="Create password reset link"><KeyRound className="h-3.5 w-3.5" /></button>}{member.id !== session.user.id && <button onClick={() => void changeMemberStatus(member)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-[10px] font-bold text-slate-600 hover:border-rose-200 hover:text-rose-600 dark:border-slate-700 dark:text-slate-300">{member.status === 'active' ? 'Deactivate' : 'Reactivate'}</button>}</div></div>)}</div>}
      </section>
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-100 p-5 dark:border-slate-800"><h2 className="font-bold text-slate-900 dark:text-white">Recent access activity</h2><p className="mt-1 text-xs text-slate-500">Invitation and membership changes for this workspace.</p></div>
        {auditEvents.length === 0 ? <p className="p-5 text-sm text-slate-500">No workspace activity recorded yet.</p> : <div className="divide-y divide-slate-100 dark:divide-slate-800">{auditEvents.map((event) => <div key={event.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"><div><p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{event.action.replaceAll('.', ' ')}</p><p className="text-[11px] text-slate-500">{event.actorName || 'Workspace member'}{event.details.email ? ` • ${String(event.details.email)}` : ''}</p></div><time className="text-[10px] text-slate-400">{new Date(event.createdAt).toLocaleString()}</time></div>)}</div>}
      </section>
      <p className="flex items-center gap-2 text-xs text-slate-400"><ShieldCheck className="h-4 w-4" />Roles and access are applied by the server for this college workspace.</p>
    </div>
  );
};
