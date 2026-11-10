import React, { useEffect, useState } from 'react';
import {
  Trophy,
  Medal,
  Award,
  Sparkles,
  Code2,
  Brain,
  MessageSquare,
  TrendingUp,
} from 'lucide-react';
import { LeaderboardEntry } from '../types';
import { fetchWorkspaceLeaderboard } from '../services/api';

export const LeaderboardView: React.FC = () => {
  const [filterCategory, setFilterCategory] = useState<'overall' | 'coding' | 'aptitude' | 'communication'>('overall');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWorkspaceLeaderboard()
      .then(setEntries)
      .catch((error) => console.error('Failed to load workspace leaderboard:', error))
      .finally(() => setLoading(false));
  }, []);

  const sortedEntries = [...entries].sort((a, b) => {
    if (filterCategory === 'coding') return b.codingScore - a.codingScore;
    if (filterCategory === 'aptitude') return b.aptitudeScore - a.aptitudeScore;
    if (filterCategory === 'communication') return b.communicationScore - a.communicationScore;
    return b.score - a.score;
  });

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-xs font-bold mb-2">
            <Trophy className="w-3.5 h-3.5" />
            <span>Bootcamp Hall of Fame</span>
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Cohort Leaderboard & Top Performers
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Real-time rankings based on milestone assessments, coding benchmark submissions, and mock interview performances.
          </p>
        </div>

        {/* Category Filter Pills */}
        <div className="flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
          {[
            { id: 'overall', label: 'Overall', icon: Trophy },
            { id: 'coding', label: 'Coding', icon: Code2 },
            { id: 'aptitude', label: 'Aptitude', icon: Brain },
            { id: 'communication', label: 'Communication', icon: MessageSquare },
          ].map((cat) => {
            const Icon = cat.icon;
            return (
              <button
                key={cat.id}
                onClick={() => setFilterCategory(cat.id as any)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  filterCategory === cat.id
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{cat.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Top 3 Podium Cards */}
      {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">Loading workspace rankings…</div> : sortedEntries.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">No ranked students are available in this workspace or batch yet.</div> : <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {sortedEntries.slice(0, 3).map((entry, idx) => {
          const isFirst = idx === 0;
          return (
            <div
              key={entry.studentId}
              className={`p-6 rounded-3xl border relative overflow-hidden flex flex-col justify-between ${
                isFirst
                  ? 'bg-gradient-to-b from-amber-50 to-white dark:from-amber-950/30 dark:to-slate-900 border-amber-300 dark:border-amber-800 shadow-lg'
                  : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 shadow-xs'
              }`}
            >
              <div className="flex items-center justify-between mb-4">
                <div
                  className={`w-10 h-10 rounded-2xl flex items-center justify-center font-black text-sm shadow-md ${
                    idx === 0
                      ? 'bg-amber-400 text-amber-950'
                      : idx === 1
                      ? 'bg-slate-300 text-slate-900'
                      : 'bg-amber-700 text-white'
                  }`}
                >
                  #{idx + 1}
                </div>
                <div className="flex items-center gap-1">
                  {entry.badges.map((b, bIdx) => (
                    <span
                      key={bIdx}
                      className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900/60"
                    >
                      {b}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3 mb-4">
                <img
                  src={entry.avatar}
                  alt={entry.studentName}
                  className="w-14 h-14 rounded-2xl object-cover border-2 border-white dark:border-slate-800 shadow-md"
                />
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                    {entry.studentName}
                  </h3>
                  <p className="text-xs text-slate-500">{entry.rollNo}</p>
                  <p className="text-[11px] text-indigo-600 font-semibold">{entry.batch}</p>
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between text-xs">
                <span className="text-slate-500">Mastery Score:</span>
                <span className="text-lg font-black text-indigo-600 dark:text-indigo-400">
                  {filterCategory === 'coding'
                    ? `${entry.codingScore}%`
                    : filterCategory === 'aptitude'
                    ? `${entry.aptitudeScore}%`
                    : filterCategory === 'communication'
                    ? `${entry.communicationScore}%`
                    : `${entry.score}%`}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      </>}

      {/* Full Leaderboard Table */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs">
        <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">
          All Cohort Standings
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-bold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">Rank</th>
                <th className="py-3 px-4">Candidate</th>
                <th className="py-3 px-4">Roll No</th>
                <th className="py-3 px-4">Batch</th>
                <th className="py-3 px-4">Coding Score</th>
                <th className="py-3 px-4">Aptitude Score</th>
                <th className="py-3 px-4">Communication</th>
                <th className="py-3 px-4">Overall Score</th>
                <th className="py-3 px-4">Badges</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {sortedEntries.map((entry, idx) => (
                <tr
                  key={entry.studentId}
                  className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <td className="py-3 px-4 font-extrabold text-slate-900 dark:text-white">
                    <span
                      className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                        idx === 0
                          ? 'bg-amber-100 text-amber-800'
                          : idx === 1
                          ? 'bg-slate-200 text-slate-800'
                          : idx === 2
                          ? 'bg-amber-900/20 text-amber-700'
                          : 'text-slate-500'
                      }`}
                    >
                      {idx + 1}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      <img
                        src={entry.avatar}
                        alt={entry.studentName}
                        className="w-8 h-8 rounded-full object-cover border border-slate-200"
                      />
                      <span className="font-bold text-slate-900 dark:text-white">
                        {entry.studentName}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-500">{entry.rollNo}</td>
                  <td className="py-3 px-4 font-semibold text-slate-700 dark:text-slate-300">
                    {entry.batch}
                  </td>
                  <td className="py-3 px-4 font-extrabold text-indigo-600 dark:text-indigo-400">
                    {entry.codingScore}%
                  </td>
                  <td className="py-3 px-4 font-extrabold text-blue-600 dark:text-blue-400">
                    {entry.aptitudeScore}%
                  </td>
                  <td className="py-3 px-4 font-extrabold text-amber-600 dark:text-amber-400">
                    {entry.communicationScore}%
                  </td>
                  <td className="py-3 px-4 font-black text-emerald-600 dark:text-emerald-400 text-sm">
                    {entry.score}%
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex flex-wrap gap-1">
                      {entry.badges.map((b, bIdx) => (
                        <span
                          key={bIdx}
                          className="text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold"
                        >
                          {b}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
