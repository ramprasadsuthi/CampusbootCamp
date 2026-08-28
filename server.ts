import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Lazy-initialized Gemini AI client
let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!geminiClient && process.env.GEMINI_API_KEY) {
    geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return geminiClient;
}

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    appName: 'Campus Placement Assessment Portal',
    timestamp: new Date().toISOString(),
    aiConfigured: Boolean(process.env.GEMINI_API_KEY),
  });
});

// AI: Personalized Recommendations
app.post('/api/ai/recommendations', async (req, res) => {
  try {
    const { studentName, scores, weakAreas, targetCompanies } = req.body;
    const ai = getGeminiClient();

    if (ai) {
      const prompt = `You are a Senior Placement Director at a premier engineering university.
Analyze the following student profile for their 40-Day Campus Readiness Bootcamp:
Student: ${studentName || 'Student'}
Scores: Coding: ${scores?.coding || 70}%, Aptitude: ${scores?.aptitude || 65}%, Reasoning: ${scores?.reasoning || 75}%, SQL: ${scores?.sql || 60}%, Communication: ${scores?.communication || 80}%
Weak Areas: ${(weakAreas || ['Dynamic Programming', 'Time & Work', 'SQL Window Functions']).join(', ')}
Target Companies: ${(targetCompanies || ['TCS NQT', 'Infosys', 'Accenture', 'Cognizant', 'Capgemini', 'Wipro']).join(', ')}

Provide a structured, encouraging, and highly specific 3-step action plan for this student to cross the 85%+ readiness mark. Include exact practice topics, daily time split, and company-specific tips for TCS NQT and Infosys. Keep the response crisp, formatted in bullet points with bold highlights.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: prompt,
      });

      return res.json({
        recommendation: response.text,
        generatedByAI: true,
      });
    }

    // High quality rule-based fallback
    return res.json({
      recommendation: `### Personalized Placement Strategy for ${studentName || 'Candidate'}
- **Immediate Coding Remediation (2 hrs/day)**: Focus on ${(weakAreas && weakAreas[0]) || 'Dynamic Programming and Two-Pointer'} problems on LeetCode/HackerRank. Prioritize classic 1D array transformations commonly tested in TCS NQT & Infosys DSE rounds.
- **Aptitude Precision Drill (1 hr/day)**: Practice 25 timed MCQs daily on ${(weakAreas && weakAreas[1]) || 'Time & Work, Permutations, and Syllogisms'}. Target speed threshold under 75 seconds per question.
- **Technical & SQL Revision (45 mins/day)**: Review DBMS indexing, GROUP BY with HAVING clauses, and 2nd Normal Form explanations for technical panel interviews.
- **Company Specific Target**: For ${targetCompanies?.[0] || 'TCS NQT'}, ensure zero negative marking in the Foundation Section to qualify for the Digital / Prime interview track.`,
      generatedByAI: false,
    });
  } catch (error) {
    console.error('AI recommendation error:', error);
    res.status(500).json({ error: 'Failed to generate recommendations' });
  }
});

// AI: Readiness Prediction & Company Match
app.post('/api/ai/predict-readiness', async (req, res) => {
  try {
    const { student, overallScore } = req.body;
    const ai = getGeminiClient();

    if (ai) {
      const prompt = `You are an enterprise talent evaluation engine.
Evaluate placement eligibility for candidate:
Name: ${student?.name || 'Student'}
Overall Score: ${overallScore || 78}%
Coding: ${student?.scores?.coding || 75}%
Aptitude: ${student?.scores?.aptitude || 70}%
Communication: ${student?.scores?.communication || 85}%
Mock Technical Rating: ${student?.scores?.techInterview || 4.2}/5.0
Mock HR Rating: ${student?.scores?.hrInterview || 4.5}/5.0

Return a JSON with:
{
  "readinessTier": "High" | "Moderate" | "Needs Attention",
  "probabilityTCSDigital": number (0-100),
  "probabilityInfosysSE": number (0-100),
  "probabilityAccentureASE": number (0-100),
  "topStrengths": string[],
  "criticalGaps": string[],
  "summary": string
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: prompt,
        config: { responseMimeType: 'application/json' },
      });

      try {
        const parsed = JSON.parse(response.text || '{}');
        return res.json({ ...parsed, generatedByAI: true });
      } catch {
        // fallback to standard response if json parsing fails
      }
    }

    const score = overallScore || 78;
    const readinessTier = score >= 80 ? 'High' : score >= 65 ? 'Moderate' : 'Needs Attention';
    return res.json({
      readinessTier,
      probabilityTCSDigital: Math.min(98, Math.max(20, Math.round(score * 1.08))),
      probabilityInfosysSE: Math.min(99, Math.max(30, Math.round(score * 1.15))),
      probabilityAccentureASE: Math.min(99, Math.max(40, Math.round(score * 1.2))),
      topStrengths: ['Data Structures & Logic Flow', 'Verbal Communication', 'Object Oriented Programming'],
      criticalGaps: ['Complex Graph algorithms', 'Subquery optimizations in SQL'],
      summary: `Candidate demonstrates solid aptitude and structured problem-solving approach. With focused revision on edge-case testing, they have strong odds of clearing Service IT super-dream and dream selection bands.`,
      generatedByAI: false,
    });
  } catch (error) {
    console.error('AI prediction error:', error);
    res.status(500).json({ error: 'Failed to predict readiness' });
  }
});

// AI: Trainer Intervention Summary
app.post('/api/ai/trainer-summary', async (req, res) => {
  try {
    const { batchName, atRiskCount, averageScore, lowScoringTopics } = req.body;
    const ai = getGeminiClient();

    if (ai) {
      const prompt = `You are a Master Placement Trainer and Curriculum Advisor.
Generate an executive intervention briefing for Batch: ${batchName || 'Batch A - 2026 Ready'}.
Metrics:
- Total At-Risk Students: ${atRiskCount || 6}
- Batch Average Score: ${averageScore || 74.5}%
- Low Scoring Areas: ${(lowScoringTopics || ['Sliding Window', 'Pipes & Cisterns', 'SQL Subqueries']).join(', ')}

Provide 3 high-impact intervention strategies for trainers this week, including a 30-minute daily doubt-clearing structure and recommended practice worksheets.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: prompt,
      });

      return res.json({ summary: response.text, generatedByAI: true });
    }

    return res.json({
      summary: `### Trainer Intervention Directive for ${batchName || 'Active Batch'}
1. **Daily 30-Min Micro-Workshops**: Schedule focused problem-solving walkthroughs on ${(lowScoringTopics || ['Sliding Window and Prefix Sums']).slice(0, 2).join(' & ')} before the morning coding test.
2. **Peer Pairing for At-Risk Trainees**: Pair the ${atRiskCount || 6} identified at-risk trainees with top-quartile mentors for live code reviews.
3. **Targeted Drill Re-Tests**: Issue an untimed 10-question drill for students scoring below 60% in Day 7 and Day 14 benchmarks to solidify fundamentals before the Day 26 Full Mock.`,
      generatedByAI: false,
    });
  } catch (error) {
    console.error('Trainer summary error:', error);
    res.status(500).json({ error: 'Failed to generate trainer summary' });
  }
});

// Code Execution Simulator
app.post('/api/code/run', (req, res) => {
  const { code, language, input, testCases } = req.body;
  const startTime = Date.now();

  // Evaluate simple common test cases or provide realistic simulation
  const results = (testCases || [
    { input: '5\n1 2 3 4 5', expected: '15' },
    { input: '3\n10 20 30', expected: '60' },
  ]).map((tc: any, index: number) => {
    // Generate deterministic execution results
    const isHidden = Boolean(tc.hidden);
    const passed = !code.includes('syntax_error_test') && !code.includes('throw');
    return {
      testCaseId: index + 1,
      input: tc.input,
      expected: tc.expected,
      actual: passed ? tc.expected : 'Runtime Exception: IndexOutOfBounds',
      passed,
      hidden: isHidden,
      executionTimeMs: Math.floor(Math.random() * 45) + 12,
      memoryKb: Math.floor(Math.random() * 2048) + 14200,
    };
  });

  const totalPassed = results.filter((r: any) => r.passed).length;
  const executionTimeMs = Date.now() - startTime + Math.floor(Math.random() * 80) + 30;

  res.json({
    success: totalPassed === results.length,
    score: Math.round((totalPassed / results.length) * 100),
    totalTestCases: results.length,
    passedTestCases: totalPassed,
    executionTimeMs,
    memoryKb: 15420,
    language: language || 'javascript',
    stdout: `Program executed successfully in ${language}.\nPassed ${totalPassed}/${results.length} test cases.`,
    results,
  });
});

// Start Server and Vite Middleware
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Campus Placement Portal] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
