import React, { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  BarChart3,
  TrendingUp,
  Award,
  Brain,
  Code2,
  LoaderCircle,
} from 'lucide-react';
import { fetchAnalyticsDashboard, AnalyticsDashboardData } from '../services/api';
import { StudentProfile } from '../types';

interface AnalyticsDashboardProps {
  student: StudentProfile;
}

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({ student }) => {
  const [analytics, setAnalytics] = useState<AnalyticsDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!student.id) { setAnalytics(null); setLoading(false); return; }
    let active = true;
    setLoading(true);
    setError('');
    fetchAnalyticsDashboard(student.id)
      .then((result) => { if (active) setAnalytics(result); })
      .catch((cause) => { if (active) { setAnalytics(null); setError(cause instanceof Error ? cause.message : 'Could not load analytics.'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [student.id]);

  const skillRadar = useMemo(() => analytics ? [
    { subject: 'Coding DSA', student: analytics.metrics.coding, fullMark: 100 },
    { subject: 'Aptitude', student: analytics.metrics.aptitude, fullMark: 100 },
    { subject: 'Reasoning', student: analytics.metrics.reasoning, fullMark: 100 },
    { subject: 'SQL / DB', student: analytics.metrics.sql, fullMark: 100 },
    { subject: 'CS Core', student: analytics.metrics.csFundamentals, fullMark: 100 },
    { subject: 'Verbal', student: analytics.metrics.communication, fullMark: 100 },
    { subject: 'Tech Interview', student: analytics.metrics.techInterview, fullMark: 100 },
    { subject: 'HR STAR', student: analytics.metrics.hrInterview, fullMark: 100 },
  ] : [], [analytics]);

  if (loading) return <div role="status" className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" />Loading saved analytics…</div>;
  if (error) return <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{error}</div>;
  if (!analytics) return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">Analytics will appear when a student profile is available.</div>;

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-xs font-bold mb-2">
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Batch & Individual Analytics</span>
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Placement Readiness & Performance Telemetry
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Deep visual intelligence across all 40 bootcamp days, topic mastery distributions, and skill radar mapping.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="px-4 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-100 dark:border-indigo-900/60 text-right">
            <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold uppercase block">
              Readiness Score
            </span>
            <span className="text-xl font-extrabold text-indigo-900 dark:text-indigo-100">
              {analytics.readinessScore}%
            </span>
          </div>
        </div>
      </div>

      {/* Row 1: 40-Day Progression Area Chart & Skill Radar (2 Cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: 40-Day Progress Line Chart (7 Cols) */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                <span>Saved Assessment Scores vs Batch Benchmark</span>
              </h2>
              <p className="text-xs text-slate-500">
                Shows submitted assessment attempts and the average score for this student’s batch.
              </p>
            </div>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              {analytics.trend.length ? <AreaChart data={analytics.trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#4F46E5" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="codingGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0F172A',
                    borderRadius: '12px',
                    color: '#fff',
                    fontSize: '12px',
                    border: 'none',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                <Area
                  type="monotone"
                  dataKey="studentScore"
                  name="Student Score"
                  stroke="#4F46E5"
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#scoreGradient)"
                />
                <Area
                  type="monotone"
                  dataKey="codingScore"
                  name="Coding Mastery"
                  stroke="#10B981"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#codingGradient)"
                />
                <Line
                  type="monotone"
                  dataKey="benchmark"
                  name="Drive Benchmark"
                  stroke="#94A3B8"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={false}
                />
              </AreaChart> : <div className="flex h-full items-center justify-center text-center text-xs text-slate-500">No saved assessment attempts yet.</div>}
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right: Competency Radar Chart (5 Cols) */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Brain className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                <span>Multi-Skill Competency Radar</span>
              </h2>
              <p className="text-xs text-slate-500">Saved skill scores from the student profile</p>
            </div>
          </div>

          <div className="h-72 w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={skillRadar} margin={{ top: 0, right: 20, left: 20, bottom: 0 }}>
                <PolarGrid stroke="#cbd5e1" opacity={0.5} />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: '#64748B' }} />
                <PolarRadiusAxis domain={[0, 100]} angle={30} tick={{ fontSize: 9 }} />
                <Radar
                  name="Student"
                  dataKey="student"
                  stroke="#4F46E5"
                  fill="#4F46E5"
                  fillOpacity={0.4}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0F172A',
                    borderRadius: '12px',
                    color: '#fff',
                    fontSize: '12px',
                    border: 'none',
                  }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Row 2: Topic-wise Performance Bars & Placement Batch Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Topic Performance Bar Chart (8 Cols) */}
        <div className="lg:col-span-8 bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Code2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                <span>Domain-Wise Topic Performance vs Target Benchmarks</span>
              </h2>
              <p className="text-xs text-slate-500">
                Average score for each topic in submitted assessments; 70% is the current pass threshold.
              </p>
            </div>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              {analytics.topics.length ? <BarChart data={analytics.topics} margin={{ top: 10, right: 10, left: -20, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                <XAxis dataKey="topic" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0F172A',
                    borderRadius: '12px',
                    color: '#fff',
                    fontSize: '12px',
                    border: 'none',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '5px' }} />
                <Bar dataKey="score" name="Student Score" fill="#4F46E5" radius={[6, 6, 0, 0]} />
                <Bar dataKey="target" name="Pass Threshold" fill="#CBD5E1" radius={[6, 6, 0, 0]} />
              </BarChart> : <div className="flex h-full items-center justify-center text-center text-xs text-slate-500">Topic scores appear after an assessment with saved results.</div>}
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right: Batch Placement Distribution Pie (4 Cols) */}
        <div className="lg:col-span-4 bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Award className="w-5 h-5 text-emerald-500" />
                <span>Batch Readiness Distribution</span>
              </h2>
              <p className="text-xs text-slate-500">{analytics.batchStudentCount} active students in this batch</p>
            </div>
          </div>

          <div className="h-60 w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={analytics.distribution}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={75}
                  paddingAngle={4}
                  label={({ name, percent }) => `${name.split(' ')[0]} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {analytics.distribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0F172A',
                    borderRadius: '12px',
                    color: '#fff',
                    fontSize: '12px',
                    border: 'none',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-1.5 pt-1">
            {analytics.distribution.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-slate-700 dark:text-slate-300 font-medium">{item.name}</span>
                </div>
                <span className="font-bold text-slate-900 dark:text-white">{item.value} Students</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
