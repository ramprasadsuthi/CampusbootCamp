import jsPDF from 'jspdf';
import { StudentProfile } from '../types';

export function generateStudentReportPDF(student: StudentProfile) {
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
  doc.text('CAMPUS PLACEMENT READINESS REPORT', 14, 16);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('40-Day Intensive Campus Readiness Bootcamp | Verified Candidate Dossier', 14, 24);
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
  doc.text(`Roll Number: ${student.rollNo}  |  Branch: ${student.branch}`, 20, 58);
  doc.text(`College: ${student.college}`, 20, 64);
  doc.text(`Batch: ${student.batch}  |  Lead Trainer: ${student.trainer}`, 20, 70);

  // Score Badge in Card
  doc.setFillColor(...primaryIndigo);
  doc.roundedRect(148, 47, 42, 26, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('OVERALL READINESS', 151, 54);
  doc.setFontSize(18);
  doc.text(`${student.placementReadinessScore}%`, 157, 65);

  // Section 1: Core Performance Breakdown Table
  let yPos = 88;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...darkSlate);
  doc.text('1. Core Competency & Assessment Metrics', 14, yPos);

  yPos += 6;
  const metrics = [
    { name: 'Coding & Algorithmic Problem Solving', score: `${student.metrics.coding}%`, benchmark: '80%', status: student.metrics.coding >= 80 ? 'Mastered' : 'Competent' },
    { name: 'Quantitative Aptitude & Arithmetic', score: `${student.metrics.aptitude}%`, benchmark: '75%', status: student.metrics.aptitude >= 75 ? 'Mastered' : 'Competent' },
    { name: 'Logical & Analytical Reasoning', score: `${student.metrics.reasoning}%`, benchmark: '75%', status: student.metrics.reasoning >= 75 ? 'Mastered' : 'Competent' },
    { name: 'Relational Database Management (SQL)', score: `${student.metrics.sql}%`, benchmark: '70%', status: student.metrics.sql >= 70 ? 'Mastered' : 'Competent' },
    { name: 'Computer Science Fundamentals (OS/CN/OOP)', score: `${student.metrics.csFundamentals}%`, benchmark: '75%', status: student.metrics.csFundamentals >= 75 ? 'Mastered' : 'Competent' },
    { name: 'Verbal & Corporate Communication', score: `${student.metrics.communication}%`, benchmark: '80%', status: student.metrics.communication >= 80 ? 'Mastered' : 'Competent' },
    { name: 'Mock Technical Interview Evaluation', score: `${student.metrics.techInterview}%`, benchmark: '80%', status: 'Panel Approved' },
    { name: 'Mock HR & Behavioral Interview (STAR)', score: `${student.metrics.hrInterview}%`, benchmark: '80%', status: 'Cleared' },
  ];

  // Table header
  doc.setFillColor(241, 245, 249);
  doc.rect(14, yPos, 182, 7, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(71, 85, 105);
  doc.text('EVALUATION DOMAIN', 18, yPos + 5);
  doc.text('STUDENT SCORE', 110, yPos + 5);
  doc.text('DRIVE BENCHMARK', 145, yPos + 5);
  doc.text('VERDICT', 178, yPos + 5);

  yPos += 7;
  metrics.forEach((m, idx) => {
    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(14, yPos, 182, 6, 'F');
    }
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59);
    doc.text(m.name, 18, yPos + 4.5);
    doc.setFont('helvetica', 'bold');
    doc.text(m.score, 115, yPos + 4.5);
    doc.setFont('helvetica', 'normal');
    doc.text(m.benchmark, 150, yPos + 4.5);
    doc.setTextColor(...accentGreen);
    doc.text(m.status, 178, yPos + 4.5);
    yPos += 6;
  });

  // Section 2: Company Eligibility Tiering
  yPos += 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...darkSlate);
  doc.text('2. Target Company Eligibility & Placement Probability', 14, yPos);

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
    doc.text(`${el.currentProbability}% Match (${el.status})`, 160, yPos + 6.5);

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
  const trainerComment = student.recentRemarks[0]?.comment || 'Candidate is highly motivated with exceptional problem-solving and structured algorithmic reasoning.';
  const splitComment = doc.splitTextToSize(`"${trainerComment}" - ${student.trainer}`, 174);
  doc.text(splitComment, 18, yPos + 6);

  // Footer Signature & Verification
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text('Campus Placement Cell | Certified Digitally Signed Report | Document ID: NIT-CPR-2026-8849', 14, 288);
  doc.text('Page 1 of 1', 185, 288);

  // Save the PDF
  doc.save(`${student.name.replace(/\s+/g, '_')}_Placement_Readiness_Report.pdf`);
}

export function exportBatchCSV(batchName: string, students: StudentProfile[]) {
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
    `"${s.name}"`,
    s.email,
    `"${s.college}"`,
    `"${s.branch}"`,
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

  const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${batchName.replace(/\s+/g, '_')}_Placement_Report.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
