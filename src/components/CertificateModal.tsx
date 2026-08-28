import React from 'react';
import {
  Award,
  Sparkles,
  CheckCircle2,
  Download,
  Share2,
  ShieldCheck,
  Building,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { generateStudentReportPDF } from '../utils/pdfGenerator';
import { StudentProfile } from '../types';

interface CertificateModalProps {
  student: StudentProfile;
  onClose?: () => void;
}

export const CertificateModal: React.FC<CertificateModalProps> = ({ student, onClose }) => {
  const triggerConfetti = () => {
    try {
      confetti({
        particleCount: 120,
        spread: 90,
        origin: { y: 0.5 },
      });
    } catch {}
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Top Banner */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-xs font-bold mb-2">
            <Award className="w-3.5 h-3.5" />
            <span>Verified Credentials & Honors</span>
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Bootcamp Certificate of Completion
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Digitally verifiable certificate endorsing candidate readiness across Coding, Aptitude, and Interview clearance.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={triggerConfetti}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 text-xs font-bold hover:bg-purple-100 transition-colors cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-pink-500" />
            <span>Celebrate!</span>
          </button>

          <button
            onClick={() => generateStudentReportPDF(student)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md cursor-pointer transition-all"
          >
            <Download className="w-4 h-4" />
            <span>Download Verified Dossier</span>
          </button>
        </div>
      </div>

      {/* Certificate Frame */}
      <div className="relative max-w-4xl mx-auto p-8 sm:p-12 rounded-3xl bg-gradient-to-br from-white via-indigo-50/20 to-blue-50/30 dark:from-slate-900 dark:via-indigo-950/20 dark:to-slate-900 border-8 border-double border-indigo-200 dark:border-indigo-900/60 shadow-2xl text-center space-y-6">
        {/* Certificate Watermark / Medallion */}
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-600 to-blue-600 text-white flex items-center justify-center shadow-lg">
            <Award className="w-9 h-9" />
          </div>
        </div>

        <div>
          <span className="text-xs font-extrabold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
            Certificate of Excellence & Placement Readiness
          </span>
          <h2 className="text-2xl sm:text-4xl font-serif font-black text-slate-900 dark:text-white mt-2 tracking-tight">
            40-Day Campus Readiness Bootcamp
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Certified by the Directorate of Training & Campus Placements
          </p>
        </div>

        <div className="py-2">
          <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
            This is proudly awarded to
          </p>
          <p className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white mt-1 border-b-2 border-indigo-500 inline-block px-8 pb-1">
            {student.name}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 font-mono">
            Roll No: {student.rollNo} • {student.college}
          </p>
        </div>

        <p className="max-w-2xl mx-auto text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed font-serif">
          for demonstrating exceptional algorithmic problem-solving competency, commercial quantitative aptitude,
          and clear interview articulation across all 40 days of intensive placement preparation with an aggregate score of{' '}
          <strong className="text-indigo-600 dark:text-indigo-400 font-sans">{student.placementReadinessScore}%</strong>.
        </p>

        {/* Competency Badges on Certificate */}
        <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
          <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 text-xs font-bold flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            DSA Two-Pointer & DP Master
          </span>
          <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 text-xs font-bold flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Quantitative Aptitude Certified
          </span>
          <span className="px-3 py-1 rounded-full bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 text-xs font-bold flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            STAR HR Panel Cleared
          </span>
        </div>

        {/* Signatures */}
        <div className="pt-8 grid grid-cols-2 max-w-lg mx-auto gap-8 text-center text-xs">
          <div className="space-y-1">
            <div className="border-b border-slate-400 pb-1 font-serif italic text-slate-800 dark:text-slate-200">
              Prof. Rajesh Sharma
            </div>
            <p className="text-[10px] text-slate-400 font-bold uppercase">Lead Technical Trainer</p>
          </div>
          <div className="space-y-1">
            <div className="border-b border-slate-400 pb-1 font-serif italic text-slate-800 dark:text-slate-200">
              Dr. Sarah Jenkins
            </div>
            <p className="text-[10px] text-slate-400 font-bold uppercase">Dean of Corporate Relations</p>
          </div>
        </div>

        <div className="pt-4 text-[10px] text-slate-400 flex items-center justify-between border-t border-slate-200 dark:border-slate-800">
          <span>Credential ID: NIT-CPR-2026-8849</span>
          <span>Digitally Verified & Tamper-Evident</span>
        </div>
      </div>
    </div>
  );
};
