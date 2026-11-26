import jsPDF from 'jspdf';
import { StudentProfile } from '../types';
import { WorkspaceActivityRow } from '../types/reports';
import { explainReadiness } from './readinessScore';

export function generateStudentReportPDF(student: StudentProfile) {
  const readinessExplanation = student.readinessExplanation || explainReadiness(student.metrics as any);
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const primaryIndigo: [number, number, number] = [79, 70, 229]; // #4F46E5
  const darkSlate: [number, number, number] = [15, 23, 42]; // #0F172A
  const lightBg: [number, number, number] = [248, 250, 252]; // #F8FAFC
  const accentGreen: [number, number, number] = [16, 185, 129];

  // Header Banner
  doc.setFillColor(...primaryIndigo);
  doc.rect(0, 0, 210, 36, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('TALENT EDGE - PLACEMENT READINESS REPORT', 14, 16);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Talent Edge Placement Accelerator Program | 40-Day Bootcamp Guide', 14, 24);
  doc.text(`Generated on: ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`, 14, 30);

  // Student Info Card Box
  doc.setFillColor(...lightBg);
  doc.roundedRect(14, 42, 182, 36, 3, 3, 'F');

  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, 42, 182, 36, 3, 3, 'D');

  doc.setTextColor(...darkSlate);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(student.name, 20, 52);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(8);
  doc.text(`Email: ${student.email || 'Not recorded'}`, 20, 58);
  doc.text(`Roll Number: ${student.rollNo || 'Not recorded'}  |  Branch: ${student.branch || 'Not recorded'}`, 20, 63);
  doc.text(`College: ${student.college || 'Not recorded'}`, 20, 68);
  doc.text(`Batch: ${student.batch || 'Not assigned'}  |  Lead Trainer: ${student.trainer || 'Not assigned'}`, 20, 73);

  // Score Badge in Card
  doc.setFillColor(...primaryIndigo);
  doc.roundedRect(148, 47, 42, 26, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('WEIGHTED READINESS', 151, 54);
  doc.setFontSize(18);
  doc.text(`${student.placementReadinessScore}%`, 157, 65);
  doc.setFontSize(6);
  doc.text(`Model ${readinessExplanation.modelVersion}`, 151, 70);

  // Section 1: Core Performance Breakdown Table
  let yPos = 88;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...darkSlate);
  doc.text('1. Core Competency & Assessment Metrics', 14, yPos);

  yPos += 6;

  // Table header
  doc.setFillColor(241, 245, 249);
  doc.rect(14, yPos, 182, 7, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(71, 85, 105);
  doc.text('SKILL INDICATOR', 18, yPos + 5);
  doc.text('SCORE', 115, yPos + 5);
  doc.text('WEIGHT', 145, yPos + 5);
  doc.text('CONTRIB.', 174, yPos + 5);

  yPos += 7;
  readinessExplanation.factors.forEach((factor, idx) => {
    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(14, yPos, 182, 6, 'F');
    }
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59);
    doc.text(factor.label, 18, yPos + 4.5);
    doc.setFont('helvetica', 'bold');
    doc.text(factor.score === null ? 'No data' : `${factor.score}%`, 115, yPos + 4.5);
    doc.setFont('helvetica', 'normal');
    doc.text(`${factor.weight}%`, 149, yPos + 4.5);
    doc.setTextColor(...accentGreen);
    doc.text(factor.score === null ? '—' : factor.contribution.toFixed(1), 178, yPos + 4.5);
    yPos += 6;
  });

  yPos += 2;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('Weighted training indicator; not a hiring decision or placement probability.', 14, yPos);

  // Section 2: Company Eligibility Tiering
  yPos += 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...darkSlate);
  doc.text('2. Illustrative Company Fit Indicators (Not Hiring Probabilities)', 14, yPos);

  yPos += 6;
  student.eligibility.slice(0, 5).forEach((el) => {
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(14, yPos, 182, 10, 2, 2, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(14, yPos, 182, 10, 2, 2, 'D');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    doc.text(`${el.company} - ${el.roleName}`, 18, yPos + 6.5);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(`Tier: ${el.tier}`, 110, yPos + 6.5);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(16, 185, 129);
    doc.text(`Illustrative: ${el.status}`, 160, yPos + 6.5);

    yPos += 12;
  });

  // Section 3: Key Strengths & Weaknesses
  yPos += 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...darkSlate);
  doc.text('3. Strengths & Focus Areas', 14, yPos);

  yPos += 6;
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(16, 185, 129);
  doc.text('Key Strengths: ', 14, yPos);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 65, 85);
  doc.text(student.strengths.join(' • '), 40, yPos);

  yPos += 5.5;
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(220, 38, 38);
  doc.text('Action Areas: ', 14, yPos);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 65, 85);
  doc.text(student.weakAreas.join(' • '), 40, yPos);

  // Section 4: Trainer Endorsement Remarks
  yPos += 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...darkSlate);
  doc.text('4. Official Trainer Remarks & Final Recommendation', 14, yPos);

  yPos += 5;
  doc.setFillColor(241, 245, 249);
  doc.roundedRect(14, yPos, 182, 18, 2, 2, 'F');
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(51, 65, 85);
  const trainerComment = student.recentRemarks[0]?.comment || 'No trainer feedback has been recorded for this student.';
  const splitComment = doc.splitTextToSize(`"${trainerComment}" - ${student.trainer}`, 174);
  doc.text(splitComment, 18, yPos + 6);

  // Footer Signature & Verification
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  const reportId = (student.id || student.rollNo || 'STUDENT').replace(/[^a-z0-9]/gi, '').slice(-12).toUpperCase();
  doc.text(`Talent Edge Placement Cell | Student Report | Document ID: TED-CPR-${reportId}`, 14, 288);
  doc.text('Page 1 of 1', 185, 288);

  // Save the PDF
  doc.save(`${student.name.replace(/\s+/g, '_')}_Placement_Readiness_Report.pdf`);
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const csvCell = (value: unknown) => {
    let text = String(value ?? '');
    if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const csvContent = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportBatchCSV(batchName: string, students: StudentProfile[], criteria: Array<[string, string]> = []) {
  const headers = [
    'Roll No',
    'Name',
    'Email',
    'College',
    'Branch',
    'Attendance %',
    'Overall Readiness %',
    'Coding Score',
    'Aptitude Score',
    'Reasoning Score',
    'SQL Score',
    'Tech Interview',
    'HR Interview',
    'Placement Status',
  ];

  const rows = students.map((s) => [
    s.rollNo,
    s.name,
    s.email,
    s.college,
    s.branch,
    s.attendancePercent,
    s.placementReadinessScore,
    s.metrics.coding,
    s.metrics.aptitude,
    s.metrics.reasoning,
    s.metrics.sql,
    s.metrics.techInterview,
    s.metrics.hrInterview,
    s.placementReadinessScore >= 80 ? 'Tier 1 Ready' : s.placementReadinessScore >= 65 ? 'Tier 2 Ready' : 'Needs Intervention',
  ]);

  const metadata: unknown[][] = [['Report', 'Placement readiness'], ...criteria.map(([key, value]) => [key, value]), []];
  downloadCsv(`${batchName.replace(/[^a-z0-9_-]+/gi, '_')}_Placement_Report.csv`, [...metadata, headers, ...rows]);
}

export function exportActivityReportCSV(reportName: string, activities: WorkspaceActivityRow[], criteria: Array<[string, string]>) {
  const headers = ['Activity date', 'Activity type', 'Activity', 'Student', 'Roll no', 'Batch', 'Score %', 'Readiness %', 'Outcome'];
  const rows = activities.map((item) => [
    item.activityDate,
    item.activityType.replaceAll('_', ' '),
    item.activityName,
    item.studentName,
    item.rollNo,
    item.batchName,
    item.score === null ? '' : item.score,
    item.readinessScore,
    item.outcome,
  ]);
  const metadata: unknown[][] = [['Report', reportName], ...criteria.map(([key, value]) => [key, value]), []];
  downloadCsv(`${reportName.replace(/[^a-z0-9_-]+/gi, '_')}.csv`, [...metadata, headers, ...rows]);
}
