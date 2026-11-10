import React from 'react';
import {
  LayoutDashboard,
  CalendarDays,
  FileCheck2,
  Code,
  User,
  Users,
  Award,
  BarChart3,
  Trophy,
  Sliders,
  FileText,
  Briefcase,
  Layers,
  Sparkles,
  ChevronRight,
  Building2,
} from 'lucide-react';
import { UserRole } from '../types';

interface SidebarProps {
  currentRole: UserRole;
  activeTab: string;
  onSelectTab: (tab: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentRole,
  activeTab,
  onSelectTab,
  isOpen,
  onClose,
}) => {
  const getNavItems = () => {
    switch (currentRole) {
      case 'admin':
        return [
          { id: 'dashboard', label: 'Executive Dashboard', icon: LayoutDashboard },
          { id: 'batches', label: 'Batches & Colleges', icon: Layers },
          { id: 'students', label: 'Student Directory', icon: Users },
          { id: 'assessments', label: 'Assessment Engine', icon: FileCheck2 },
          { id: 'curriculum', label: '40-Day Curriculum', icon: CalendarDays },
          { id: 'interviews_sched', label: 'Interview Panels', icon: Briefcase },
          { id: 'analytics', label: 'Institutional Analytics', icon: BarChart3 },
          { id: 'reports', label: 'Reports & Export', icon: FileText },
          { id: 'settings', label: 'System Settings', icon: Sliders },
          { id: 'workspace', label: 'Workspace Members', icon: Building2 },
        ];
      case 'trainer':
        return [
          { id: 'dashboard', label: 'Trainer Dashboard', icon: LayoutDashboard },
          { id: 'batches', label: 'Assigned Batches', icon: Users },
          { id: 'assessments', label: 'Conduct Assessments', icon: FileCheck2 },
          { id: 'eval_tech', label: 'Technical Interview Panel', icon: Code },
          { id: 'eval_hr', label: 'HR Interview Panel', icon: User },
          { id: 'curriculum', label: '40-Day Roadmap', icon: CalendarDays },
          { id: 'analytics', label: 'Cohort Heatmaps', icon: BarChart3 },
          { id: 'leaderboard', label: 'Batch Leaderboard', icon: Trophy },
        ];
      case 'student':
      default:
        return [
          { id: 'dashboard', label: 'Bootcamp Dashboard', icon: LayoutDashboard },
          { id: 'curriculum', label: '40-Day Roadmap', icon: CalendarDays, badge: 'Day 40' },
          { id: 'assessments', label: 'Live Assessments', icon: FileCheck2, badge: 'Live' },
          { id: 'code_sandbox', label: 'Coding Sandbox', icon: Code },
          { id: 'student_profile', label: 'Profile & Readiness', icon: User },
          { id: 'interviews', label: 'Mock Interview Scores', icon: Briefcase },
          { id: 'analytics', label: 'Performance Analytics', icon: BarChart3 },
          { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
          { id: 'certificate', label: 'Placement Certificate', icon: Award },
        ];
    }
  };

  const navItems = getNavItems();

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-xs md:hidden"
        />
      )}

      <aside
        className={`fixed md:sticky top-14 z-40 h-[calc(100vh-3.5rem)] w-56 shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-transform duration-200 ease-in-out overflow-y-auto flex flex-col justify-between p-3 ${
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div>
          {/* Section Category Title */}
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-2">
            Main Menu
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              const isLive = item.id === 'assessments' && currentRole === 'student';

              return (
                <button
                  key={item.id}
                  id={`nav-item-${item.id}`}
                  onClick={() => {
                    onSelectTab(item.id);
                    onClose();
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs sm:text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 font-semibold'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon
                      className={`w-4 h-4 ${
                        isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-400'
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </div>

                  {isLive ? (
                    <span className="flex items-center gap-1">
                      <span className="animate-pulse h-2 w-2 rounded-full bg-rose-500" />
                      <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300">
                        Live
                      </span>
                    </span>
                  ) : item.badge ? (
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                        isActive
                          ? 'bg-indigo-200 dark:bg-indigo-900 text-indigo-900 dark:text-indigo-200'
                          : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300'
                      }`}
                    >
                      {item.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Batch Progress Widget */}
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
          <div className="bg-slate-900 dark:bg-slate-950 rounded-xl p-3.5 text-white space-y-2 shadow-xs">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-slate-400">Batch Progress</span>
              <span className="text-indigo-400 font-bold">Day 40 / 40</span>
            </div>
            <div className="h-1.5 w-full bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 rounded-full w-[100%]" />
            </div>
            <div className="text-[10px] text-slate-400 flex items-center justify-between">
              <span className="truncate">Phase: Simulation</span>
              <span className="text-emerald-400 font-bold shrink-0">100% Ready</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
