import React from 'react';
import {
  GraduationCap,
  Bell,
  Sparkles,
  Sun,
  Moon,
  ChevronDown,
  UserCheck,
  ShieldCheck,
  Code2,
  Menu,
  X,
} from 'lucide-react';
import { StudentProfile, UserRole } from '../types';

interface NavbarProps {
  currentRole: UserRole;
  onSelectRole: (role: UserRole) => void;
  students: StudentProfile[];
  selectedStudent: StudentProfile;
  onSelectStudent: (student: StudentProfile) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onOpenAiInsights: () => void;
  onOpenNotifications: () => void;
  unreadNotifsCount: number;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentRole,
  onSelectRole,
  students,
  selectedStudent,
  onSelectStudent,
  darkMode,
  onToggleDarkMode,
  onOpenAiInsights,
  onOpenNotifications,
  unreadNotifsCount,
  sidebarOpen,
  onToggleSidebar,
}) => {
  return (
    <header className="h-14 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center px-4 sm:px-6 justify-between shrink-0 z-30 sticky top-0 transition-colors">
      {/* Left: Brand & Mobile Toggle */}
      <div className="flex items-center space-x-3">
        <button
          id="mobile-sidebar-toggle-btn"
          onClick={onToggleSidebar}
          className="md:hidden p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none"
          aria-label="Toggle menu"
        >
          {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>

        <div className="flex items-center space-x-2.5">
          <div className="bg-indigo-600 h-8 w-8 rounded-lg flex items-center justify-center text-white font-bold shadow-xs">
            C
          </div>
          <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-1.5">
            <span>Campus Readiness</span>
            <span className="text-indigo-600 dark:text-indigo-400 font-semibold italic text-sm sm:text-base">
              40-Day Bootcamp
            </span>
          </h1>
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center space-x-3 sm:space-x-4">
        {/* Active Role Pill */}
        <div className="hidden sm:flex items-center bg-indigo-50 dark:bg-indigo-950/60 px-3 py-1 rounded-full border border-indigo-100 dark:border-indigo-900/60">
          <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 uppercase tracking-wide">
            {currentRole === 'admin'
              ? 'Admin Mode'
              : currentRole === 'trainer'
              ? 'Trainer Mode'
              : 'Student Mode'}
          </span>
        </div>

        {/* Role Switcher Pills */}
        <div className="hidden lg:flex items-center p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <button
            id="role-btn-student"
            onClick={() => onSelectRole('student')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              currentRole === 'student'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>Student</span>
          </button>
          <button
            id="role-btn-trainer"
            onClick={() => onSelectRole('trainer')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              currentRole === 'trainer'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Trainer</span>
          </button>
          <button
            id="role-btn-admin"
            onClick={() => onSelectRole('admin')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              currentRole === 'admin'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Admin</span>
          </button>
        </div>

        {/* Candidate Switcher Dropdown (Student mode) */}
        {currentRole === 'student' && (
          <div className="relative hidden md:block">
            <select
              id="student-switcher-select"
              value={selectedStudent.id}
              onChange={(e) => {
                const s = students.find((st) => st.id === e.target.value);
                if (s) onSelectStudent(s);
              }}
              className="text-xs font-medium pl-2.5 pr-7 py-1 rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-500 appearance-none"
            >
              {students.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name} ({st.rollNo})
                </option>
              ))}
            </select>
            <ChevronDown className="w-3 h-3 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        )}

        {/* AI Insights Action */}
        <button
          id="ai-insights-btn"
          onClick={onOpenAiInsights}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-colors"
          title="AI Placement Insights & Predictions"
        >
          <Sparkles className="w-3.5 h-3.5 animate-pulse" />
          <span className="hidden sm:inline">AI Doctor</span>
        </button>

        {/* Notifications Button */}
        <button
          id="notifications-btn"
          onClick={onOpenNotifications}
          className="relative p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="Notifications"
        >
          <Bell className="w-4 h-4" />
          {unreadNotifsCount > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-rose-500" />
          )}
        </button>

        {/* Theme Toggle */}
        <button
          id="dark-mode-toggle-btn"
          onClick={onToggleDarkMode}
          className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="Toggle theme"
        >
          {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* User Profile Info */}
        <div className="flex items-center space-x-2.5 border-l border-slate-200 dark:border-slate-800 pl-3 sm:pl-4">
          <div className="text-right hidden sm:block leading-tight">
            <div className="text-xs font-bold text-slate-900 dark:text-white">
              {currentRole === 'admin'
                ? 'Dr. Sarah Jenkins'
                : currentRole === 'trainer'
                ? 'Prof. Rajesh Sharma'
                : selectedStudent.name}
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400">
              {currentRole === 'admin'
                ? 'Lead Placement Officer'
                : currentRole === 'trainer'
                ? 'Senior Technical Lead'
                : `Candidate • ${selectedStudent.rollNo}`}
            </div>
          </div>
          <img
            src={selectedStudent.photo}
            alt="Profile avatar"
            className="h-8 w-8 rounded-full bg-slate-200 border-2 border-white dark:border-slate-800 shadow-xs object-cover"
          />
        </div>
      </div>
    </header>
  );
};
