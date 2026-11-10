import React, { FormEvent, useEffect, useState } from 'react';
import { GraduationCap, LockKeyhole, LoaderCircle, ShieldCheck } from 'lucide-react';
import { acceptInvitation, bootstrapCollege, getBootstrapStatus, registerWorkspace, resetPassword, signIn } from '../services/auth';

interface AuthScreenProps {
  onAuthenticated: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthenticated }) => {
  const inviteToken = new URLSearchParams(window.location.search).get('invite');
  const resetToken = new URLSearchParams(window.location.search).get('reset');
  const [bootstrapEnabled, setBootstrapEnabled] = useState(false);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [mode, setMode] = useState<'login' | 'bootstrap' | 'register' | 'invite' | 'reset'>(resetToken ? 'reset' : inviteToken ? 'invite' : 'login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getBootstrapStatus()
      .then((status) => {
        setBootstrapEnabled(status.enabled);
        setRegistrationEnabled(status.registrationEnabled);
        setWorkspaceName(status.workspaceName);
      })
      .catch(() => setBootstrapEnabled(false));
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      if (mode === 'bootstrap') {
        await bootstrapCollege({ bootstrapToken: setupToken, workspaceName, name, email, password });
      } else if (mode === 'register') {
        await registerWorkspace({ workspaceName, name, email, password });
      } else if (mode === 'invite' && inviteToken) {
        await acceptInvitation({ token: inviteToken, name, password });
        window.history.replaceState({}, '', window.location.pathname);
      } else if (mode === 'reset' && resetToken) {
        await resetPassword(resetToken, password);
        window.history.replaceState({}, '', window.location.pathname);
        setMode('login');
        setPassword('');
        setNotice('Password updated. Sign in with your new password.');
        return;
      } else {
        await signIn(email, password);
      }
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10';

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 flex items-center justify-center">
      <section className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
        <div className="bg-slate-950 px-8 py-8 text-white">
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500">
            <GraduationCap className="h-6 w-6" />
          </div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-300">TalentEdge</p>
          <h1 className="mt-2 text-2xl font-bold">
            {mode === 'bootstrap' || mode === 'register' ? 'Set up your college' : mode === 'invite' ? 'Join your workspace' : mode === 'reset' ? 'Reset your password' : 'Welcome back'}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
            {mode === 'bootstrap' || mode === 'register'
              ? 'Create a college workspace and its first administrator account.'
              : mode === 'invite'
              ? 'Create your account to accept the college workspace invitation.'
              : mode === 'reset'
              ? 'Choose a new password. This link can be used once and expires after one hour.'
              : 'Sign in with your college workspace account to continue.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-8">
          {(mode === 'bootstrap' || mode === 'register') && (
            <>
              <label className="block space-y-1.5"><span className="text-xs font-semibold text-slate-600">College or workspace name</span><input required minLength={2} maxLength={191} className={inputClass} value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} /></label>
              {mode === 'bootstrap' && <label className="block space-y-1.5"><span className="text-xs font-semibold text-slate-600">Setup token</span><input required type="password" autoComplete="off" className={inputClass} value={setupToken} onChange={(e) => setSetupToken(e.target.value)} /></label>}
            </>
          )}
          {(mode === 'bootstrap' || mode === 'register' || mode === 'invite') && <label className="block space-y-1.5"><span className="text-xs font-semibold text-slate-600">Full name</span><input required minLength={2} autoComplete="name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></label>}
          {(mode === 'login' || mode === 'bootstrap' || mode === 'register') && <label className="block space-y-1.5"><span className="text-xs font-semibold text-slate-600">Email address</span><input required type="email" autoComplete="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} /></label>}
          <label className="block space-y-1.5"><span className="text-xs font-semibold text-slate-600">Password</span><input required type="password" minLength={12} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} /><span className="block text-[11px] text-slate-400">Use at least 12 characters.</span></label>
          {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">{notice}</p>}
          {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</p>}
          <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-70">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : mode === 'login' ? <LockKeyhole className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
            {busy ? 'Please wait…' : mode === 'bootstrap' || mode === 'register' ? 'Create college administrator' : mode === 'invite' ? 'Accept invitation' : mode === 'reset' ? 'Update password' : 'Sign in'}
          </button>
          {mode === 'login' && bootstrapEnabled && <button type="button" onClick={() => setMode('bootstrap')} className="w-full py-1 text-xs font-semibold text-indigo-700 hover:text-indigo-900">Set up the first college administrator</button>}
          {mode === 'login' && registrationEnabled && <button type="button" onClick={() => { setWorkspaceName(''); setMode('register'); }} className="w-full py-1 text-xs font-semibold text-indigo-700 hover:text-indigo-900">Create a college workspace</button>}
          {(mode === 'bootstrap' || mode === 'register') && <button type="button" onClick={() => setMode('login')} className="w-full py-1 text-xs font-semibold text-slate-500 hover:text-slate-800">Back to sign in</button>}
        </form>
        <div className="border-t border-slate-100 px-8 py-4 text-center text-[11px] text-slate-400">Your college workspace keeps its users and learning data separated.</div>
      </section>
    </main>
  );
};
