import React, { FormEvent, useEffect, useState } from 'react';
import { Clock3, LoaderCircle, Save, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { WorkspaceSettings } from '../types/auth';
import { saveWorkspaceSettings } from '../services/auth';

interface Props {
  settings: WorkspaceSettings;
  onSaved: (settings: WorkspaceSettings) => void;
}

export const SystemSettings: React.FC<Props> = ({ settings, onSaved }) => {
  const [atRiskBelow, setAtRiskBelow] = useState(settings.atRiskBelow);
  const [tierOneAtOrAbove, setTierOneAtOrAbove] = useState(settings.tierOneAtOrAbove);
  const [defaultInterviewDurationMinutes, setDefaultInterviewDurationMinutes] = useState(settings.defaultInterviewDurationMinutes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setAtRiskBelow(settings.atRiskBelow);
    setTierOneAtOrAbove(settings.tierOneAtOrAbove);
    setDefaultInterviewDurationMinutes(settings.defaultInterviewDurationMinutes);
  }, [settings]);

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await saveWorkspaceSettings({ atRiskBelow, tierOneAtOrAbove, defaultInterviewDurationMinutes });
      onSaved(result.settings);
      setNotice('Workspace settings saved. Dashboard readiness groups now use these thresholds.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save workspace settings.');
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-950 dark:text-white';

  return (
    <div className="mx-auto max-w-4xl space-y-6 animate-fadeIn">
      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900"><div className="flex items-start gap-3"><span className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300"><SlidersHorizontal className="h-5 w-5" /></span><div><p className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">College workspace</p><h1 className="mt-1 text-2xl font-extrabold text-slate-900 dark:text-white">System Settings</h1><p className="mt-1 text-sm text-slate-500">Set readiness thresholds and defaults used across this workspace.</p></div></div></header>

      <form onSubmit={(event) => void handleSave(event)} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-100 p-5 dark:border-slate-800"><h2 className="font-bold text-slate-900 dark:text-white">Readiness classification</h2><p className="mt-1 text-xs text-slate-500">These thresholds drive the admin dashboard’s at-risk and Tier 1 counts.</p></div>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <label className="space-y-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">At risk below (%)<input className={inputClass} type="number" min={0} max={99} value={atRiskBelow} onChange={(event) => setAtRiskBelow(Number(event.target.value))} required /><span className="block text-[11px] font-normal text-slate-500">Students below this score appear in the at-risk queue.</span></label>
          <label className="space-y-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">Tier 1 ready at or above (%)<input className={inputClass} type="number" min={1} max={100} value={tierOneAtOrAbove} onChange={(event) => setTierOneAtOrAbove(Number(event.target.value))} required /><span className="block text-[11px] font-normal text-slate-500">Must be greater than the at-risk threshold.</span></label>
          <div className="sm:col-span-2 rounded-xl bg-slate-50 p-4 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300"><ShieldCheck className="mr-1.5 inline h-4 w-4 text-indigo-600" />Tier 2 includes scores from {atRiskBelow}% up to {Math.max(atRiskBelow, tierOneAtOrAbove - 1)}%.</div>
        </div>

        <div className="border-y border-slate-100 p-5 dark:border-slate-800"><h2 className="font-bold text-slate-900 dark:text-white">Interview scheduling default</h2><p className="mt-1 text-xs text-slate-500">Used to prefill new mock interview appointments. The administrator can adjust each appointment.</p></div>
        <div className="p-5"><label className="block max-w-sm space-y-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">Default interview duration (minutes)<span className="relative block"><Clock3 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className={`${inputClass} pl-9`} type="number" min={15} max={180} step={15} value={defaultInterviewDurationMinutes} onChange={(event) => setDefaultInterviewDurationMinutes(Number(event.target.value))} required /></span><span className="block text-[11px] font-normal text-slate-500">Allowed range: 15–180 minutes.</span></label></div>
        {(error || notice) && <div className="px-5 pb-4">{error && <p role="alert" className="text-sm text-rose-600">{error}</p>}{notice && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{notice}</p>}</div>}
        <div className="flex justify-end border-t border-slate-100 p-5 dark:border-slate-800"><button disabled={saving || atRiskBelow >= tierOneAtOrAbove} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">{saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? 'Saving…' : 'Save settings'}</button></div>
      </form>
    </div>
  );
};
