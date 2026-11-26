import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import mysql from 'mysql2/promise';
import { ASSESSMENTS_CATALOG, SAMPLE_CODING_PROBLEMS } from './src/data/assessmentData';
import { CURRICULUM_40_DAYS } from './src/data/curriculumData';
import { DEFAULT_WORKSPACE_SETTINGS, type WorkspaceSettings } from './src/types/auth';
import { hasPlatformPermission, hasWorkspacePermission, SUBSCRIPTION_PLANS, type PlanFeature, type PlanLimit, type PlanLimitKey, type SubscriptionPlanDefinition, type WorkspacePermission, type WorkspaceRoleId, type WorkspaceSubscriptionOverview } from './src/types/subscriptions';
import { createHash, createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { decryptTotpSecret, encryptTotpSecret, generateTotpSecret, verifyTotp } from './src/utils/platformSecurity';
import { explainReadiness, READINESS_MODEL_VERSION } from './src/utils/readinessScore';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = 'talentedge_session';
const SESSION_DAYS = 14;
const PLATFORM_SESSION_COOKIE = 'talentedge_platform_session';
const PLATFORM_SESSION_HOURS = 8;
const ASSESSMENT_PASS_PERCENT = 70;
const loginFailures = new Map<string, { count: number; expiresAt: number }>();

interface AuthContext {
  sessionId: string;
  userId: string;
  name: string;
  email: string;
  avatar: string;
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRoleId;
}

type AuthenticatedRequest = Request & { auth?: AuthContext };
interface PlatformAuthContext { sessionId: string; platformAdminId: string; name: string; email: string; }
type PlatformAuthenticatedRequest = Request & { platformAuth?: PlatformAuthContext };

app.use(express.json({ limit: '400kb', verify: (req: any, _res, buffer) => {
  if (req.originalUrl === '/api/billing/razorpay/webhook') req.rawBody = Buffer.from(buffer);
} }));

// Correlate requests in server logs without logging request bodies, query strings, or credentials.
app.use((req, res, next) => {
  const requestId = randomUUID();
  const startedAt = Date.now();
  res.setHeader('X-Request-Id', requestId);
  res.on('finish', () => {
    // Vite serves many static assets during local development; keep operational logs focused on API traffic.
    if (!req.path.startsWith('/api/') || req.path === '/api/health' || req.path === '/api/ready') return;
    console.log(JSON.stringify({ level: res.statusCode >= 500 ? 'error' : 'info', event: 'http_request', requestId,
      method: req.method, route: (req as any).route?.path || 'unmatched', status: res.statusCode, durationMs: Date.now() - startedAt }));
  });
  next();
});

const JUDGE0_LANGUAGE_PATTERNS: Record<string, RegExp> = {
  c: /^C\s*\(/i,
  cpp: /^C\+\+\s*\(/i,
  java: /^Java\s*\(/i,
  javascript: /^JavaScript\s*\(/i,
  python: /^Python\s*\(/i,
};
let judge0LanguagesCache: { fetchedAt: number; ids: Record<string, number> } | null = null;
async function getJudge0LanguageId(language: string, endpoint: string, headers: Record<string, string>) {
  const key = language.toLowerCase();
  const pattern = JUDGE0_LANGUAGE_PATTERNS[key];
  if (!pattern) throw new Error('This programming language is not enabled.');
  if (!judge0LanguagesCache || Date.now() - judge0LanguagesCache.fetchedAt > 10 * 60 * 1000) {
    const response = await fetch(`${endpoint}/languages`, { headers, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Could not retrieve Judge0 runtimes (HTTP ${response.status}).`);
    const languages: any = await response.json();
    if (!Array.isArray(languages)) throw new Error('Judge0 returned an invalid runtime list.');
    const ids: Record<string, number> = {};
    for (const [name, matcher] of Object.entries(JUDGE0_LANGUAGE_PATTERNS)) {
      const runtime = languages.find((item: any) => typeof item.name === 'string' && matcher.test(item.name));
      if (runtime && Number.isInteger(runtime.id)) ids[name] = runtime.id;
    }
    judge0LanguagesCache = { fetchedAt: Date.now(), ids };
  }
  const id = judge0LanguagesCache.ids[key];
  if (!id) throw new Error(`Judge0 does not have a supported ${language} runtime installed.`);
  return id;
}
function prepareJudgeProgram(sourceCode: string, language: string, problemData: any, testCases: Array<{ input: string; expected?: string; hidden?: boolean }>) {
  const problemId = problemData?.id;
  const functionName = problemId === 'code-1' ? 'twoSum' : problemId === 'code-2' ? 'lengthOfLongestSubstring' : problemId === 'code-3' ? 'subarraySum' : null;
  if (!functionName) return { sourceCode, testCases };
  const languageKey = language.toLowerCase();
  const normalize = (testCase: any) => {
    let args: any[];
    if (problemId === 'code-1') {
      const match = testCase.input.match(/(\[[^\]]*\])\s*,\s*target\s*=\s*(-?\d+)/i);
      if (!match) throw new Error('Bundled Two Sum cases must use the format [numbers], target = value.');
      args = [JSON.parse(match[1]), Number(match[2])];
    } else if (problemId === 'code-3') {
      const match = testCase.input.match(/(?:nums\s*=\s*)?(\[[^\]]*\])\s*,\s*k\s*=\s*(-?\d+)/i);
      if (!match) throw new Error('Bundled Subarray Sum cases must use the format nums = [numbers], k = value.');
      args = [JSON.parse(match[1]), Number(match[2])];
    } else {
      const match = testCase.input.match(/s\s*=\s*("(?:[^"\\]|\\.)*")/i);
      if (!match) throw new Error('Bundled substring cases must use the format s = "text".');
      args = [JSON.parse(match[1])];
    }
    const input = problemId === 'code-2' ? args[0]
      : languageKey === 'python' || languageKey === 'javascript' ? JSON.stringify(args)
        : `${args[0].length} ${args[0].join(' ')} ${args[1]}`;
    return { ...testCase, input };
  };
  const normalizedCases = testCases.map(normalize);
  let harness = '';
  if (languageKey === 'python') {
    const invocation = problemId === 'code-1' ? 'twoSum(*json.loads(line))'
      : problemId === 'code-2' ? 'lengthOfLongestSubstring(line.rstrip("\\n"))' : 'subarraySum(*json.loads(line))';
    harness = `\nimport json, sys\nfor line in sys.stdin:\n    print(json.dumps(${invocation}))\n`;
  } else if (languageKey === 'javascript') {
    const invocation = problemId === 'code-1' ? 'twoSum(...JSON.parse(line))'
      : problemId === 'code-2' ? 'lengthOfLongestSubstring(line.replace(/\\n$/, ""))' : 'subarraySum(...JSON.parse(line))';
    harness = `\nconst fs = require('fs');\nfor (const line of fs.readFileSync(0, 'utf8').split(/\\r?\\n/).filter(Boolean)) console.log(JSON.stringify(${invocation}));\n`;
  } else if (languageKey === 'cpp' || languageKey === 'java' || languageKey === 'c') {
    if (problemId === 'code-2' && languageKey === 'cpp') harness = `\n#include <iostream>\nint main(){ std::string s; std::getline(std::cin, s); std::cout << Solution().lengthOfLongestSubstring(s) << std::endl; }\n`;
    else if (problemId === 'code-2' && languageKey === 'java') harness = `\nclass Main { public static void main(String[] args) throws Exception { java.util.Scanner sc = new java.util.Scanner(System.in); String s = sc.hasNextLine() ? sc.nextLine() : ""; System.out.println(new Solution().lengthOfLongestSubstring(s)); } }\n`;
    else if (problemId === 'code-2' && languageKey === 'c') harness = `\nint main(){ char s[200000]; if(!fgets(s,sizeof(s),stdin)) s[0]='\\0'; s[strcspn(s,"\\n")]=0; printf("%d\\n", lengthOfLongestSubstring(s)); }\n`;
    else if (languageKey === 'cpp') {
      const call = problemId === 'code-1' ? 'Solution().twoSum(nums, value)' : 'Solution().subarraySum(nums, value)';
      harness = `\n#include <iostream>\nint main(){ int n, value; std::cin >> n; std::vector<int> nums(n); for(int& x:nums) std::cin >> x; std::cin >> value; auto out=${call};` +
        (problemId === 'code-1' ? ' std::cout << "["; for(size_t i=0;i<out.size();i++){if(i)std::cout<<",";std::cout<<out[i];} std::cout<<"]\\n";' : ' std::cout << out << "\\n";') + ` }\n`;
    } else if (languageKey === 'java') {
      const call = problemId === 'code-1' ? 'new Solution().twoSum(nums, value)' : 'new Solution().subarraySum(nums, value)';
      harness = `\nclass Main { public static void main(String[] args) { java.util.Scanner sc=new java.util.Scanner(System.in); int n=sc.nextInt(); int[] nums=new int[n]; for(int i=0;i<n;i++) nums[i]=sc.nextInt(); int value=sc.nextInt(); ` +
        (problemId === 'code-1' ? `System.out.println(java.util.Arrays.toString(${call}).replace(" ", ""));` : `System.out.println(${call});`) + ` } }\n`;
    } else {
      const call = problemId === 'code-1' ? 'twoSum(nums,n,value,&outSize)' : 'subarraySum(nums,n,value)';
      harness = `\nint main(){ int n,value; if(scanf("%d",&n)!=1)return 0; int* nums=(int*)malloc(n*sizeof(int)); for(int i=0;i<n;i++)scanf("%d",&nums[i]); scanf("%d",&value); ` +
        (problemId === 'code-1' ? `int outSize=0; int* out=${call}; printf("["); for(int i=0;i<outSize;i++)printf(i?",%d":"%d",out[i]); printf("]\\n"); free(out);` : `printf("%d\\n",${call});`) + ` free(nums); }\n`;
    }
    if (languageKey === 'cpp') harness = harness.replace('#include <iostream>', `#include <iostream>
#include <vector>
using namespace std;`);
    if (languageKey === 'c') harness = harness.replace('int main(){', `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(){`);
  }
  return { sourceCode: `${sourceCode}\n${harness}`, testCases: normalizedCases };
}

async function executeOnJudge0(sourceCode: string, language: string, testCases: Array<{ input: string; expected?: string; hidden?: boolean }>, problemData?: any) {
  const endpoint = process.env.JUDGE0_URL?.replace(/\/$/, '');
  if (!endpoint) throw new Error('Code execution is not configured. Ask your administrator to configure Judge0 CE.');
  const boundedLimit = (value: string | undefined, fallback: number, ceiling: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, ceiling) : fallback;
  };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.JUDGE0_AUTH_TOKEN) headers['X-Auth-Token'] = process.env.JUDGE0_AUTH_TOKEN;
  if (process.env.JUDGE0_AUTH_USER) headers['X-Auth-User'] = process.env.JUDGE0_AUTH_USER;
  const languageId = await getJudge0LanguageId(language, endpoint, headers);
  const preparedProgram = prepareJudgeProgram(sourceCode, language, problemData, testCases);
  sourceCode = preparedProgram.sourceCode;
  testCases = preparedProgram.testCases;
  const results = [];
  const executionDeadline = Date.now() + 30000;
  let executionTimeMs = 0;
  let memoryKb = 0;
  for (const [index, testCase] of testCases.entries()) {
    const remainingMs = executionDeadline - Date.now();
    if (remainingMs <= 0) throw new Error('The coding test suite exceeded its 30 second execution window.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(15000, remainingMs));
    try {
      const createdResponse = await fetch(`${endpoint}/submissions?base64_encoded=false&wait=false`, {
        method: 'POST', headers, signal: controller.signal,
        body: JSON.stringify({ source_code: sourceCode, language_id: languageId, stdin: testCase.input,
          cpu_time_limit: boundedLimit(process.env.JUDGE0_CPU_LIMIT, 2, 5),
          wall_time_limit: boundedLimit(process.env.JUDGE0_WALL_LIMIT, 5, 15),
          memory_limit: boundedLimit(process.env.JUDGE0_MEMORY_LIMIT_KB, 128000, 256000), max_processes_and_or_threads: 20,
          enable_network: false }),
      });
      if (!createdResponse.ok) throw new Error(`Judge0 returned HTTP ${createdResponse.status}.`);
      let result: any = await createdResponse.json();
      for (let poll = 0; (result.status?.id === 1 || result.status?.id === 2) && result.token && poll < 24; poll += 1) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        const statusResponse = await fetch(`${endpoint}/submissions/${encodeURIComponent(result.token)}?base64_encoded=false`, { headers, signal: controller.signal });
        if (!statusResponse.ok) throw new Error(`Judge0 returned HTTP ${statusResponse.status} while collecting results.`);
        result = await statusResponse.json();
      }
      if (result.status?.id === 1 || result.status?.id === 2) throw new Error('Judge0 execution timed out while waiting for the result.');
      const actual = String(result.stdout || '').replace(/\r\n/g, '\n').trimEnd();
      const expected = testCase.expected === undefined ? undefined : String(testCase.expected).replace(/\r\n/g, '\n').trimEnd();
      const comparable = (value: string) => {
        try { return JSON.stringify(JSON.parse(value)); } catch { return value.trim(); }
      };
      const passed = result.status?.id === 3 && (expected === undefined || comparable(actual) === comparable(expected));
      executionTimeMs += Math.round(Number(result.time || 0) * 1000);
      memoryKb = Math.max(memoryKb, Number(result.memory || 0));
      results.push({ testCaseId: index + 1, input: testCase.hidden ? undefined : testCase.input,
        expected: testCase.hidden ? undefined : expected, actual: testCase.hidden ? undefined : actual,
        passed, hidden: Boolean(testCase.hidden), status: result.status?.description || 'Unknown',
        error: testCase.hidden ? undefined : (result.compile_output || result.stderr || result.message || undefined) });
    } finally { clearTimeout(timeout); }
  }
  const passedTestCases = results.filter((result) => result.passed).length;
  return { success: passedTestCases === results.length, score: results.length ? Math.round(passedTestCases / results.length * 100) : 0,
    totalTestCases: results.length, passedTestCases, executionTimeMs, memoryKb, language,
    stdout: `Judge0 executed ${language}. Passed ${passedTestCases}/${results.length} test cases.`, results };
}

// Unauthenticated liveness endpoint for local and future deployment health checks.
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    appName: 'Campus Placement Assessment Portal',
    timestamp: new Date().toISOString(),
    aiConfigured: process.env.AI_EXTERNAL_PROCESSING_ENABLED === 'true' && Boolean(process.env.GEMINI_API_KEY),
  });
});

// Readiness is separate from liveness so an orchestrator can keep the process alive during DB recovery.
app.get('/api/ready', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ready', dependencies: { database: 'ok' }, uptimeSeconds: Math.floor(process.uptime()) });
  } catch {
    res.status(503).json({ status: 'not_ready', dependencies: { database: 'unavailable' } });
  }
});

// Initialize MySQL pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'talentedge',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function ensureWorkspaceAssessments(db: any, workspaceId: string, createdByUserId: string | null = null) {
  const [existing]: any = await db.execute('SELECT id FROM Assessments WHERE workspaceId = ?', [workspaceId]);
  const existingIds = new Set(existing.map((row: { id: string }) => row.id));
  for (const assessment of ASSESSMENTS_CATALOG) {
    const id = `${workspaceId}:${assessment.id}`;
    if (existingIds.has(id)) continue;
    await db.execute(
      `INSERT IGNORE INTO Assessments
       (id, workspaceId, dayNumber, title, type, durationMinutes, totalMarks, coverageJson, purpose, status, scheduledDate, sectionsJson, targetCompaniesJson, createdByUserId, sourceContentId, isCustomized)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [id, workspaceId, assessment.dayNumber, assessment.title, assessment.type,
        assessment.durationMinutes, assessment.totalMarks, JSON.stringify(assessment.coverage), assessment.purpose,
        assessment.status, assessment.scheduledDate, JSON.stringify(assessment.sections),
        JSON.stringify(assessment.targetCompanies), createdByUserId, assessment.id],
    );
  }
}

async function ensureWorkspaceSubscription(db: any, workspaceId: string) {
  await db.execute('INSERT IGNORE INTO WorkspaceSubscriptions (workspaceId) VALUES (?)', [workspaceId]);
}

function getPlanDefinition(planId: string) {
  return SUBSCRIPTION_PLANS.find((plan) => plan.id === planId) || SUBSCRIPTION_PLANS[0];
}

function parseStoredJson<T>(value: unknown, fallback: T): T {
  if (typeof value === 'string') { try { return JSON.parse(value) as T; } catch { return fallback; } }
  return (value as T) || fallback;
}

async function getPlanDefinitionFromDb(db: any, planId: string): Promise<SubscriptionPlanDefinition> {
  const [rows]: any = await db.execute('SELECT id, name, description, limitsJson, featuresJson FROM PlatformSubscriptionPlans WHERE id = ? LIMIT 1', [planId]);
  if (!rows.length) return getPlanDefinition(planId);
  return {
    id: rows[0].id,
    name: rows[0].name,
    description: rows[0].description,
    currency: 'INR',
    monthlyPricePaise: null,
    annualPricePaise: null,
    limits: parseStoredJson<PlanLimit[]>(rows[0].limitsJson, []),
    features: parseStoredJson<PlanFeature[]>(rows[0].featuresJson, []),
  };
}

async function getWorkspaceEntitlementState(db: any, workspaceId: string) {
  const [rows]: any = await db.execute(
    'SELECT planId, status, currentPeriodEnd, trialEndsAt FROM WorkspaceSubscriptions WHERE workspaceId = ? LIMIT 1',
    [workspaceId],
  );
  const subscription = rows[0] || { planId: 'pilot', status: 'not_configured', currentPeriodEnd: null, trialEndsAt: null };
  const plan = await getPlanDefinitionFromDb(db, subscription.planId || 'pilot');
  const now = Date.now();
  const periodExpired = subscription.currentPeriodEnd && new Date(subscription.currentPeriodEnd).getTime() < now;
  const trialExpired = subscription.status === 'trialing' && subscription.trialEndsAt && new Date(subscription.trialEndsAt).getTime() < now;
  return { plan, status: subscription.status || 'not_configured', expired: Boolean(periodExpired || trialExpired) };
}

const permissionFeature: Partial<Record<WorkspacePermission, PlanFeature>> = {
  'curriculum.read_own': 'curriculum', 'curriculum.read_assigned': 'curriculum', 'curriculum.progress.update_own': 'curriculum',
  'curriculum.manage_assigned': 'curriculum', 'curriculum.manage_workspace': 'curriculum',
  'assessment.read_own': 'assessments', 'assessment.read_assigned': 'assessments', 'assessment.submit_own': 'assessments',
  'assessment.manage_assigned': 'assessments', 'assessment.read_workspace': 'assessments', 'assessment.manage_workspace': 'assessments', 'code.execute': 'assessments',
  'batches.read_assigned': 'batches', 'batches.read_workspace': 'batches', 'batches.manage': 'batches',
  'students.read_assigned': 'student_and_trainer_access', 'students.read_workspace': 'student_and_trainer_access',
  'students.enroll': 'student_and_trainer_access', 'students.update_workspace': 'student_and_trainer_access',
  'members.read': 'student_and_trainer_access', 'members.invite': 'student_and_trainer_access', 'members.change_role': 'student_and_trainer_access',
  'members.change_status': 'student_and_trainer_access', 'members.password_reset': 'student_and_trainer_access',
  'interview.read_own': 'interview_feedback', 'interview.history.read_assigned': 'interview_feedback', 'interview.panelist.read_assigned': 'interview_feedback',
  'interview.panelist.evaluate_assigned': 'interview_feedback', 'interview.read_assigned': 'interview_feedback', 'interview.evaluate_assigned': 'interview_feedback',
  'interview.read_workspace': 'interview_feedback', 'interview.evaluate_workspace': 'interview_feedback', 'interview.schedule_workspace': 'interview_feedback',
  'ai.recommendation.own': 'ai_insights', 'ai.readiness.own': 'ai_insights', 'ai.recommendation.assigned': 'ai_insights',
  'ai.readiness.assigned': 'ai_insights', 'ai.recommendation.workspace': 'ai_insights', 'ai.readiness.workspace': 'ai_insights',
  'ai.trainer_summary': 'ai_insights', 'ai.trainer_summary.workspace': 'ai_insights',
  'analytics.read_assigned': 'basic_analytics', 'analytics.read_workspace': 'college_analytics',
  'leaderboard.read_assigned': 'basic_analytics',
  'report.export_assigned': 'standard_exports', 'report.read_workspace': 'standard_exports', 'report.export_workspace': 'standard_exports',
};

async function enforceWorkspaceEntitlements(req: Request, res: Response, auth: AuthContext, permissions: WorkspacePermission[]) {
  const state = await getWorkspaceEntitlementState(pool, auth.workspaceId);
  const allowedPermission = permissions.find((permission) => hasWorkspacePermission(auth.role, permission));
  const feature = allowedPermission ? permissionFeature[allowedPermission] : undefined;
  if (!state.plan.features.includes('college_workspace') || (feature && !state.plan.features.includes(feature))) {
    res.status(403).json({ code: 'PLAN_FEATURE_UNAVAILABLE', feature: feature || 'college_workspace', plan: state.plan.name, error: `${state.plan.name} does not include ${feature ? feature.replaceAll('_', ' ') : 'workspace access'}. Contact TalentEdge to discuss a plan change.` });
    return false;
  }
  const accountAccess = allowedPermission === 'subscription.read' || allowedPermission === 'subscription.manage' || allowedPermission === 'profile.read_own' || allowedPermission === 'billing.manage';
  if (!accountAccess && (state.expired || ['canceled', 'suspended'].includes(state.status))) {
    res.status(403).json({ code: 'SUBSCRIPTION_INACTIVE', status: state.status, error: 'This workspace subscription is inactive or expired. Contact your college administrator.' });
    return false;
  }
  if (!accountAccess && state.status === 'past_due' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) {
    res.status(403).json({ code: 'SUBSCRIPTION_PAST_DUE', error: 'Workspace changes are paused while the subscription is past due. Contact your college administrator.' });
    return false;
  }
  return true;
}

function requireWorkspaceFeature(feature: PlanFeature) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = (req as AuthenticatedRequest).auth;
    const check = async () => {
      const session = (req as AuthenticatedRequest).auth;
      if (!session) return res.status(401).json({ error: 'Authentication required' });
      const state = await getWorkspaceEntitlementState(pool, session.workspaceId);
      if (!state.plan.features.includes(feature)) return res.status(403).json({ code: 'PLAN_FEATURE_UNAVAILABLE', feature, plan: state.plan.name, error: `${state.plan.name} does not include ${feature.replaceAll('_', ' ')}.` });
      next();
    };
    if (auth) void check().catch((error) => { console.error('Subscription entitlement check failed:', error); res.status(500).json({ error: 'Could not verify workspace subscription entitlements.' }); });
    else authenticate(req, res, () => { void check().catch((error) => { console.error('Subscription entitlement check failed:', error); res.status(500).json({ error: 'Could not verify workspace subscription entitlements.' }); }); });
  };
}

async function getWorkspaceLimitState(db: any, workspaceId: string, key: PlanLimitKey) {
  const [subscriptionRows]: any = await db.execute('SELECT planId FROM WorkspaceSubscriptions WHERE workspaceId = ? LIMIT 1', [workspaceId]);
  const plan = await getPlanDefinitionFromDb(db, subscriptionRows[0]?.planId || 'pilot');
  const limit = plan.limits.find((item) => item.key === key)?.value ?? null;
  let usage = 0;
  if (key === 'active_students' || key === 'trainer_seats') {
    const [rows]: any = await db.execute(
      `SELECT COUNT(*) AS activeCount FROM WorkspaceMemberships
       WHERE workspaceId = ? AND ${key === 'active_students' ? "role = 'student'" : "role IN ('trainer', 'panelist')"} AND status = 'active'`,
      [workspaceId],
    );
    usage = Number(rows[0]?.activeCount || 0);
  } else if (key === 'active_batches') {
    const [rows]: any = await db.execute('SELECT COUNT(*) AS usageCount FROM Batches WHERE workspaceId = ? AND isArchived = 0', [workspaceId]);
    usage = Number(rows[0]?.usageCount || 0);
  }
  return { plan, limit, usage, key };
}

function planLimitResponse(state: Awaited<ReturnType<typeof getWorkspaceLimitState>>) {
  const names: Record<PlanLimitKey, string> = {
    active_students: 'active student', trainer_seats: 'trainer seat', active_batches: 'active batch', ai_credits_per_period: 'AI credit',
  };
  return {
    code: 'PLAN_LIMIT_REACHED',
    limitKey: state.key,
    current: state.usage,
    limit: state.limit,
    plan: state.plan.name,
    error: `This workspace has reached its ${state.plan.name} ${names[state.key]} limit (${state.limit}). Free capacity or contact TalentEdge to discuss a plan change.`,
  };
}

async function getWorkspaceAiPeriodStart(db: any, workspaceId: string) {
  const [rows]: any = await db.execute('SELECT currentPeriodStart FROM WorkspaceSubscriptions WHERE workspaceId = ? LIMIT 1', [workspaceId]);
  const periodStart = rows[0]?.currentPeriodStart ? new Date(rows[0].currentPeriodStart) : new Date();
  if (!rows[0]?.currentPeriodStart) periodStart.setDate(1);
  return periodStart.toISOString().slice(0, 10);
}

async function reserveWorkspaceAiCredit(workspaceId: string) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [subscriptions]: any = await connection.execute('SELECT planId, status, currentPeriodEnd, trialEndsAt FROM WorkspaceSubscriptions WHERE workspaceId = ? FOR UPDATE', [workspaceId]);
    const subscription = subscriptions[0] || { planId: 'pilot', status: 'not_configured', currentPeriodEnd: null, trialEndsAt: null };
    const plan = await getPlanDefinitionFromDb(connection, subscription.planId || 'pilot');
    const now = Date.now();
    if (['canceled', 'suspended', 'past_due'].includes(subscription.status)
      || (subscription.currentPeriodEnd && new Date(subscription.currentPeriodEnd).getTime() < now)
      || (subscription.status === 'trialing' && subscription.trialEndsAt && new Date(subscription.trialEndsAt).getTime() < now)) {
      await connection.rollback();
      return { allowed: false as const, message: 'AI processing is unavailable while this workspace subscription is inactive or past due.' };
    }
    if (!plan.features.includes('ai_insights')) {
      await connection.rollback();
      return { allowed: false as const, message: `${plan.name} does not include AI insights. Contact TalentEdge to discuss a plan change.` };
    }
    const limit = plan.limits.find((item) => item.key === 'ai_credits_per_period')?.value ?? null;
    if (limit === null) {
      await connection.rollback();
      return { allowed: false as const, message: 'AI credit allowance is not configured for this workspace.' };
    }
    const periodStart = await getWorkspaceAiPeriodStart(connection, workspaceId);
    await connection.execute('INSERT IGNORE INTO WorkspaceAiUsage (workspaceId, periodStart, creditsUsed) VALUES (?, ?, 0)', [workspaceId, periodStart]);
    const [usageRows]: any = await connection.execute('SELECT creditsUsed FROM WorkspaceAiUsage WHERE workspaceId = ? AND periodStart = ? FOR UPDATE', [workspaceId, periodStart]);
    if (Number(usageRows[0]?.creditsUsed || 0) >= limit) {
      await connection.rollback();
      return { allowed: false as const, message: `${plan.name} AI credit limit (${limit}) has been reached for this billing period.` };
    }
    await connection.execute('UPDATE WorkspaceAiUsage SET creditsUsed = creditsUsed + 1 WHERE workspaceId = ? AND periodStart = ?', [workspaceId, periodStart]);
    await connection.commit();
    return { allowed: true as const, periodStart };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function releaseWorkspaceAiCredit(workspaceId: string, periodStart: string) {
  await pool.execute('UPDATE WorkspaceAiUsage SET creditsUsed = GREATEST(creditsUsed - 1, 0) WHERE workspaceId = ? AND periodStart = ?', [workspaceId, periodStart]);
}

async function generateWithWorkspaceAi<T>(workspaceId: string, generate: () => Promise<T>) {
  const reservation = await reserveWorkspaceAiCredit(workspaceId);
  if (!reservation.allowed) return { allowed: false as const, message: reservation.message };
  try {
    return { allowed: true as const, response: await generate() };
  } catch (error) {
    await releaseWorkspaceAiCredit(workspaceId, reservation.periodStart);
    throw error;
  }
}

function serializeAssessment(row: any, hideAnswerKey = false) {
  const sections = JSON.parse(row.sectionsJson || '[]');
  if (hideAnswerKey) {
    for (const section of sections) {
      for (const question of section.questions || []) {
        if (question.type === 'mcq' && question.data) {
          delete question.data.correctIndex;
          delete question.data.explanation;
        }
        if (question.type === 'coding' && question.data) {
          question.data.testCases = (question.data.testCases || []).filter((testCase: any) => !testCase.hidden);
        }
      }
    }
  }
  const { sectionsJson: _sectionsJson, coverageJson: _coverageJson, targetCompaniesJson: _targetCompaniesJson, ...safeRow } = row;
  return {
    ...safeRow,
    coverage: JSON.parse(row.coverageJson || '[]'),
    sections,
    targetCompanies: JSON.parse(row.targetCompaniesJson || '[]'),
  };
}

async function saveAssessmentVersion(db: any, assessment: any, actorUserId: string | null, changeSummary: string) {
  const versionNumber = Number(assessment.currentVersion || 1);
  await db.execute(
    `INSERT IGNORE INTO AssessmentVersions
     (id, workspaceId, assessmentId, versionNumber, snapshotJson, changeSummary, createdByUserId)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), assessment.workspaceId, assessment.id, versionNumber,
      JSON.stringify(serializeAssessment(assessment)), changeSummary, actorUserId],
  );
}

function normalizeAssessmentDate(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return undefined;
  return value.includes('T') ? `${value.replace('T', ' ')}${value.length === 16 ? ':00' : ''}` : value;
}

function validateAssessmentSections(parsedSections: any): { error?: string; totalMarks: number; hasCoding: boolean } {
  if (!Array.isArray(parsedSections) || parsedSections.length < 1 || parsedSections.length > 20
    || parsedSections.some((section: any) => !section || typeof section.name !== 'string'
      || !Array.isArray(section.questions) || section.questions.length > 100)) {
    return { error: 'Add at least one valid section containing questions.', totalMarks: 0, hasCoding: false };
  }
  let totalMarks = 0;
  let questionCount = 0;
  let codingCount = 0;
  for (const section of parsedSections) {
    if (typeof section.id !== 'string' || !section.id || !section.name.trim()) {
      return { error: 'Every section needs an id and name.', totalMarks: 0, hasCoding: false };
    }
    for (const question of section.questions) {
      questionCount += 1;
      if (questionCount > 100) return { error: 'An assessment can contain at most 100 questions.', totalMarks: 0, hasCoding: false };
      const data = question?.data;
      if (question?.type === 'mcq') {
        if (!data || typeof data.text !== 'string' || !data.text.trim() || !Array.isArray(data.options)
          || data.options.length < 2 || data.options.length > 8
          || data.options.some((option: any) => typeof option !== 'string')
          || !Number.isInteger(data.correctIndex) || data.correctIndex < 0 || data.correctIndex >= data.options.length
          || !Number.isFinite(data.marks) || data.marks < 1 || data.marks > 100) {
          return { error: 'Each multiple-choice question needs a prompt, 2–8 options, a correct option, and marks from 1 to 100.', totalMarks: 0, hasCoding: false };
        }
        totalMarks += data.marks;
      } else if (question?.type === 'coding') {
        codingCount += 1;
        if (codingCount > 3) return { error: 'An assessment can contain at most 3 coding questions.', totalMarks: 0, hasCoding: false };
        if (!data || typeof data.title !== 'string' || !data.title.trim()
          || typeof data.description !== 'string' || !data.description.trim()
          || !Array.isArray(data.testCases) || data.testCases.length < 1 || data.testCases.length > 10
          || data.testCases.some((testCase: any) => typeof testCase.input !== 'string' || testCase.input.length > 20000
            || typeof testCase.expected !== 'string' || testCase.expected.length > 20000
            || (testCase.hidden !== undefined && typeof testCase.hidden !== 'boolean'))
          || !Number.isFinite(data.marks ?? 30) || (data.marks ?? 30) < 1 || (data.marks ?? 30) > 100
          || !data.templates || typeof data.templates !== 'object'
          || Object.values(data.templates).every((template: any) => typeof template !== 'string')) {
          return { error: 'Each coding question needs instructions, 1–10 input/output test cases, at least one starter template, and valid marks.', totalMarks: 0, hasCoding: false };
        }
        totalMarks += data.marks ?? 30;
      } else return { error: 'Question type must be multiple choice or coding.', totalMarks: 0, hasCoding: false };
    }
  }
  if (!totalMarks) return { error: 'Add at least one question to the assessment.', totalMarks: 0, hasCoding: false };
  return { totalMarks, hasCoding: codingCount > 0 };
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

type AccountEmailType = 'workspace_invitation' | 'college_admin_invitation' | 'platform_admin_invitation' | 'password_reset' | 'mfa_reset' | 'account_notice';
type AccountEmailStatus = 'sent' | 'failed' | 'not_configured';

function escapeEmailHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function getPublicAppBaseUrl(req: Request) {
  const configured = process.env.PUBLIC_APP_URL || process.env.APP_URL;
  if (configured && !configured.includes('MY_APP_URL')) {
    try { const url = new URL(configured); if (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return url.origin; } catch { /* use local fallback only outside production */ }
  }
  if (process.env.NODE_ENV === 'production') return null;
  return `${req.protocol}://${req.get('host')}`;
}

async function reserveAccountEmailRateLimit(workspaceId: string | null, email: string, type: AccountEmailType, clientIp: string) {
  const scope = workspaceId || 'platform';
  const now = Date.now();
  const buckets = [
    { key: `recipient:${scope}:${type}:${email.trim().toLowerCase()}`, limit: 5, windowSeconds: 3600 },
    { key: `ip:${scope}:${type}:${clientIp || 'unknown'}`, limit: 20, windowSeconds: 3600 },
    { key: `workspace:${scope}:${type}`, limit: 100, windowSeconds: 3600 },
  ].map((bucket) => ({ ...bucket, hash: createHash('sha256').update(bucket.key).digest('hex') }));
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const bucket of buckets) {
      await connection.execute('INSERT IGNORE INTO AccountEmailRateLimits (bucketKey, windowStartedAt, requestCount) VALUES (?, UTC_TIMESTAMP(), 0)', [bucket.hash]);
      const [[row]]: any = await connection.execute('SELECT requestCount, TIMESTAMPDIFF(SECOND, windowStartedAt, UTC_TIMESTAMP()) AS ageSeconds FROM AccountEmailRateLimits WHERE bucketKey = ? FOR UPDATE', [bucket.hash]);
      const expired = Number(row.ageSeconds) >= bucket.windowSeconds;
      if (!expired && Number(row.requestCount) >= bucket.limit) { await connection.rollback(); return false; }
      await connection.execute(
        'UPDATE AccountEmailRateLimits SET windowStartedAt = IF(? = 1, UTC_TIMESTAMP(), windowStartedAt), requestCount = IF(? = 1, 1, requestCount + 1) WHERE bucketKey = ?',
        [expired ? 1 : 0, expired ? 1 : 0, bucket.hash],
      );
    }
    await connection.commit();
    return true;
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

async function deliverAccountEmail(input: {
  workspaceId: string | null; recipientEmail: string; type: AccountEmailType; relatedEntityId?: string | null;
  subject: string; text: string; html: string; baseUrlConfigured: boolean; forcedError?: string;
}): Promise<{ id: string; status: AccountEmailStatus }> {
  const id = randomUUID();
  const apiKey = process.env.RESEND_API_KEY || '';
  const from = process.env.EMAIL_FROM || '';
  let status: AccountEmailStatus = 'not_configured';
  let providerMessageId: string | null = null;
  let lastError: string | null = null;
  if (input.forcedError) {
    status = 'failed'; lastError = input.forcedError;
  } else if (!apiKey || !from || !input.baseUrlConfigured) {
    lastError = !apiKey ? 'RESEND_API_KEY is not configured.' : !from ? 'EMAIL_FROM is not configured.' : 'PUBLIC_APP_URL is required for production email links.';
  } else {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': id },
        body: JSON.stringify({ from, to: [input.recipientEmail], subject: input.subject, text: input.text, html: input.html }),
        signal: AbortSignal.timeout(10000),
      });
      const result: any = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`Resend rejected the message (HTTP ${response.status}).`);
      status = 'sent'; providerMessageId = typeof result.id === 'string' ? result.id : null;
    } catch (error) {
      status = 'failed'; lastError = error instanceof Error ? error.message.slice(0, 490) : 'Email provider request failed.';
    }
  }
  try {
    await pool.execute(
      `INSERT INTO AccountEmailDeliveries (id, workspaceId, recipientEmail, deliveryType, relatedEntityId, status, providerMessageId, lastError, sentAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, IF(? = 'sent', UTC_TIMESTAMP(), NULL))`,
      [id, input.workspaceId, input.recipientEmail.trim().toLowerCase(), input.type, input.relatedEntityId || null, status, providerMessageId, lastError, status],
    );
  } catch (error) {
    console.error('Could not persist account email delivery status:', error);
  }
  return { id, status };
}

async function sendAccountLifecycleEmail(req: Request, input: {
  workspaceId: string | null; recipientEmail: string; recipientName?: string; type: AccountEmailType;
  relatedEntityId?: string | null; heading: string; message: string; actionLabel?: string; actionUrl?: string; expiry?: string;
  rateLimitReserved?: boolean;
}) {
  let allowed = Boolean(input.rateLimitReserved);
  let forcedError: string | undefined;
  if (!allowed) {
    try { allowed = await reserveAccountEmailRateLimit(input.workspaceId, input.recipientEmail, input.type, req.ip); }
    catch (error) { console.error('Account email rate limit could not be checked:', error); forcedError = 'Email rate limiting is unavailable; message was not sent.'; }
    if (!allowed && !forcedError) forcedError = 'Email delivery rate limit exceeded.';
  }
  const baseUrl = getPublicAppBaseUrl(req);
  const safeHeading = escapeEmailHtml(input.heading);
  const safeName = escapeEmailHtml(input.recipientName || '');
  const safeMessage = escapeEmailHtml(input.message);
  const safeAction = escapeEmailHtml(input.actionLabel || 'Continue');
  const link = input.actionUrl && baseUrl ? new URL(input.actionUrl, baseUrl).toString() : null;
  const safeLink = link ? escapeEmailHtml(link) : null;
  const subject = input.heading;
  const text = `${input.recipientName ? `Hello ${input.recipientName},\n\n` : ''}${input.message}${link ? `\n\n${input.actionLabel || 'Continue'}: ${link}` : ''}${input.expiry ? `\n\n${input.expiry}` : ''}\n\nTalentEdge`;
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a"><div style="max-width:560px;margin:32px auto;padding:32px;background:#fff;border-radius:16px"><p style="font-size:12px;font-weight:bold;letter-spacing:2px;color:#4f46e5">TALENTEDGE</p><h1 style="font-size:22px">${safeHeading}</h1>${safeName ? `<p>Hello ${safeName},</p>` : ''}<p style="line-height:1.6">${safeMessage}</p>${safeLink ? `<p style="margin:28px 0"><a href="${safeLink}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold">${safeAction}</a></p><p style="font-size:12px;color:#64748b;word-break:break-all">If the button does not work, open: ${safeLink}</p>` : ''}${input.expiry ? `<p style="font-size:12px;color:#64748b">${escapeEmailHtml(input.expiry)}</p>` : ''}<hr style="border:0;border-top:1px solid #e2e8f0;margin:24px 0"><p style="font-size:11px;color:#64748b">If you did not expect this message, contact your college administrator.</p></div></body></html>`;
  return deliverAccountEmail({ workspaceId: input.workspaceId, recipientEmail: input.recipientEmail, type: input.type, relatedEntityId: input.relatedEntityId, subject, text, html, baseUrlConfigured: Boolean(baseUrl), forcedError });
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

async function verifyPassword(password: string, encoded: string | null) {
  if (!encoded) return false;
  const [algorithm, salt, hash] = encoded.split('$');
  if (algorithm !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function readCookie(req: Request, name: string) {
  const cookies = req.headers.cookie?.split(';') || [];
  const entry = cookies.map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
}

function setSessionCookie(res: Response, token: string) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`,
  );
}

function clearSessionCookie(res: Response) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

function setPlatformSessionCookie(res: Response, token: string) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${PLATFORM_SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${PLATFORM_SESSION_HOURS * 3600}${secure}`);
}

function clearPlatformSessionCookie(res: Response) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${PLATFORM_SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${secure}`);
}

async function createPlatformSession(platformAdminId: string, res: Response) {
  const token = randomBytes(32).toString('base64url');
  await pool.execute(
    'INSERT INTO PlatformAdminSessions (id, platformAdminId, tokenHash, expiresAt) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? HOUR))',
    [randomUUID(), platformAdminId, hashToken(token), PLATFORM_SESSION_HOURS],
  );
  setPlatformSessionCookie(res, token);
}

async function requirePlatformAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const token = readCookie(req, PLATFORM_SESSION_COOKIE);
    if (!token) return res.status(401).json({ error: 'Platform administrator sign-in required.' });
    const [rows]: any = await pool.execute(
      `SELECT s.id AS sessionId, a.id AS platformAdminId, a.name, a.email
       FROM PlatformAdminSessions s JOIN PlatformAdminAccounts a ON a.id = s.platformAdminId
       WHERE s.tokenHash = ? AND s.expiresAt > UTC_TIMESTAMP() AND a.isActive = 1 LIMIT 1`,
      [hashToken(token)],
    );
    if (!rows.length) { clearPlatformSessionCookie(res); return res.status(401).json({ error: 'Platform session expired or access was revoked.' }); }
    (req as PlatformAuthenticatedRequest).platformAuth = rows[0] as PlatformAuthContext;
    next();
  } catch (error) {
    console.error('Platform authentication lookup failed:', error);
    res.status(500).json({ error: 'Platform authentication service unavailable.' });
  }
}

function validEmail(email: unknown): email is string {
  return typeof email === 'string' && email.length <= 191 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validPassword(password: unknown): password is string {
  return typeof password === 'string' && password.length >= 12 && password.length <= 256;
}

async function createSession(userId: string, workspaceId: string, res: Response) {
  const token = randomBytes(32).toString('base64url');
  const id = randomUUID();
  await pool.execute(
    'INSERT INTO AuthSessions (id, userId, workspaceId, tokenHash, expiresAt) VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY))',
    [id, userId, workspaceId, hashToken(token), SESSION_DAYS],
  );
  setSessionCookie(res, token);
}

async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) return res.status(401).json({ error: 'Sign in required' });
    const [rows]: any = await pool.execute(
      `SELECT s.id AS sessionId, u.id AS userId, u.name, u.email, u.avatar,
              w.id AS workspaceId, w.name AS workspaceName, w.lifecycleStatus, wm.role
       FROM AuthSessions s
       JOIN Users u ON u.id = s.userId AND u.isActive = 1
       JOIN Workspaces w ON w.id = s.workspaceId
       JOIN WorkspaceMemberships wm ON wm.userId = u.id AND wm.workspaceId = w.id AND wm.status = 'active'
       WHERE s.tokenHash = ? AND s.expiresAt > UTC_TIMESTAMP() LIMIT 1`,
      [hashToken(token)],
    );
    if (!rows.length) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Session expired or account access was revoked' });
    }
    if (['suspended', 'archived'].includes(rows[0].lifecycleStatus)) {
      clearSessionCookie(res);
      return res.status(403).json({ error: `This college workspace is ${rows[0].lifecycleStatus}. Contact your college administrator.` });
    }
    (req as AuthenticatedRequest).auth = rows[0] as AuthContext;
    next();
  } catch (error) {
    console.error('Authentication lookup failed:', error);
    res.status(500).json({ error: 'Authentication service unavailable' });
  }
}

function requireWorkspacePermission(...permissions: WorkspacePermission[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = (req as AuthenticatedRequest).auth;
    const authorize = () => {
      const session = (req as AuthenticatedRequest).auth;
      if (!session || !permissions.some((permission) => hasWorkspacePermission(session.role, permission))) {
        return res.status(403).json({ error: 'Insufficient workspace permissions' });
      }
      void enforceWorkspaceEntitlements(req, res, session, permissions)
        .then((allowed) => { if (allowed) next(); })
        .catch((error) => { console.error('Subscription entitlement check failed:', error); res.status(500).json({ error: 'Could not verify workspace subscription entitlements.' }); });
    };
    if (auth) return authorize();
    return authenticate(req, res, authorize);
  };
}

function requirePlatformPermission(permission: WorkspacePermission) {
  return (req: Request, res: Response, next: NextFunction) => requirePlatformAdmin(req, res, () => {
    if (!hasPlatformPermission('platform_admin', permission)) return res.status(403).json({ error: 'Insufficient platform permissions.' });
    next();
  });
}

async function canAccessStudent(auth: AuthContext, studentId: unknown): Promise<boolean> {
  if (typeof studentId !== 'string' || !studentId) return false;
  if (auth.role === 'student') return auth.userId === studentId;
  if (auth.role !== 'college_admin' && auth.role !== 'trainer') return false;
  const [rows]: any = await pool.execute(
    `SELECT 1 FROM WorkspaceMemberships wm
     LEFT JOIN WorkspaceStudentProfiles sp ON sp.workspaceId = wm.workspaceId AND sp.userId = wm.userId
     WHERE wm.workspaceId = ? AND wm.userId = ? AND wm.role = 'student' AND wm.status = 'active'
       AND (? = 'college_admin' OR EXISTS (
         SELECT 1 FROM WorkspaceBatchAssignments ba
         WHERE ba.workspaceId = wm.workspaceId AND ba.batchId = sp.batchId AND ba.trainerUserId = ?
       )) LIMIT 1`,
    [auth.workspaceId, studentId, auth.role, auth.userId],
  );
  return rows.length > 0;
}

// Public account routes: setup, sign-in, invitation acceptance and sign-out.
app.get('/api/auth/bootstrap-status', async (_req, res) => {
  const registrationEnabled = process.env.ALLOW_WORKSPACE_REGISTRATION === 'true';
  try {
    const [workspaces]: any = await pool.query('SELECT name FROM Workspaces ORDER BY createdAt LIMIT 1');
    const [accounts]: any = await pool.query('SELECT COUNT(*) AS count FROM Users WHERE passwordHash IS NOT NULL AND isActive = 1');
    res.json({
      enabled: Boolean(process.env.AUTH_BOOTSTRAP_TOKEN) && Number(accounts[0].count) === 0,
      registrationEnabled,
      workspaceName: workspaces[0]?.name || '',
    });
  } catch {
    res.json({ enabled: Boolean(process.env.AUTH_BOOTSTRAP_TOKEN), registrationEnabled, workspaceName: '' });
  }
});

app.post('/api/auth/register-workspace', async (req, res) => {
  const registrationEnabled = process.env.ALLOW_WORKSPACE_REGISTRATION === 'true';
  if (!registrationEnabled) return res.status(403).json({ error: 'College self-registration is disabled.' });
  const { workspaceName, name, email, password } = req.body || {};
  if (typeof workspaceName !== 'string' || workspaceName.trim().length < 2 || workspaceName.length > 191 || typeof name !== 'string' || name.trim().length < 2 || name.length > 191 || !validEmail(email) || !validPassword(password)) {
    return res.status(400).json({ error: 'Enter a college name, your full name, a valid email, and a password with at least 12 characters.' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const workspaceId = randomUUID();
    const collegeName = workspaceName.trim();
    const slug = `${collegeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 150) || 'college'}-${workspaceId.slice(0, 8)}`;
    const userId = randomUUID();
    const passwordHash = await hashPassword(password);
    await connection.execute('INSERT INTO Workspaces (id, name, slug) VALUES (?, ?, ?)', [workspaceId, collegeName, slug]);
    await ensureWorkspaceSubscription(connection, workspaceId);
    await connection.execute(
      'INSERT INTO Users (id, name, email, role, avatar, passwordHash, isActive) VALUES (?, ?, ?, \'admin\', \'\', ?, 1)',
      [userId, name.trim(), email.toLowerCase(), passwordHash],
    );
    await connection.execute(
      'INSERT INTO WorkspaceMemberships (id, workspaceId, userId, role) VALUES (?, ?, ?, \'college_admin\')',
      [randomUUID(), workspaceId, userId],
    );
    await ensureWorkspaceAssessments(connection, workspaceId, userId);
    await connection.execute(
      'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, targetUserId) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), workspaceId, userId, 'workspace.registered', userId],
    );
    await connection.commit();
    await createSession(userId, workspaceId, res);
    res.status(201).json({ success: true });
  } catch (error: any) {
    await connection.rollback();
    if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'An account with this email already exists.' });
    console.error('Workspace registration failed:', error);
    res.status(500).json({ error: 'Could not create the college workspace.' });
  } finally {
    connection.release();
  }
});

app.post('/api/auth/bootstrap', async (req, res) => {
  const { bootstrapToken, workspaceName, name, email, password } = req.body || {};
  const configuredToken = process.env.AUTH_BOOTSTRAP_TOKEN;
  if (!configuredToken) return res.status(403).json({ error: 'Local account setup is disabled. Configure AUTH_BOOTSTRAP_TOKEN.' });
  const supplied = Buffer.from(typeof bootstrapToken === 'string' ? bootstrapToken : '');
  const expected = Buffer.from(configuredToken);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return res.status(403).json({ error: 'Invalid setup token' });
  }
  if (typeof name !== 'string' || name.trim().length < 2 || name.length > 191 || !validEmail(email) || !validPassword(password)) {
    return res.status(400).json({ error: 'Enter your name, a valid email, and a password with at least 12 characters.' });
  }
  try {
    const connection = await pool.getConnection();
    try {
      const [lockRows]: any = await connection.query("SELECT GET_LOCK('talentedge_initial_admin', 10) AS acquired");
      if (Number(lockRows[0]?.acquired) !== 1) return res.status(503).json({ error: 'Initial account setup is busy. Try again shortly.' });
      await connection.beginTransaction();
      const [accounts]: any = await connection.query('SELECT id FROM Users WHERE passwordHash IS NOT NULL AND isActive = 1 LIMIT 1 FOR UPDATE');
      if (accounts.length > 0) {
        await connection.rollback();
        return res.status(409).json({ error: 'Initial account setup has already been completed.' });
      }
      const [workspaces]: any = await connection.query('SELECT id FROM Workspaces ORDER BY createdAt LIMIT 1 FOR UPDATE');
      let workspaceId = workspaces[0]?.id;
      if (!workspaceId) {
        const rawName = typeof workspaceName === 'string' && workspaceName.trim().length >= 2
          ? workspaceName.trim().slice(0, 191)
          : 'My College';
        workspaceId = randomUUID();
        const slug = `${rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 150) || 'college'}-${workspaceId.slice(0, 8)}`;
        await connection.execute('INSERT INTO Workspaces (id, name, slug) VALUES (?, ?, ?)', [workspaceId, rawName, slug]);
        await ensureWorkspaceSubscription(connection, workspaceId);
      } else if (typeof workspaceName === 'string' && workspaceName.trim().length >= 2) {
        await connection.execute('UPDATE Workspaces SET name = ? WHERE id = ?', [workspaceName.trim().slice(0, 191), workspaceId]);
      }
      const userId = randomUUID();
      const passwordHash = await hashPassword(password);
      await connection.execute(
        'INSERT INTO Users (id, name, email, role, avatar, passwordHash, isActive) VALUES (?, ?, ?, \'admin\', \'\', ?, 1)',
        [userId, name.trim(), email.toLowerCase(), passwordHash],
      );
      await connection.execute(
        'INSERT INTO WorkspaceMemberships (id, workspaceId, userId, role) VALUES (?, ?, ?, \'college_admin\')',
        [randomUUID(), workspaceId, userId],
      );
      await ensureWorkspaceAssessments(connection, workspaceId, userId);
      await connection.execute(
        'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, targetUserId) VALUES (?, ?, ?, ?, ?)',
        [randomUUID(), workspaceId, userId, 'workspace.bootstrap.completed', userId],
      );
      await connection.commit();
      await createSession(userId, workspaceId, res);
      res.status(201).json({ success: true });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      await connection.query("SELECT RELEASE_LOCK('talentedge_initial_admin')").catch(() => undefined);
      connection.release();
    }
  } catch (error: any) {
    if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'An account with this email already exists.' });
    console.error('Bootstrap failed:', error);
    res.status(500).json({ error: 'Could not create the initial college administrator.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password, workspaceId } = req.body || {};
  if (!validEmail(email) || typeof password !== 'string') return res.status(400).json({ error: 'Enter a valid email and password.' });
  const attemptKey = `${req.ip}:${email.toLowerCase()}`;
  const previous = loginFailures.get(attemptKey);
  if (previous && previous.expiresAt > Date.now() && previous.count >= 8) {
    return res.status(429).json({ error: 'Too many sign-in attempts. Wait 15 minutes and try again.' });
  }
  try {
    const [users]: any = await pool.execute(
      'SELECT id, passwordHash, isActive FROM Users WHERE email = ? LIMIT 1',
      [email.toLowerCase()],
    );
    const user = users[0];
    if (!user || !user.isActive || !(await verifyPassword(password, user.passwordHash))) {
      const activeAttempt = previous && previous.expiresAt > Date.now() ? previous : { count: 0, expiresAt: Date.now() + 15 * 60 * 1000 };
      loginFailures.set(attemptKey, { count: activeAttempt.count + 1, expiresAt: activeAttempt.expiresAt });
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    const [memberships]: any = await pool.execute(
      `SELECT wm.workspaceId, w.name AS workspaceName, w.lifecycleStatus
       FROM WorkspaceMemberships wm JOIN Workspaces w ON w.id = wm.workspaceId
       WHERE wm.userId = ? AND wm.status = 'active' ORDER BY w.name`,
      [user.id],
    );
    const membership = memberships.find((item: any) => !workspaceId || item.workspaceId === workspaceId);
    if (!membership) return res.status(403).json({ error: 'No active college workspace is assigned to this account.' });
    if (['suspended', 'archived'].includes(membership.lifecycleStatus)) return res.status(403).json({ error: `This college workspace is ${membership.lifecycleStatus}. Contact your college administrator.` });
    loginFailures.delete(attemptKey);
    await createSession(user.id, membership.workspaceId, res);
    res.json({ success: true });
  } catch (error) {
    console.error('Sign-in failed:', error);
    res.status(500).json({ error: 'Could not sign in right now.' });
  }
});

app.post('/api/auth/accept-invitation', async (req, res) => {
  const { token, name, password } = req.body || {};
  if (typeof token !== 'string' || token.length < 32 || typeof name !== 'string' || name.trim().length < 2 || !validPassword(password)) {
    return res.status(400).json({ error: 'Invitation, name, or password is invalid. Passwords must be at least 12 characters.' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [invitations]: any = await connection.execute(
      `SELECT * FROM WorkspaceInvitations
       WHERE tokenHash = ? AND acceptedAt IS NULL AND expiresAt > UTC_TIMESTAMP() LIMIT 1 FOR UPDATE`,
      [hashToken(token)],
    );
    const invitation = invitations[0];
    if (!invitation) {
      await connection.rollback();
      return res.status(400).json({ error: 'This invitation is invalid or has expired.' });
    }
    await connection.execute('SELECT id FROM Workspaces WHERE id = ? FOR UPDATE', [invitation.workspaceId]);
    const entitlement = await getWorkspaceEntitlementState(connection, invitation.workspaceId);
    const requiredFeature: PlanFeature = invitation.role === 'panelist' ? 'interview_feedback' : 'student_and_trainer_access';
    if (entitlement.expired || ['canceled', 'suspended', 'past_due'].includes(entitlement.status) || !entitlement.plan.features.includes(requiredFeature)) {
      await connection.rollback();
      return res.status(409).json({ code: 'SUBSCRIPTION_ENTITLEMENT_REQUIRED', error: 'This workspace cannot accept invitations under its current subscription. Ask the college administrator to review the plan and status.' });
    }
    if (invitation.role === 'student' || invitation.role === 'trainer' || invitation.role === 'panelist') {
      const key: PlanLimitKey = invitation.role === 'student' ? 'active_students' : 'trainer_seats';
      const capacity = await getWorkspaceLimitState(connection, invitation.workspaceId, key);
      if (capacity.limit !== null && capacity.usage >= capacity.limit) {
        await connection.rollback();
        return res.status(409).json({ ...planLimitResponse(capacity), error: 'This invitation cannot be accepted because the workspace has no available plan capacity. Ask the college administrator to free a seat or contact TalentEdge.' });
      }
    }
    const [users]: any = await connection.execute('SELECT id, passwordHash FROM Users WHERE email = ? LIMIT 1 FOR UPDATE', [invitation.email]);
    let userId = users[0]?.id;
    if (!userId) {
      userId = randomUUID();
      const passwordHash = await hashPassword(password);
      const legacyRole = invitation.role === 'college_admin' ? 'admin' : invitation.role === 'panelist' ? 'trainer' : invitation.role;
      await connection.execute(
        'INSERT INTO Users (id, name, email, role, avatar, passwordHash, isActive) VALUES (?, ?, ?, ?, \'\', ?, 1)',
        [userId, name.trim(), invitation.email, legacyRole, passwordHash],
      );
    } else if (!users[0].passwordHash) {
      const passwordHash = await hashPassword(password);
      await connection.execute('UPDATE Users SET name = ?, passwordHash = ?, isActive = 1 WHERE id = ?', [name.trim(), passwordHash, userId]);
    }
    await connection.execute(
      `INSERT INTO WorkspaceMemberships (id, workspaceId, userId, role, status)
       VALUES (?, ?, ?, ?, 'active')
       ON DUPLICATE KEY UPDATE role = VALUES(role), status = 'active'`,
      [randomUUID(), invitation.workspaceId, userId, invitation.role],
    );
    if (invitation.role === 'panelist') {
      await connection.execute(
        `UPDATE WorkspaceInterviewPanelists SET userId = ?
         WHERE workspaceId = ? AND LOWER(email) = LOWER(?)`,
        [userId, invitation.workspaceId, invitation.email],
      );
    }
    if (invitation.role === 'student') {
      if (invitation.batchId) {
        const [batches]: any = await connection.execute('SELECT id FROM Batches WHERE id = ? AND workspaceId = ? AND isArchived = 0', [invitation.batchId, invitation.workspaceId]);
        if (!batches.length) {
          await connection.rollback();
          return res.status(400).json({ error: 'The invited batch is no longer available.' });
        }
      }
      // Keep the legacy one-to-one shell while InterviewRecords still has a
      // foreign key to StudentProfiles; tenant-owned values live in WSP.
      await connection.execute(
        `INSERT IGNORE INTO StudentProfiles
         (id, eligibilityJson, weakAreasJson, strengthsJson, recentRemarksJson, batchId)
         VALUES (?, '[]', '[]', '[]', '[]', NULL)`,
        [userId],
      );
      await connection.execute(
        `INSERT INTO WorkspaceStudentProfiles
         (workspaceId, userId, rollNo, phone, college, department, branch, trainerName, attendancePercent, currentDay,
          overallProgressPercent, placementReadinessScore, coding, aptitude, reasoning, sqlScore, csFundamentals,
          communication, techInterview, hrInterview, overallReadiness, eligibilityJson, weakAreasJson, strengthsJson,
          recentRemarksJson, batchId)
         SELECT ?, u.id, u.rollNo, u.phone, w.name, u.department, u.branch, u.trainerName, 0, 1, 0, 0,
          0, 0, 0, 0, 0, 0, 0, 0, 0, '[]', '[]', '[]', '[]', ?
         FROM Users u JOIN Workspaces w ON w.id = ? WHERE u.id = ?
         ON DUPLICATE KEY UPDATE batchId = VALUES(batchId)`,
        [invitation.workspaceId, invitation.batchId || null, invitation.workspaceId, userId],
      );
    }
    await connection.execute('UPDATE WorkspaceInvitations SET acceptedAt = UTC_TIMESTAMP() WHERE id = ?', [invitation.id]);
    await connection.execute(
      'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, targetUserId, detailsJson) VALUES (?, ?, ?, ?, ?, ?)',
      [randomUUID(), invitation.workspaceId, userId, 'invitation.accepted', userId, JSON.stringify({ role: invitation.role })],
    );
    await connection.commit();
    await createSession(userId, invitation.workspaceId, res);
    const delivery = await sendAccountLifecycleEmail(req, { workspaceId: invitation.workspaceId, recipientEmail: invitation.email, recipientName: name.trim(), type: 'account_notice', relatedEntityId: invitation.id, heading: 'Your TalentEdge account is ready', message: 'Your invitation was accepted and workspace access is now active. You can sign in and get started.' });
    res.json({ success: true, delivery });
  } catch (error: any) {
    await connection.rollback();
    console.error('Invitation acceptance failed:', error);
    res.status(error?.code === 'ER_DUP_ENTRY' ? 409 : 500).json({ error: 'Could not accept this invitation.' });
  } finally {
    connection.release();
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (typeof token !== 'string' || token.length < 32 || !validPassword(newPassword)) {
    return res.status(400).json({ error: 'The reset link or new password is invalid. Use at least 12 characters.' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows]: any = await connection.execute(
      `SELECT r.id, r.workspaceId, r.userId, u.name, u.email FROM WorkspacePasswordResets r
       JOIN Users u ON u.id = r.userId WHERE r.tokenHash = ? AND r.usedAt IS NULL AND r.expiresAt > UTC_TIMESTAMP() LIMIT 1 FOR UPDATE`,
      [hashToken(token)],
    );
    const reset = rows[0];
    if (!reset) {
      await connection.rollback();
      return res.status(400).json({ error: 'This password reset link is invalid or has expired.' });
    }
    const passwordHash = await hashPassword(newPassword);
    await connection.execute('UPDATE Users SET passwordHash = ?, isActive = 1 WHERE id = ?', [passwordHash, reset.userId]);
    await connection.execute('UPDATE WorkspacePasswordResets SET usedAt = UTC_TIMESTAMP() WHERE id = ?', [reset.id]);
    await connection.execute('DELETE FROM AuthSessions WHERE userId = ?', [reset.userId]);
    await connection.execute(
      'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, targetUserId) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), reset.workspaceId, reset.userId, 'member.password_reset', reset.userId],
    );
    await connection.commit();
    clearSessionCookie(res);
    const delivery = await sendAccountLifecycleEmail(req, { workspaceId: reset.workspaceId, recipientEmail: reset.email, recipientName: reset.name, type: 'account_notice', relatedEntityId: reset.id, heading: 'Your password was changed', message: 'The password for your TalentEdge account was successfully changed. If you did not make this change, contact your college administrator immediately.' });
    res.json({ success: true, delivery });
  } catch (error) {
    await connection.rollback();
    console.error('Password reset failed:', error);
    res.status(500).json({ error: 'Could not reset the password.' });
  } finally {
    connection.release();
  }
});

app.post('/api/auth/request-password-reset', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  try {
    if (!(await reserveAccountEmailRateLimit(null, email, 'password_reset', req.ip))) return res.status(429).json({ code: 'EMAIL_RATE_LIMITED', error: 'Too many reset emails were requested. Try again later.' });
    const [memberships]: any = await pool.execute(
      `SELECT wm.workspaceId, u.id AS userId, u.name, u.email FROM Users u
       JOIN WorkspaceMemberships wm ON wm.userId = u.id AND wm.status = 'active'
       WHERE LOWER(u.email) = ? AND u.isActive = 1 AND u.passwordHash IS NOT NULL
       ORDER BY wm.createdAt ASC LIMIT 1`, [email],
    );
    if (memberships.length) {
      const member = memberships[0];
      const token = randomBytes(32).toString('base64url');
      const resetId = randomUUID();
      await pool.execute(
        `INSERT INTO WorkspacePasswordResets (id, workspaceId, userId, tokenHash, expiresAt, createdByUserId)
         VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR), NULL)`,
        [resetId, member.workspaceId, member.userId, hashToken(token)],
      );
      await sendAccountLifecycleEmail(req, { workspaceId: member.workspaceId, recipientEmail: member.email, recipientName: member.name, type: 'password_reset', relatedEntityId: resetId, heading: 'Reset your TalentEdge password', message: 'A password reset was requested for your account. If you did not make this request, you can ignore this email.', actionLabel: 'Reset password', actionUrl: `/?reset=${encodeURIComponent(token)}`, expiry: 'This one-time link expires in 60 minutes.', rateLimitReserved: true });
    }
    res.json({ success: true, message: 'If an active account uses that email, password reset instructions will be sent.' });
  } catch (error) {
    console.error('Password reset request failed:', error);
    res.status(500).json({ error: 'Could not process the password reset request.' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await pool.execute('DELETE FROM AuthSessions WHERE tokenHash = ?', [hashToken(token)]).catch(() => undefined);
  clearSessionCookie(res);
  res.json({ success: true });
});

app.post('/api/auth/change-password', requireWorkspacePermission('profile.update_own'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { currentPassword, newPassword } = req.body || {};
  if (!validPassword(newPassword) || typeof currentPassword !== 'string') {
    return res.status(400).json({ error: 'The new password must be at least 12 characters.' });
  }
  try {
    const [rows]: any = await pool.execute('SELECT passwordHash, name, email FROM Users WHERE id = ?', [auth.userId]);
    if (!(await verifyPassword(currentPassword, rows[0]?.passwordHash))) return res.status(400).json({ error: 'Current password is incorrect.' });
    const nextHash = await hashPassword(newPassword);
    await pool.execute('UPDATE Users SET passwordHash = ? WHERE id = ?', [nextHash, auth.userId]);
    await pool.execute('DELETE FROM AuthSessions WHERE userId = ? AND id <> ?', [auth.userId, auth.sessionId]);
    const delivery = await sendAccountLifecycleEmail(req, { workspaceId: auth.workspaceId, recipientEmail: rows[0].email, recipientName: rows[0].name, type: 'account_notice', relatedEntityId: auth.userId, heading: 'Your password was changed', message: 'The password for your TalentEdge account was successfully changed. If you did not make this change, contact your college administrator immediately.' });
    res.json({ success: true, delivery });
  } catch (error) {
    console.error('Password update failed:', error);
    res.status(500).json({ error: 'Could not update the password.' });
  }
});

app.patch('/api/auth/profile', requireWorkspacePermission('profile.update_own'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const avatar = req.body?.avatar;
  if (name.length < 2 || name.length > 100) {
    return res.status(400).json({ error: 'Name must be between 2 and 100 characters.' });
  }
  if (avatar !== undefined && avatar !== null && avatar !== '') {
    if (typeof avatar !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar)) {
      return res.status(400).json({ error: 'Choose a JPEG, PNG, or WebP profile image.' });
    }
    const encodedImage = avatar.slice(avatar.indexOf(',') + 1);
    if (Buffer.from(encodedImage, 'base64').length > 250 * 1024) {
      return res.status(400).json({ error: 'Profile images must be smaller than 250 KB.' });
    }
  }
  try {
    if (avatar === undefined) {
      await pool.execute('UPDATE Users SET name = ? WHERE id = ?', [name, auth.userId]);
    } else {
      await pool.execute('UPDATE Users SET name = ?, avatar = ? WHERE id = ?', [name, avatar || null, auth.userId]);
    }
    await pool.execute(
      'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, targetUserId) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), auth.workspaceId, auth.userId, 'member.profile_updated', auth.userId],
    );
    const [rows]: any = await pool.execute('SELECT id, name, email, avatar FROM Users WHERE id = ? LIMIT 1', [auth.userId]);
    res.json({ user: rows[0] });
  } catch (error) {
    console.error('Account profile update failed:', error);
    res.status(500).json({ error: 'Could not save your profile. Run the latest database migration and try again.' });
  }
});

app.get('/api/auth/me', requireWorkspacePermission('profile.read_own'), (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  res.json({
    user: { id: auth.userId, name: auth.name, email: auth.email, avatar: auth.avatar },
    workspace: { id: auth.workspaceId, name: auth.workspaceName },
    role: auth.role,
  });
});

// Platform endpoints authenticate with a separate cookie and never receive a workspace context.
// All other application data endpoints require an active workspace session.
app.use('/api', (req, res, next) => req.path.startsWith('/platform/') || req.path === '/billing/razorpay/webhook' ? next() : authenticate(req, res, next));

app.post('/api/platform/auth/login', async (req, res) => {
  const { email, password, code } = req.body || {};
  if (!validEmail(email) || typeof password !== 'string' || typeof code !== 'string') return res.status(400).json({ error: 'Enter your platform email, password, and authenticator code.' });
  const attemptKey = `platform:${req.ip}:${email.toLowerCase()}`;
  const previous = loginFailures.get(attemptKey);
  if (previous && previous.expiresAt > Date.now() && previous.count >= 8) return res.status(429).json({ error: 'Too many sign-in attempts. Wait 15 minutes and try again.' });
  try {
    const [rows]: any = await pool.execute('SELECT id, name, email, passwordHash, totpSecretEncrypted FROM PlatformAdminAccounts WHERE email = ? AND isActive = 1 LIMIT 1', [email.toLowerCase()]);
    const account = rows[0];
    const validPasswordAndCode = account
      && await verifyPassword(password, account.passwordHash)
      && verifyTotp(decryptTotpSecret(account.totpSecretEncrypted), code);
    if (!validPasswordAndCode) {
      const active = previous && previous.expiresAt > Date.now() ? previous : { count: 0, expiresAt: Date.now() + 15 * 60 * 1000 };
      loginFailures.set(attemptKey, { count: active.count + 1, expiresAt: active.expiresAt });
      return res.status(401).json({ error: 'Email, password, or authenticator code is incorrect.' });
    }
    loginFailures.delete(attemptKey);
    await pool.execute('UPDATE PlatformAdminAccounts SET lastLoginAt = UTC_TIMESTAMP() WHERE id = ?', [account.id]);
    await createPlatformSession(account.id, res);
    await pool.execute('INSERT INTO PlatformAuditEvents (id, platformAdminId, action, targetType, targetId) VALUES (?, ?, ?, ?, ?)', [randomUUID(), account.id, 'platform_admin.signed_in', 'platform_admin', account.id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Platform administrator sign-in failed:', error);
    res.status(500).json({ error: error instanceof Error && error.message.includes('PLATFORM_MFA_ENCRYPTION_KEY') ? error.message : 'Could not sign in to platform administration.' });
  }
});

app.get('/api/platform/auth/invitations/:token', async (req, res) => {
  const token = String(req.params.token || '');
  if (token.length < 32) return res.status(400).json({ error: 'Invitation link is invalid.' });
  try {
    const [rows]: any = await pool.execute('SELECT email FROM PlatformAdminInvitations WHERE tokenHash = ? AND acceptedAt IS NULL AND expiresAt > UTC_TIMESTAMP() LIMIT 1', [hashToken(token)]);
    if (!rows.length) return res.status(404).json({ error: 'Invitation is invalid or expired.' });
    res.json({ email: rows[0].email, totpSecret: generateTotpSecret() });
  } catch (error) {
    console.error('Platform invitation lookup failed:', error);
    res.status(500).json({ error: 'Could not load this invitation.' });
  }
});

app.post('/api/platform/auth/invitations/accept', async (req, res) => {
  const { token, name, password, totpSecret, code } = req.body || {};
  if (typeof token !== 'string' || token.length < 32 || typeof name !== 'string' || name.trim().length < 2 || !validPassword(password)
    || typeof totpSecret !== 'string' || totpSecret.length < 24 || !verifyTotp(totpSecret, code)) {
    return res.status(400).json({ error: 'Provide your name, a password of at least 12 characters, and a valid authenticator code.' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows]: any = await connection.execute('SELECT * FROM PlatformAdminInvitations WHERE tokenHash = ? AND acceptedAt IS NULL AND expiresAt > UTC_TIMESTAMP() LIMIT 1 FOR UPDATE', [hashToken(token)]);
    if (!rows.length) { await connection.rollback(); return res.status(400).json({ error: 'Invitation is invalid or expired.' }); }
    const invitation = rows[0];
    const [existing]: any = await connection.execute('SELECT id FROM PlatformAdminAccounts WHERE email = ? LIMIT 1', [invitation.email]);
    if (existing.length) { await connection.rollback(); return res.status(409).json({ error: 'A platform account already uses this email.' }); }
    const id = randomUUID();
    await connection.execute(
      `INSERT INTO PlatformAdminAccounts (id, name, email, passwordHash, totpSecretEncrypted, createdByPlatformAdminId)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, name.trim(), invitation.email, await hashPassword(password), encryptTotpSecret(totpSecret), invitation.invitedByPlatformAdminId],
    );
    await connection.execute('UPDATE PlatformAdminInvitations SET acceptedAt = UTC_TIMESTAMP() WHERE id = ?', [invitation.id]);
    await connection.execute('INSERT INTO PlatformAuditEvents (id, platformAdminId, action, targetType, targetId, reason) VALUES (?, ?, ?, ?, ?, ?)', [randomUUID(), id, 'platform_admin.invitation_accepted', 'platform_admin', id, 'New platform administrator accepted an invitation and enrolled MFA']);
    await connection.commit();
    await createPlatformSession(id, res);
    res.status(201).json({ success: true });
  } catch (error: any) {
    await connection.rollback();
    console.error('Platform invitation acceptance failed:', error);
    res.status(500).json({ error: error instanceof Error && error.message.includes('PLATFORM_MFA_ENCRYPTION_KEY') ? error.message : 'Could not accept this platform invitation.' });
  } finally { connection.release(); }
});

app.get('/api/platform/workspace-invitations/:token', async (req, res) => {
  const token = String(req.params.token || '');
  try {
    const [rows]: any = await pool.execute(
      `SELECT i.email, w.name AS workspaceName FROM PlatformWorkspaceAdminInvitations i
       JOIN Workspaces w ON w.id = i.workspaceId
       WHERE i.tokenHash = ? AND i.acceptedAt IS NULL AND i.revokedAt IS NULL AND i.expiresAt > UTC_TIMESTAMP() AND w.lifecycleStatus <> 'archived' LIMIT 1`,
      [hashToken(token)],
    );
    if (!rows.length) return res.status(404).json({ error: 'College administrator invitation is invalid or expired.' });
    res.json(rows[0]);
  } catch (error) {
    console.error('Workspace administrator invitation lookup failed:', error);
    res.status(500).json({ error: 'Could not load this college invitation.' });
  }
});

app.post('/api/platform/workspace-invitations/accept', async (req, res) => {
  const { token, name, password } = req.body || {};
  if (typeof token !== 'string' || token.length < 32 || typeof name !== 'string' || name.trim().length < 2 || !validPassword(password)) return res.status(400).json({ error: 'Enter your name and a password with at least 12 characters.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [invitePreviews]: any = await connection.execute(
      `SELECT id, workspaceId FROM PlatformWorkspaceAdminInvitations WHERE tokenHash = ? AND acceptedAt IS NULL AND revokedAt IS NULL AND expiresAt > UTC_TIMESTAMP() LIMIT 1`,
      [hashToken(token)],
    );
    if (!invitePreviews.length) { await connection.rollback(); return res.status(400).json({ error: 'College administrator invitation is invalid, revoked, or expired.' }); }
    const [workspaces]: any = await connection.execute('SELECT id, lifecycleStatus FROM Workspaces WHERE id = ? LIMIT 1 FOR UPDATE', [invitePreviews[0].workspaceId]);
    if (!workspaces.length || ['suspended', 'archived'].includes(workspaces[0].lifecycleStatus)) { await connection.rollback(); return res.status(403).json({ error: 'This college workspace is not accepting administrator invitations.' }); }
    const [invites]: any = await connection.execute(
      `SELECT * FROM PlatformWorkspaceAdminInvitations WHERE id = ? AND tokenHash = ? AND acceptedAt IS NULL AND revokedAt IS NULL AND expiresAt > UTC_TIMESTAMP() LIMIT 1 FOR UPDATE`,
      [invitePreviews[0].id, hashToken(token)],
    );
    if (!invites.length) { await connection.rollback(); return res.status(400).json({ error: 'College administrator invitation is invalid, revoked, or expired.' }); }
    const invitation = invites[0];
    const [users]: any = await connection.execute('SELECT id, passwordHash FROM Users WHERE email = ? LIMIT 1 FOR UPDATE', [invitation.email]);
    let userId = users[0]?.id;
    if (users[0]?.passwordHash) {
      if (!(await verifyPassword(password, users[0].passwordHash))) { await connection.rollback(); return res.status(401).json({ error: 'This email already has a TalentEdge account. Use its existing password to accept the invitation.' }); }
      await connection.execute('UPDATE Users SET name = ?, isActive = 1 WHERE id = ?', [name.trim(), userId]);
    } else {
      userId = userId || randomUUID();
      const passwordHash = await hashPassword(password);
      if (users[0]) await connection.execute('UPDATE Users SET name = ?, role = \'admin\', passwordHash = ?, isActive = 1 WHERE id = ?', [name.trim(), passwordHash, userId]);
      else await connection.execute('INSERT INTO Users (id, name, email, role, avatar, passwordHash, isActive) VALUES (?, ?, ?, \'admin\', \'\', ?, 1)', [userId, name.trim(), invitation.email, passwordHash]);
    }
    await connection.execute("INSERT INTO WorkspaceMemberships (id, workspaceId, userId, role, status) VALUES (?, ?, ?, 'college_admin', 'active') ON DUPLICATE KEY UPDATE role = 'college_admin', status = 'active'", [randomUUID(), invitation.workspaceId, userId]);
    await connection.execute('UPDATE PlatformWorkspaceAdminInvitations SET acceptedAt = UTC_TIMESTAMP() WHERE id = ?', [invitation.id]);
    await ensureWorkspaceSubscription(connection, invitation.workspaceId);
    await ensureWorkspaceAssessments(connection, invitation.workspaceId, userId);
    await connection.execute('INSERT INTO PlatformAuditEvents (id, platformAdminId, action, targetType, targetId, reason) VALUES (?, NULL, ?, ?, ?, ?)', [randomUUID(), 'workspace.initial_admin_added', 'workspace', invitation.workspaceId, `Initial college administrator invitation accepted by ${invitation.email}`]);
    await connection.commit();
    await createSession(userId, invitation.workspaceId, res);
    res.status(201).json({ success: true });
  } catch (error: any) {
    await connection.rollback();
    console.error('Workspace administrator invitation acceptance failed:', error);
    res.status(500).json({ error: 'Could not accept this college invitation.' });
  } finally { connection.release(); }
});

app.get('/api/platform/auth/me', requirePlatformPermission('platform.operations.read'), (req, res) => {
  const admin = (req as PlatformAuthenticatedRequest).platformAuth!;
  res.json({ user: { id: admin.platformAdminId, name: admin.name, email: admin.email }, role: 'platform_admin' });
});

app.post('/api/platform/auth/logout', requirePlatformPermission('platform.operations.read'), async (req, res) => {
  const admin = (req as PlatformAuthenticatedRequest).platformAuth!;
  await pool.execute('DELETE FROM PlatformAdminSessions WHERE id = ?', [admin.sessionId]);
  await pool.execute('INSERT INTO PlatformAuditEvents (id, platformAdminId, action, targetType, targetId) VALUES (?, ?, ?, ?, ?)', [randomUUID(), admin.platformAdminId, 'platform_admin.signed_out', 'platform_admin', admin.platformAdminId]);
  clearPlatformSessionCookie(res);
  res.json({ success: true });
});

app.get('/api/platform/overview', requirePlatformPermission('platform.operations.read'), async (req, res) => {
  try {
    const [rows]: any = await pool.query(
      `SELECT COUNT(*) AS totalWorkspaces,
              SUM(lifecycleStatus = 'onboarding') AS onboardingWorkspaces,
              SUM(lifecycleStatus = 'active') AS activeWorkspaces,
              SUM(lifecycleStatus = 'suspended') AS suspendedWorkspaces,
              SUM(lifecycleStatus = 'archived') AS archivedWorkspaces,
              SUM(createdAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)) AS createdLast30Days
       FROM Workspaces`,
    );
    const [subs]: any = await pool.query(
      `SELECT COALESCE(s.status, 'not_configured') AS status, COUNT(*) AS count
       FROM Workspaces w LEFT JOIN WorkspaceSubscriptions s ON s.workspaceId = w.id GROUP BY COALESCE(s.status, 'not_configured')`,
    );
    const [usage]: any = await pool.query(
      `SELECT COUNT(*) AS activeStudents FROM WorkspaceMemberships m JOIN Workspaces w ON w.id = m.workspaceId
       WHERE m.role = 'student' AND m.status = 'active' AND w.lifecycleStatus IN ('onboarding', 'active')`,
    );
    const [operationalWorkspaces]: any = await pool.query(
      `SELECT w.id, w.name, w.lifecycleStatus, COALESCE(s.planId, 'pilot') AS planId,
              TIMESTAMPDIFF(DAY, w.createdAt, UTC_TIMESTAMP()) AS ageDays,
              (SELECT COUNT(*) FROM WorkspaceMemberships m WHERE m.workspaceId = w.id AND m.role = 'student' AND m.status = 'active') AS activeStudents,
              (SELECT COUNT(*) FROM WorkspaceMemberships m WHERE m.workspaceId = w.id AND m.role IN ('trainer', 'panelist') AND m.status = 'active') AS trainerSeats,
              (SELECT COUNT(*) FROM Batches b WHERE b.workspaceId = w.id AND b.isArchived = 0) AS activeBatches
       FROM Workspaces w LEFT JOIN WorkspaceSubscriptions s ON s.workspaceId = w.id
       WHERE w.lifecycleStatus IN ('onboarding', 'active')`,
    );
    const [actionableInvitations]: any = await pool.query(
      `SELECT i.id, i.workspaceId, i.email, w.name AS workspaceName, i.expiresAt,
              i.expiresAt <= UTC_TIMESTAMP() AS expired,
              DATE_FORMAT(i.expiresAt, '%Y-%m-%d %H:%i:%s') AS expiresAtText
       FROM PlatformWorkspaceAdminInvitations i JOIN Workspaces w ON w.id = i.workspaceId
       WHERE i.acceptedAt IS NULL AND i.revokedAt IS NULL
         AND w.lifecycleStatus IN ('onboarding', 'active')
         AND (i.expiresAt <= UTC_TIMESTAMP() OR i.expiresAt <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 24 HOUR))
         AND NOT EXISTS (
           SELECT 1 FROM PlatformWorkspaceAdminInvitations newer
           WHERE newer.workspaceId = i.workspaceId AND newer.email = i.email
             AND (newer.createdAt > i.createdAt OR (newer.createdAt = i.createdAt AND newer.id > i.id))
         )
       ORDER BY i.expiresAt ASC`,
    );
    const alerts: Array<{ id: string; type: string; severity: 'warning' | 'high' | 'critical'; workspaceId: string; workspaceName: string; title: string; message: string; value?: number; limit?: number; percent?: number }> = [];
    const addAlert = (alert: typeof alerts[number]) => alerts.push(alert);
    for (const workspace of operationalWorkspaces) {
      if (workspace.lifecycleStatus === 'onboarding' && Number(workspace.ageDays) >= 7) {
        const days = Number(workspace.ageDays);
        addAlert({ id: `onboarding:${workspace.id}`, type: 'onboarding', severity: days >= 14 ? 'high' : 'warning', workspaceId: workspace.id, workspaceName: workspace.name, title: 'Onboarding is taking longer than expected', message: `Workspace has remained in onboarding for ${days} days.` });
      }
      const plan = await getPlanDefinitionFromDb(pool, workspace.planId);
      const capacityMetrics: Array<{ key: PlanLimitKey; label: string; usage: number }> = [
        { key: 'active_students', label: 'students', usage: Number(workspace.activeStudents) },
        { key: 'trainer_seats', label: 'trainer seats', usage: Number(workspace.trainerSeats) },
        { key: 'active_batches', label: 'active batches', usage: Number(workspace.activeBatches) },
      ];
      for (const metric of capacityMetrics) {
        const limit = plan.limits.find((entry) => entry.key === metric.key)?.value ?? null;
        if (limit === null || limit <= 0) continue;
        const percent = Math.floor((metric.usage / limit) * 100);
        if (percent < 80) continue;
        addAlert({ id: `capacity:${workspace.id}:${metric.key}`, type: 'capacity', severity: percent >= 100 ? 'critical' : percent >= 90 ? 'high' : 'warning', workspaceId: workspace.id, workspaceName: workspace.name, title: `${plan.name} ${metric.label} capacity`, message: `${metric.usage} of ${limit} ${metric.label} in use (${percent}%).`, value: metric.usage, limit, percent });
      }
    }
    for (const invitation of actionableInvitations) {
      const expired = Number(invitation.expired) === 1;
      addAlert({ id: `invitation:${invitation.id}`, type: 'invitation', severity: expired ? 'high' : 'warning', workspaceId: invitation.workspaceId, workspaceName: invitation.workspaceName, title: expired ? 'College-admin invitation expired' : 'College-admin invitation expiring soon', message: `${invitation.email} · ${expired ? 'expired' : 'expires'} ${invitation.expiresAtText} UTC.` });
    }
    const severityOrder = { critical: 0, high: 1, warning: 2 };
    alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.workspaceName.localeCompare(b.workspaceName) || a.title.localeCompare(b.title));
    res.json({ ...rows[0], activeStudents: Number(usage[0]?.activeStudents || 0), subscriptions: subs.map((item: any) => ({ status: item.status, count: Number(item.count) })), alerts, alertSummary: { total: alerts.length, critical: alerts.filter((alert) => alert.severity === 'critical').length, high: alerts.filter((alert) => alert.severity === 'high').length, warning: alerts.filter((alert) => alert.severity === 'warning').length } });
  } catch (error) {
    console.error('Platform overview query failed:', error);
    res.status(500).json({ error: 'Could not load platform overview.' });
  }
});

app.get('/api/platform/content/applications', requirePlatformPermission('platform.shared_content.manage'), async (req, res) => {
  const workspaceId = String(req.query.workspaceId || '').trim();
  const dateFrom = String(req.query.dateFrom || '').trim();
  const dateTo = String(req.query.dateTo || '').trim();
  const isDate = (value: string) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!isDate(dateFrom) || !isDate(dateTo) || (dateFrom && dateTo && dateFrom > dateTo)) return res.status(400).json({ error: 'Choose a valid date range.' });
  try {
    const conditions: string[] = [];
    const params: any[] = [];
    if (workspaceId) { conditions.push('a.workspaceId = ?'); params.push(workspaceId); }
    if (dateFrom) { conditions.push('a.appliedAt >= CONCAT(?, \' 00:00:00\')'); params.push(dateFrom); }
    if (dateTo) { conditions.push('a.appliedAt < DATE_ADD(CONCAT(?, \' 00:00:00\'), INTERVAL 1 DAY)'); params.push(dateTo); }
    const [rows]: any = await pool.execute(
      `SELECT a.id, a.workspaceId, w.name AS workspaceName, a.versionId, v.versionNumber, v.title AS versionTitle,
              a.appliedByPlatformAdminId, p.name AS appliedBy, a.reason, a.resultJson,
              DATE_FORMAT(a.appliedAt, '%Y-%m-%d %H:%i:%s') AS appliedAt
       FROM PlatformSharedContentApplications a
       JOIN Workspaces w ON w.id = a.workspaceId
       JOIN PlatformSharedContentVersions v ON v.id = a.versionId
       JOIN PlatformAdminAccounts p ON p.id = a.appliedByPlatformAdminId
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY a.appliedAt DESC, a.id DESC LIMIT 500`,
      params,
    );
    res.json(rows.map((row: any) => ({ ...row, versionNumber: Number(row.versionNumber), result: typeof row.resultJson === 'string' ? JSON.parse(row.resultJson || '{}') : row.resultJson || {} })));
  } catch (error) {
    console.error('Shared content application history query failed:', error);
    res.status(500).json({ error: 'Could not load shared content application history.' });
  }
});

app.get('/api/platform/content/rollout', requirePlatformPermission('platform.shared_content.manage'), async (_req, res) => {
  try {
    const [rows]: any = await pool.query(
      `SELECT w.id AS workspaceId, w.name AS workspaceName, w.lifecycleStatus,
              published.id AS latestPublishedVersionId, published.versionNumber AS latestPublishedVersionNumber, published.title AS latestPublishedTitle,
              applied.versionId AS appliedVersionId, appliedVersion.versionNumber AS appliedVersionNumber, appliedVersion.title AS appliedVersionTitle,
              DATE_FORMAT(applied.appliedAt, '%Y-%m-%d %H:%i:%s') AS appliedAt
       FROM Workspaces w
       LEFT JOIN (SELECT id, versionNumber, title FROM PlatformSharedContentVersions WHERE status = 'published' ORDER BY versionNumber DESC LIMIT 1) published ON 1 = 1
       LEFT JOIN PlatformSharedContentApplications applied ON applied.id = (
         SELECT a.id FROM PlatformSharedContentApplications a WHERE a.workspaceId = w.id ORDER BY a.appliedAt DESC, a.id DESC LIMIT 1
       )
       LEFT JOIN PlatformSharedContentVersions appliedVersion ON appliedVersion.id = applied.versionId
       ORDER BY w.name, w.id`,
    );
    const colleges = rows.map((row: any) => {
      const eligible = ['onboarding', 'active'].includes(row.lifecycleStatus);
      const status = !row.latestPublishedVersionId ? 'no_release' : !eligible ? 'excluded' : !row.appliedVersionId ? 'not_applied' : Number(row.appliedVersionNumber) < Number(row.latestPublishedVersionNumber) ? 'behind' : 'current';
      return { workspaceId: row.workspaceId, workspaceName: row.workspaceName, lifecycleStatus: row.lifecycleStatus, appliedVersionId: row.appliedVersionId, appliedVersionNumber: row.appliedVersionNumber === null ? null : Number(row.appliedVersionNumber), appliedVersionTitle: row.appliedVersionTitle, appliedAt: row.appliedAt, latestPublishedVersionId: row.latestPublishedVersionId, latestPublishedVersionNumber: row.latestPublishedVersionNumber === null ? null : Number(row.latestPublishedVersionNumber), latestPublishedTitle: row.latestPublishedTitle, status };
    });
    const eligible = colleges.filter((college: any) => ['onboarding', 'active'].includes(college.lifecycleStatus));
    res.json({ latestPublishedVersionNumber: colleges.find((college: any) => college.latestPublishedVersionNumber !== null)?.latestPublishedVersionNumber ?? null, totalEligible: eligible.length, current: eligible.filter((college: any) => college.status === 'current').length, behind: eligible.filter((college: any) => college.status === 'behind').length, notApplied: eligible.filter((college: any) => college.status === 'not_applied').length, colleges });
  } catch (error) {
    console.error('Shared content rollout query failed:', error);
    res.status(500).json({ error: 'Could not load shared content rollout status.' });
  }
});

app.get('/api/platform/content/versions', requirePlatformPermission('platform.shared_content.manage'), async (_req, res) => {
  try {
    const [rows]: any = await pool.query(
      `SELECT v.id, v.versionNumber, v.title, v.status,
              DATE_FORMAT(v.createdAt, '%Y-%m-%d %H:%i:%s') AS createdAt,
              DATE_FORMAT(v.publishedAt, '%Y-%m-%d %H:%i:%s') AS publishedAt,
              creator.name AS createdBy, publisher.name AS publishedBy,
              (SELECT COUNT(*) FROM PlatformSharedContentApplications a WHERE a.versionId = v.id) AS appliedWorkspaceCount,
              v.contentJson
       FROM PlatformSharedContentVersions v
       LEFT JOIN PlatformAdminAccounts creator ON creator.id = v.createdByPlatformAdminId
       LEFT JOIN PlatformAdminAccounts publisher ON publisher.id = v.publishedByPlatformAdminId
       ORDER BY v.versionNumber DESC`,
    );
    res.json(rows.map((row: any) => {
      const content = JSON.parse(row.contentJson || '{}');
      return { id: row.id, versionNumber: Number(row.versionNumber), title: row.title, status: row.status, createdAt: row.createdAt, publishedAt: row.publishedAt, createdBy: row.createdBy, publishedBy: row.publishedBy, appliedWorkspaceCount: Number(row.appliedWorkspaceCount || 0), materialCount: Array.isArray(content.materials) ? content.materials.length : 0, assessmentCount: Array.isArray(content.enabledAssessmentIds) ? content.enabledAssessmentIds.length : 0 };
    }));
  } catch (error) {
    console.error('Shared content versions query failed:', error);
    res.status(500).json({ error: 'Could not load the shared content library.' });
  }
});

app.get('/api/platform/content/versions/:id', requirePlatformPermission('platform.shared_content.manage'), async (req, res) => {
  try {
    const [rows]: any = await pool.execute(
      `SELECT v.id, v.versionNumber, v.title, v.status, v.contentJson,
              DATE_FORMAT(v.createdAt, '%Y-%m-%d %H:%i:%s') AS createdAt,
              DATE_FORMAT(v.publishedAt, '%Y-%m-%d %H:%i:%s') AS publishedAt
       FROM PlatformSharedContentVersions v WHERE v.id = ? LIMIT 1`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Shared content version not found.' });
    const content = JSON.parse(rows[0].contentJson || '{}');
    const assessmentTemplates = Array.isArray(content.assessmentTemplates) ? content.assessmentTemplates.map((assessment: any) => ({ id: assessment.id, dayNumber: assessment.dayNumber, title: assessment.title, type: assessment.type, durationMinutes: assessment.durationMinutes, totalMarks: assessment.totalMarks, questionCount: Array.isArray(assessment.sections) ? assessment.sections.reduce((count: number, section: any) => count + (Array.isArray(section.questions) ? section.questions.length : 0), 0) : 0 })) : [];
    res.json({ id: rows[0].id, versionNumber: Number(rows[0].versionNumber), title: rows[0].title, status: rows[0].status, createdAt: rows[0].createdAt, publishedAt: rows[0].publishedAt, materials: Array.isArray(content.materials) ? content.materials : [], assessmentTemplates, enabledAssessmentIds: Array.isArray(content.enabledAssessmentIds) ? content.enabledAssessmentIds : [] });
  } catch (error) {
    console.error('Shared content version query failed:', error);
    res.status(500).json({ error: 'Could not load this shared content version.' });
  }
});

app.post('/api/platform/content/versions', requirePlatformPermission('platform.shared_content.manage'), async (req, res) => {
  const admin = (req as PlatformAuthenticatedRequest).platformAuth!;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [latest]: any = await connection.query('SELECT id, versionNumber, title, status, contentJson FROM PlatformSharedContentVersions ORDER BY versionNumber DESC LIMIT 1 FOR UPDATE');
    if (!latest.length) throw new Error('The initial shared content package is missing. Run the database migration.');
    const versionNumber = Number(latest[0].versionNumber) + 1;
    const [published]: any = await connection.query('SELECT contentJson FROM PlatformSharedContentVersions WHERE status = \'published\' ORDER BY versionNumber DESC LIMIT 1');
    const contentJson = published[0]?.contentJson || latest[0].contentJson;
    const id = randomUUID();
    const title = `Shared content draft v${versionNumber}`;
    await connection.execute('INSERT INTO PlatformSharedContentVersions (id, versionNumber, title, status, contentJson, createdByPlatformAdminId) VALUES (?, ?, ?, \'draft\', ?, ?)', [id, versionNumber, title, contentJson, admin.platformAdminId]);
    await connection.execute('INSERT INTO PlatformAuditEvents (id, platformAdminId, action, targetType, targetId, reason, afterJson) VALUES (?, ?, ?, ?, ?, ?, ?)', [randomUUID(), admin.platformAdminId, 'platform.shared_content_draft_created', 'shared_content_version', id, `Created draft v${versionNumber} from the latest published package or initial sample catalog`, JSON.stringify({ versionNumber, basedOnVersion: Number(latest[0].versionNumber) })]);
    await connection.commit();
    res.status(201).json({ id, versionNumber, title, status: 'draft' });
  } catch (error) {
    await connection.rollback();
    console.error('Shared content draft creation failed:', error);
    res.status(500).json({ error: error instanceof Error && error.message.includes('migration') ? error.message : 'Could not create a shared content draft.' });
  } finally { connection.release(); }
});

app.put('/api/platform/content/versions/:id', requirePlatformPermission('platform.shared_content.manage'), async (req, res) => {
  const admin = (req as PlatformAuthenticatedRequest).platformAuth!;
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const materialsInput = req.body?.materials;
  const enabledIds = req.body?.enabledAssessmentIds;
  if (title.length < 3 || title.length > 191 || !Array.isArray(materialsInput) || materialsInput.length > 300 || !Array.isArray(enabledIds) || enabledIds.length > 500) return res.status(400).json({ error: 'Enter a version title, no more than 300 materials, and a valid list of sample assessments.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows]: any = await connection.execute('SELECT versionNumber, status, contentJson FROM PlatformSharedContentVersions WHERE id = ? LIMIT 1 FOR UPDATE', [req.params.id]);
    if (!rows.length) { await connection.rollback(); return res.status(404).json({ error: 'Shared content version not found.' }); }
    if (rows[0].status !== 'draft') { await connection.rollback(); return res.status(409).json({ error: 'Published content versions are immutable. Create a new draft to make changes.' }); }
    const content = JSON.parse(rows[0].contentJson || '{}');
    const templates = Array.isArray(content.assessmentTemplates) ? content.assessmentTemplates : [];
    const allowedAssessmentIds = new Set(templates.map((item: any) => String(item.id)));
    if (enabledIds.some((id: any) => typeof id !== 'string' || !allowedAssessmentIds.has(id)) || new Set(enabledIds).size !== enabledIds.length) { await connection.rollback(); return res.status(400).json({ error: 'The selected sample assessments are invalid or duplicated.' }); }
    const seenMaterialIds = new Set<string>();
    const materials = [];
    for (const item of materialsInput) {
      const id = typeof item?.id === 'string' && item.id.length > 0 ? item.id : randomUUID();
      const dayNumber = Number(item?.dayNumber);
      const materialTitle = typeof item?.title === 'string' ? item.title.trim() : '';
      const materialType = item?.materialType;
      const contentFormat = item?.contentFormat || 'markdown';
      const isRequired = item?.isRequired !== false;
      const position = Number.isInteger(item?.position) && item.position >= 0 ? item.position : materials.length;
      let contentUrl: string | null = null;
      const contentText = typeof item?.contentText === 'string' ? item.contentText : '';
      if (item?.contentUrl) {
        try { const parsed = new URL(item.contentUrl); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol'); contentUrl = parsed.toString(); }
        catch { await connection.rollback(); return res.status(400).json({ error: `Material “${materialTitle || id}” needs a valid HTTP or HTTPS link.` }); }
      }
      if (seenMaterialIds.has(id) || !Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 40 || materialTitle.length < 2 || materialTitle.length > 191 || !['video', 'text', 'pdf'].includes(materialType) || !['markdown', 'html'].includes(contentFormat) || (materialType === 'text' ? !contentText.trim() || contentText.length > 50000 || contentUrl !== null : !contentUrl || contentText.length > 0)) {
        await connection.rollback();
        return res.status(400).json({ error: `Material “${materialTitle || id}” has invalid day, title, type, format, or content.` });
      }
      seenMaterialIds.add(id);
      materials.push({ id, dayNumber, title: materialTitle, materialType, contentUrl, contentText: materialType === 'text' ? contentText : null, contentFormat, position, isRequired });
    }
    content.schemaVersion = 1;
    content.materials = materials;
    content.enabledAssessmentIds = enabledIds;
    await connection.execute('UPDATE PlatformSharedContentVersions SET title = ?, contentJson = ? WHERE id = ?', [title, JSON.stringify(content), req.params.id]);
    await connection.execute('INSERT INTO PlatformAuditEvents (id, platformAdminId, action, targetType, targetId, reason, afterJson) VALUES (?, ?, ?, ?, ?, ?, ?)', [randomUUID(), admin.platformAdminId, 'platform.shared_content_draft_updated', 'shared_content_version', req.params.id, 'Draft materials and assessment selection updated', JSON.stringify({ title, materialCount: materials.length, assessmentCount: enabledIds.length })]);
    await connection.commit();
    res.json({ success: true, id: req.params.id, title, materialCount: materials.length, assessmentCount: enabledIds.length });
  } catch (error) {
    await connection.rollback();
    console.error('Shared content draft update failed:', error);
    res.status(500).json({ error: 'Could not save this shared content draft.' });
  } finally { connection.release(); }
});

app.post('/api/platform/content/versions/:id/publish', requirePlatformPermission('platform.shared_content.manage'), async (req, res) => {
  const admin = (req as PlatformAuthenticatedRequest).platformAuth!;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 5 || reason.length > 1000) return res.status(400).json({ error: 'Provide a publish reason of at least five characters.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows]: any = await connection.execute('SELECT versionNumber, title, status, contentJson FROM PlatformSharedContentVersions WHERE id = ? LIMIT 1 FOR UPDATE', [req.params.id]);
    if (!rows.length) { await connection.rollback(); return res.status(404).json({ error: 'Shared content version not found.' }); }
    if (rows[0].status !== 'draft') { await connection.rollback(); return res.status(409).json({ error: 'This content version is already published and immutable.' }); }
    const content = JSON.parse(rows[0].contentJson || '{}');
    if (!(content.materials?.length || content.enabledAssessmentIds?.length)) { await connection.rollback(); return res.status(400).json({ error: 'Add at least one learning material or include at least one sample assessment before publishing.' }); }
    await connection.execute("UPDATE PlatformSharedContentVersions SET status = 'published', publishedByPlatformAdminId = ?, publishedAt = UTC_TIMESTAMP() WHERE id = ?", [admin.platformAdminId, req.params.id]);
    await connection.execute('INSERT INTO PlatformAuditEvents (id, platformAdminId, action, targetType, targetId, reason, beforeJson, afterJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [randomUUID(), admin.platformAdminId, 'platform.shared_content_published', 'shared_content_version', req.params.id, reason, JSON.stringify({ status: 'draft' }), JSON.stringify({ status: 'published', versionNumber: Number(rows[0].versionNumber), title: rows[0].title })]);
    await connection.commit();
    res.json({ success: true, versionNumber: Number(rows[0].versionNumber), title: rows[0].title });
  } catch (error) {
    await connection.rollback();
    console.error('Shared content publish failed:', error);
    res.status(500).json({ error: 'Could not publish this shared content version.' });
  } finally { connection.release(); }
});

const applySharedContentHandler = async (req: Request, res: Response, rollbackOnly = false) => {
  const admin = (req as PlatformAuthenticatedRequest).platformAuth!;
  const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!workspaceId || reason.length < 5 || reason.length > 1000) return res.status(400).json({ error: 'Select a college and provide an apply reason of at least five characters.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [workspaces]: any = await connection.execute('SELECT id, name, lifecycleStatus FROM Workspaces WHERE id = ? LIMIT 1 FOR UPDATE', [workspaceId]);
    if (!workspaces.length) { await connection.rollback(); return res.status(404).json({ error: 'College workspace not found.' }); }
    if (['suspended', 'archived'].includes(workspaces[0].lifecycleStatus)) { await connection.rollback(); return res.status(409).json({ error: 'Reactivate this college before applying shared content.' }); }
    const [versions]: any = await connection.execute("SELECT versionNumber, title, status, contentJson FROM PlatformSharedContentVersions WHERE id = ? LIMIT 1 FOR UPDATE", [req.params.id]);
    if (!versions.length) { await connection.rollback(); return res.status(404).json({ error: 'Shared content version not found.' }); }
    if (versions[0].status !== 'published') { await connection.rollback(); return res.status(409).json({ error: 'Only published shared content can be applied to a college.' }); }
    if (rollbackOnly) {
      const [latestApplications]: any = await connection.execute(
        `SELECT v.versionNumber FROM PlatformSharedContentApplications a
         JOIN PlatformSharedContentVersions v ON v.id = a.versionId
         WHERE a.workspaceId = ? ORDER BY a.appliedAt DESC, a.id DESC LIMIT 1 FOR UPDATE`,
        [workspaceId],
      );
      if (!latestApplications.length || Number(versions[0].versionNumber) >= Number(latestApplications[0].versionNumber)) {
        await connection.rollback();
        return res.status(409).json({ error: 'Rollback requires a published version older than the most recently applied release for this college.' });
      }
    }
    const content = JSON.parse(versions[0].contentJson || '{}');
    const versionId = req.params.id;
    const [archivedMaterials]: any = await connection.execute('UPDATE WorkspaceCurriculumMaterials SET isArchived = 1 WHERE workspaceId = ? AND sourceContentId IS NOT NULL AND isCustomized = 0 AND isArchived = 0', [workspaceId]);
    const [archivedAssessments]: any = await connection.execute('UPDATE Assessments SET isArchived = 1 WHERE workspaceId = ? AND sourceContentId IS NOT NULL AND isCustomized = 0 AND isArchived = 0', [workspaceId]);
    let materialAdded = 0; let materialUpdated = 0; let materialPreserved = 0;
    const localPositions: Record<number, number> = {};
    for (const material of content.materials || []) {
      if (localPositions[material.dayNumber] === undefined) {
        const [[position]]: any = await connection.execute('SELECT COALESCE(MAX(position), -1) AS position FROM WorkspaceCurriculumMaterials WHERE workspaceId = ? AND dayNumber = ? AND sourceContentId IS NULL', [workspaceId, material.dayNumber]);
        localPositions[material.dayNumber] = Number(position.position) + 1;
      }
      const position = localPositions[material.dayNumber] + Number(material.position || 0);
      const [existing]: any = await connection.execute('SELECT id, isCustomized FROM WorkspaceCurriculumMaterials WHERE workspaceId = ? AND sourceContentId = ? LIMIT 1 FOR UPDATE', [workspaceId, material.id]);
      if (!existing.length) {
        await connection.execute(
          `INSERT INTO WorkspaceCurriculumMaterials (id, workspaceId, dayNumber, title, materialType, contentUrl, contentText, contentFormat, position, isRequired, sourceContentId, sourceVersionId, isCustomized)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          [randomUUID(), workspaceId, material.dayNumber, material.title, material.materialType, material.contentUrl, material.contentText, material.contentFormat || 'markdown', position, material.isRequired ? 1 : 0, material.id, versionId],
        );
        materialAdded += 1;
      } else if (Number(existing[0].isCustomized)) materialPreserved += 1;
      else {
        await connection.execute(
          `UPDATE WorkspaceCurriculumMaterials SET dayNumber = ?, title = ?, materialType = ?, contentUrl = ?, contentText = ?, contentFormat = ?, position = ?, isRequired = ?, sourceVersionId = ?, isArchived = 0 WHERE id = ? AND workspaceId = ?`,
          [material.dayNumber, material.title, material.materialType, material.contentUrl, material.contentText, material.contentFormat || 'markdown', position, material.isRequired ? 1 : 0, versionId, existing[0].id, workspaceId],
        );
        materialUpdated += 1;
      }
    }
    let assessmentAdded = 0; let assessmentUpdated = 0; let assessmentPreserved = 0;
    const enabledAssessmentIds = new Set(content.enabledAssessmentIds || []);
    for (const assessment of content.assessmentTemplates || []) {
      if (!enabledAssessmentIds.has(assessment.id)) continue;
      const [existing]: any = await connection.execute('SELECT id, isCustomized FROM Assessments WHERE workspaceId = ? AND sourceContentId = ? LIMIT 1 FOR UPDATE', [workspaceId, assessment.id]);
      const values = [assessment.dayNumber, assessment.title, assessment.type, assessment.durationMinutes, assessment.totalMarks, JSON.stringify(assessment.coverage || []), assessment.purpose || '', assessment.status || 'upcoming', assessment.scheduledDate || '', JSON.stringify(assessment.sections || []), JSON.stringify(assessment.targetCompanies || []), versionId];
      if (!existing.length) {
        await connection.execute(
          `INSERT INTO Assessments (id, workspaceId, dayNumber, title, type, durationMinutes, totalMarks, coverageJson, purpose, status, scheduledDate, sectionsJson, targetCompaniesJson, sourceContentId, sourceVersionId, isCustomized)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          [`${workspaceId}:${assessment.id}`, workspaceId, ...values.slice(0, 11), assessment.id, versionId],
        );
        const sharedAssessmentId = `${workspaceId}:${assessment.id}`;
        await connection.execute(
          `INSERT IGNORE INTO AssessmentAssignmentRules (assessmentId, workspaceId, batchId, maxAttempts, resultReleasePolicy)
           VALUES (?, ?, NULL, 0, 'immediate')`,
          [sharedAssessmentId, workspaceId],
        );
        const [createdAssessment]: any = await connection.execute('SELECT * FROM Assessments WHERE id = ? AND workspaceId = ?', [sharedAssessmentId, workspaceId]);
        if (createdAssessment.length) await saveAssessmentVersion(connection, createdAssessment[0], null, `Shared content v${Number(versions[0].versionNumber)} applied`);
        assessmentAdded += 1;
      } else if (Number(existing[0].isCustomized)) assessmentPreserved += 1;
      else {
        await connection.execute(
          `UPDATE Assessments SET dayNumber = ?, title = ?, type = ?, durationMinutes = ?, totalMarks = ?, coverageJson = ?, purpose = ?, status = ?, scheduledDate = ?, sectionsJson = ?, targetCompaniesJson = ?, sourceVersionId = ?, currentVersion = currentVersion + 1, isArchived = 0 WHERE id = ? AND workspaceId = ?`,
          [...values, existing[0].id, workspaceId],
        );
        const [updatedAssessment]: any = await connection.execute('SELECT * FROM Assessments WHERE id = ? AND workspaceId = ?', [existing[0].id, workspaceId]);
        if (updatedAssessment.length) await saveAssessmentVersion(connection, updatedAssessment[0], null, `Shared content v${Number(versions[0].versionNumber)} applied`);
        assessmentUpdated += 1;
      }
    }
    const result = { materialAdded, materialUpdated, materialPreserved, materialArchived: Number(archivedMaterials.affectedRows || 0), assessmentAdded, assessmentUpdated, assessmentPreserved, assessmentArchived: Number(archivedAssessments.affectedRows || 0) };
    await connection.execute(
      `INSERT INTO PlatformSharedContentApplications (id, workspaceId, versionId, appliedByPlatformAdminId, reason, resultJson)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [randomUUID(), workspaceId, versionId, admin.platformAdminId, reason, JSON.stringify(result)],
    );
    await connection.execute('INSERT INTO PlatformAuditEvents (id, platformAdminId, action, targetType, targetId, reason, afterJson) VALUES (?, ?, ?, ?, ?, ?, ?)', [randomUUID(), admin.platformAdminId, rollbackOnly ? 'platform.shared_content_rolled_back' : 'platform.shared_content_applied', 'workspace', workspaceId, reason, JSON.stringify({ versionId, versionNumber: Number(versions[0].versionNumber), title: versions[0].title, ...result })]);
    await connection.commit();
    res.json({ success: true, workspaceName: workspaces[0].name, versionNumber: Number(versions[0].versionNumber), rolledBack: rollbackOnly, ...result });
  } catch (error) {
    await connection.rollback();
    console.error('Shared content apply failed:', error);
    res.status(500).json({ error: 'Could not apply shared content to this college.' });
  } finally { connection.release(); }
};

app.post('/api/platform/content/versions/:id/apply', requirePlatformPermission('platform.shared_content.manage'), (req, res) => applySharedContentHandler(req, res));
app.post('/api/platform/content/versions/:id/rollback', requirePlatformPermission('platform.shared_content.manage'), (req, res) => applySharedContentHandler(req, res, true));

app.get('/api/platform/subscription-history', requirePlatformPermission('platform.billing.read'), async (req, res) => {
  const workspaceId = String(req.query.workspaceId || '').trim();
  const status = String(req.query.status || '').trim();
  const dateFrom = String(req.query.dateFrom || '').trim();
  const dateTo = String(req.query.dateTo || '').trim();
  const exportAll = req.query.export === '1';
  const validStatuses = ['not_configured', 'trialing', 'active', 'past_due', 'canceled', 'suspended'];
  const isDate = (value: string) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
  if ((status && !validStatuses.includes(status)) || !isDate(dateFrom) || !isDate(dateTo) || (dateFrom && dateTo && dateFrom > dateTo)) return res.status(400).json({ error: 'Choose valid status and date filters.' });
  const filters = ["a.action = 'workspace.subscription_updated'"];
  const params: any[] = [];
  if (workspaceId) { filters.push('a.targetId = ?'); params.push(workspaceId); }
  if (status) { filters.push("JSON_UNQUOTE(JSON_EXTRACT(a.afterJson, '$.status')) = ?"); params.push(status); }
  if (dateFrom) { filters.push("a.createdAt >= CONCAT(?, ' 00:00:00')"); params.push(dateFrom); }
  if (dateTo) { filters.push("a.createdAt < DATE_ADD(CONCAT(?, ' 00:00:00'), INTERVAL 1 DAY)"); params.push(dateTo); }
  const where = `WHERE ${filters.join(' AND ')}`;
  const parsedOffset = Number.parseInt(String(req.query.offset || '0'), 10);
  const offset = Number.isFinite(parsedOffset) ? Math.min(100000, Math.max(0, parsedOffset)) : 0;
  const limit = exportAll ? 10000 : 50;
  try {
    const [totals]: any = await pool.execute(`SELECT COUNT(*) AS total FROM PlatformAuditEvents a ${where}`, params);
    const [rows]: any = await pool.execute(
      `SELECT a.id, a.targetId AS workspaceId, w.name AS workspaceName, a.reason,
              DATE_FORMAT(a.createdAt, '%Y-%m-%d %H:%i:%s') AS changedAt,
              COALESCE(actor.name, 'Former platform admin') AS actorName, actor.email AS actorEmail,
              a.beforeJson, a.afterJson
       FROM PlatformAuditEvents a
       JOIN Workspaces w ON w.id = a.targetId
       LEFT JOIN PlatformAdminAccounts actor ON actor.id = a.platformAdminId
       ${where}
       ORDER BY a.createdAt DESC, a.id DESC LIMIT ${limit}${exportAll ? '' : ' OFFSET ?'}`,
      exportAll ? params : [...params, offset],
    );
    const items = rows.map((row: any) => ({ ...row, before: parseStoredJson<Record<string, unknown>>(row.beforeJson, {}), after: parseStoredJson<Record<string, unknown>>(row.afterJson, {}) }));
    res.json({ items, total: Number(totals[0]?.total || 0), offset: exportAll ? 0 : offset, limit });
  } catch (error) {
    console.error('Subscription history query failed:', error);
    res.status(500).json({ error: 'Could not load subscription change history.' });
  }
});

app.get('/api/platform/audit', requirePlatformPermission('platform.operations.read'), async (req, res) => {
  const query = String(req.query.q || '').trim().slice(0, 120);
  const action = String(req.query.action || '').trim().slice(0, 100);
  const targetType = String(req.query.targetType || '').trim().slice(0, 50);
  const dateFrom = String(req.query.dateFrom || '').trim();
  const dateTo = String(req.query.dateTo || '').trim();
  const validDate = (value: string) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!validDate(dateFrom) || !validDate(dateTo)) return res.status(400).json({ error: 'Use valid dates in YYYY-MM-DD format.' });
  const parsedOffset = Number.parseInt(String(req.query.offset || '0'), 10);
  const offset = Number.isFinite(parsedOffset) ? Math.min(100000, Math.max(0, parsedOffset)) : 0;
  const params: any[] = [];
  const filters: string[] = [];
  if (query) {
    const pattern = `%${query}%`;
    filters.push('(a.action LIKE ? OR a.reason LIKE ? OR a.targetId LIKE ? OR actor.name LIKE ? OR actor.email LIKE ? OR w.name LIKE ?)');
    params.push(pattern, pattern, pattern, pattern, pattern, pattern);
  }
  if (action) { filters.push('a.action LIKE ?'); params.push(`%${action}%`); }
  if (targetType) { filters.push('a.targetType = ?'); params.push(targetType); }
  if (dateFrom) { filters.push('a.createdAt >= CONCAT(?, \' 00:00:00\')'); params.push(dateFrom); }
  if (dateTo) { filters.push('a.createdAt < DATE_ADD(CONCAT(?, \' 00:00:00\'), INTERVAL 1 DAY)'); params.push(dateTo); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  try {
    const [totals]: any = await pool.execute(
      `SELECT COUNT(*) AS total FROM PlatformAuditEvents a
       LEFT JOIN PlatformAdminAccounts actor ON actor.id = a.platformAdminId
       LEFT JOIN Workspaces w ON a.targetType = 'workspace' AND w.id = a.targetId
       ${where}`,
      params,
    );
    const [rows]: any = await pool.execute(
      `SELECT a.id, a.action, a.targetType, a.targetId, a.reason,
              DATE_FORMAT(a.createdAt, '%Y-%m-%d %H:%i:%s') AS createdAt,
              COALESCE(actor.name, CASE WHEN a.action = 'workspace.initial_admin_added' THEN 'College administrator'
                                        WHEN a.platformAdminId IS NULL THEN 'Local / system'
                                        ELSE 'Former platform admin' END) AS actorName,
              actor.email AS actorEmail,
              CASE WHEN a.targetType = 'workspace' THEN COALESCE(w.name, a.targetId)
                   WHEN a.targetType = 'platform_admin' THEN COALESCE(targetAdmin.email, a.targetId)
                   ELSE a.targetId END AS targetName
       FROM PlatformAuditEvents a
       LEFT JOIN PlatformAdminAccounts actor ON actor.id = a.platformAdminId
       LEFT JOIN Workspaces w ON a.targetType = 'workspace' AND w.id = a.targetId
       LEFT JOIN PlatformAdminAccounts targetAdmin ON a.targetType = 'platform_admin' AND targetAdmin.id = a.targetId
       ${where}
       ORDER BY a.createdAt DESC, a.id DESC LIMIT 50 OFFSET ?`,
      [...params, offset],
    );
    res.json({ items: rows, total: Number(totals[0]?.total || 0), offset, limit: 50 });
  } catch (error) {
    console.error('Platform audit search failed:', error);
    res.status(500).json({ error: 'Could not load platform audit activity.' });
  }
});

app.get('/api/platform/plans', requirePlatformPermission('platform.plans.manage'), async (_req, res) => {
  try {
    const [rows]: any = await pool.query('SELECT id, name, description, limitsJson, featuresJson, monthlyPricePaise, annualPricePaise, isActive, DATE_FORMAT(updatedAt, \'%Y-%m-%d %H:%i:%s\') AS updatedAt FROM PlatformSubscriptionPlans ORDER BY FIELD(id, \'pilot\', \'campus\', \'campus_plus\')');
    res.json(rows.map((row: any) => ({ id: row.id, name: row.name, description: row.description, monthlyPricePaise: row.monthlyPricePaise === null ? null : Number(row.monthlyPricePaise), annualPricePaise: row.annualPricePaise === null ? null : Number(row.annualPricePaise), limits: parseStoredJson<PlanLimit[]>(row.limitsJson, []), features: parseStoredJson<PlanFeature[]>(row.featuresJson, []), isActive: Boolean(row.isActive), updatedAt: row.updatedAt })));
  } catch (error) {
    console.error('Subscription plan catalog query failed:', error);
    res.status(500).json({ error: 'Could not load subscription plans. Apply the latest database migration.' });
  }
});

app.put('/api/platform/plans/:id', requirePlatformPermission('platform.plans.manage'), async (req, res) => {
  const admin = (req as PlatformAuthenticatedRequest).platformAuth!;
  const planId = req.params.id;
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  const limits = req.body?.limits;
  const features = req.body?.features;
  const monthlyPricePaise = req.body?.monthlyPricePaise;
  const annualPricePaise = req.body?.annualPricePaise;
  const isActive = req.body?.isActive;
  const validPlanIds = new Set(SUBSCRIPTION_PLANS.map((plan) => plan.id));
  const allowedLimits = new Map(SUBSCRIPTION_PLANS[0].limits.map((limit) => [limit.key, limit.unit]));
  const allowedFeatures = new Set(SUBSCRIPTION_PLANS.flatMap((plan) => plan.features));
  const validPrice = (value: unknown) => value === null || (Number.isSafeInteger(value) && Number(value) >= 100 && Number(value) <= 4294967295);
  if (!validPlanIds.has(planId as any) || name.length < 2 || name.length > 120 || description.length > 1000 || reason.length < 5 || reason.length > 1000 || !Array.isArray(limits) || !Array.isArray(features) || typeof isActive !== 'boolean' || !validPrice(monthlyPricePaise) || !validPrice(annualPricePaise)) return res.status(400).json({ error: 'Provide a plan name, description, valid INR prices (at least ₹1) or unset prices, limits, features, active state, and change reason.' });
  const limitKeys = limits.map((limit: any) => limit?.key);
  if (limits.length !== allowedLimits.size || new Set(limitKeys).size !== allowedLimits.size || limits.some((limit: any) => !allowedLimits.has(limit?.key) || limit?.unit !== allowedLimits.get(limit.key) || (limit.value !== null && (!Number.isInteger(limit.value) || limit.value < 0 || limit.value > 10000000)))) return res.status(400).json({ error: 'Each supported plan limit must have a valid non-negative integer value or be unset.' });
  if (features.some((feature: any) => typeof feature !== 'string' || !allowedFeatures.has(feature as PlanFeature)) || new Set(features).size !== features.length) return res.status(400).json({ error: 'The selected plan features are invalid or duplicated.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [currentRows]: any = await connection.execute('SELECT * FROM PlatformSubscriptionPlans WHERE id = ? LIMIT 1 FOR UPDATE', [planId]);
    if (!currentRows.length) { await connection.rollback(); return res.status(404).json({ error: 'Subscription plan not found.' }); }
    if (!isActive) {
      const [[usage]]: any = await connection.execute('SELECT COUNT(*) AS assignedCount FROM WorkspaceSubscriptions WHERE planId = ?', [planId]);
      if (Number(usage.assignedCount) > 0) { await connection.rollback(); return res.status(409).json({ error: 'A plan assigned to colleges cannot be deactivated. Move those subscriptions to another plan first.' }); }
    }
    const before = { name: currentRows[0].name, description: currentRows[0].description, monthlyPricePaise: currentRows[0].monthlyPricePaise === null ? null : Number(currentRows[0].monthlyPricePaise), annualPricePaise: currentRows[0].annualPricePaise === null ? null : Number(currentRows[0].annualPricePaise), limits: parseStoredJson<PlanLimit[]>(currentRows[0].limitsJson, []), features: parseStoredJson<PlanFeature[]>(currentRows[0].featuresJson, []), isActive: Boolean(currentRows[0].isActive) };
    const after = { name, description, monthlyPricePaise, annualPricePaise, limits, features, isActive };
    await connection.execute('UPDATE PlatformSubscriptionPlans SET name = ?, description = ?, monthlyPricePaise = ?, annualPricePaise = ?, limitsJson = ?, featuresJson = ?, isActive = ?, updatedByPlatformAdminId = ? WHERE id = ?', [name, description, monthlyPricePaise, annualPricePaise, JSON.stringify(limits), JSON.stringify(features), isActive ? 1 : 0, admin.platformAdminId, planId]);
    await connection.execute('INSERT INTO PlatformAuditEvents (id, platformAdminId, action, targetType, targetId, reason, beforeJson, afterJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [randomUUID(), admin.platformAdminId, 'subscription.plan_updated', 'subscription_plan', planId, reason, JSON.stringify(before), JSON.stringify(after)]);
    await connection.commit();
    res.json({ success: true, id: planId, ...after });
  } catch (error) {
    await connection.rollback();
    console.error('Subscription plan update failed:', error);
    res.status(500).json({ error: 'Could not save this subscription plan.' });
  } finally { connection.release(); }
});

app.put('/api/platform/workspaces/:id/subscription', requirePlatformPermission('platform.subscriptions.manage'), async (req, res) => {
  const admin = (req as PlatformAuthenticatedRequest).platformAuth!;
  const { planId, status, currentPeriodStart, currentPeriodEnd, internalNote } = req.body || {};
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  const validStatuses = ['not_configured', 'trialing', 'active', 'past_due', 'canceled', 'suspended'];
  const validDate = (value: unknown) => value === null || value === '' || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);
  if (typeof planId !== 'string' || !validStatuses.includes(status) || !validDate(currentPeriodStart) || !validDate(currentPeriodEnd) || (currentPeriodStart && currentPeriodEnd && currentPeriodEnd < currentPeriodStart) || typeof internalNote !== 'string' || internalNote.length > 5000 || reason.length < 5 || reason.length > 1000) return res.status(400).json({ error: 'Choose a plan, valid subscription status and date range, and enter an internal note and change reason.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [planRows]: any = await connection.execute('SELECT id, isActive FROM PlatformSubscriptionPlans WHERE id = ? LIMIT 1', [planId]);
    if (!planRows.length || !Number(planRows[0].isActive)) { await connection.rollback(); return res.status(400).json({ error: 'Select an active plan from the catalog.' }); }
    const [workspaceRows]: any = await connection.execute('SELECT id, name FROM Workspaces WHERE id = ? LIMIT 1 FOR UPDATE', [req.params.id]);
    if (!workspaceRows.length) { await connection.rollback(); return res.status(404).json({ error: 'College workspace not found.' }); }
    await connection.execute('INSERT IGNORE INTO WorkspaceSubscriptions (workspaceId) VALUES (?)', [req.params.id]);
    const [currentRows]: any = await connection.execute('SELECT planId, status, currentPeriodStart, currentPeriodEnd, internalNote FROM WorkspaceSubscriptions WHERE workspaceId = ? LIMIT 1 FOR UPDATE', [req.params.id]);
    const before = { planId: currentRows[0].planId, status: currentRows[0].status, currentPeriodStart: currentRows[0].currentPeriodStart, currentPeriodEnd: currentRows[0].currentPeriodEnd, internalNote: currentRows[0].internalNote || '' };
    const startAt = currentPeriodStart ? `${currentPeriodStart} 00:00:00` : null;
    const endAt = currentPeriodEnd ? `${currentPeriodEnd} 23:59:59` : null;
    const after = { planId, status, currentPeriodStart: currentPeriodStart || null, currentPeriodEnd: currentPeriodEnd || null, internalNote: internalNote.trim() };
    await connection.execute('UPDATE WorkspaceSubscriptions SET planId = ?, status = ?, currentPeriodStart = ?, currentPeriodEnd = ?, internalNote = ? WHERE workspaceId = ?', [planId, status, startAt, endAt, after.internalNote || null, req.params.id]);
    await connection.execute('INSERT INTO PlatformAuditEvents (id, platformAdminId, action, targetType, targetId, reason, beforeJson, afterJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [randomUUID(), admin.platformAdminId, 'workspace.subscription_updated', 'workspace', req.params.id, reason, JSON.stringify(before), JSON.stringify(after)]);
    await connection.commit();
    res.json({ success: true, workspaceName: workspaceRows[0].name, ...after });
  } catch (error) {
    await connection.rollback();
    console.error('Workspace subscription update failed:', error);
    res.status(500).json({ error: 'Could not update this college subscription.' });
  } finally { connection.release(); }
});

app.get('/api/platform/workspaces', requirePlatformPermission('platform.operations.read'), async (req, res) => {
  const query = String(req.query.q || '').trim().slice(0, 100);
  const status = String(req.query.status || 'all');
  if (!['all', 'onboarding', 'active', 'suspended', 'archived'].includes(status)) return res.status(400).json({ error: 'Choose a valid workspace status.' });
  try {
    const params: any[] = [];
    const filters: string[] = [];
    if (status !== 'all') { filters.push('w.lifecycleStatus = ?'); params.push(status); }
    if (query) { filters.push('(LOWER(w.name) LIKE LOWER(?) OR LOWER(w.slug) LIKE LOWER(?))'); params.push(`%${query}%`, `%${query}%`); }
    const [rows]: any = await pool.execute(
      `SELECT w.id, w.name, w.slug, w.lifecycleStatus, w.statusReason,
              DATE_FORMAT(w.createdAt, '%Y-%m-%d %H:%i:%s') AS createdAt,
              COALESCE(s.planId, 'pilot') AS planId, COALESCE(p.name, 'Pilot') AS planName, COALESCE(s.status, 'not_configured') AS subscriptionStatus,
              (SELECT COUNT(*) FROM WorkspaceMemberships m WHERE m.workspaceId = w.id AND m.role = 'student' AND m.status = 'active') AS activeStudents,
              (SELECT COUNT(*) FROM WorkspaceMemberships m WHERE m.workspaceId = w.id AND m.role IN ('college_admin','trainer','panelist') AND m.status = 'active') AS staffCount
       FROM Workspaces w LEFT JOIN WorkspaceSubscriptions s ON s.workspaceId = w.id LEFT JOIN PlatformSubscriptionPlans p ON p.id = s.planId
       ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
       ORDER BY FIELD(w.lifecycleStatus, 'onboarding', 'active', 'suspended', 'archived'), w.createdAt DESC LIMIT 500`,
      params,
    );
    res.json(rows);
  } catch (error) {
    console.error('Platform workspace directory query failed:', error);
    res.status(500).json({ error: 'Could not load college workspaces.' });
  }
});

app.get('/api/platform/workspaces/:id', requirePlatformPermission('platform.operations.read'), async (req, res) => {
  try {
    const [rows]: any = await pool.execute(
      `SELECT w.id, w.name, w.slug, w.lifecycleStatus, w.statusReason,
              DATE_FORMAT(w.createdAt, '%Y-%m-%d %H:%i:%s') AS createdAt,
              DATE_FORMAT(w.lifecycleUpdatedAt, '%Y-%m-%d %H:%i:%s') AS lifecycleUpdatedAt,
              s.planId, s.status AS subscriptionStatus, s.billingInterval, s.currency, s.internalNote,
              DATE_FORMAT(s.currentPeriodStart, '%Y-%m-%d') AS currentPeriodStart,
              DATE_FORMAT(s.currentPeriodEnd, '%Y-%m-%d') AS currentPeriodEnd,
              DATE_FORMAT(s.trialEndsAt, '%Y-%m-%d') AS trialEndsAt, s.cancelAtPeriodEnd,
              (SELECT COUNT(*) FROM WorkspaceMemberships m WHERE m.workspaceId = w.id AND m.role = 'student' AND m.status = 'active') AS activeStudents,
              (SELECT COUNT(*) FROM WorkspaceMemberships m WHERE m.workspaceId = w.id AND m.role IN ('college_admin','trainer','panelist') AND m.status = 'active') AS staffCount,
              (SELECT COUNT(*) FROM Batches b WHERE b.workspaceId = w.id AND b.isArchived = 0) AS activeBatches
       FROM Workspaces w LEFT JOIN WorkspaceSubscriptions s ON s.workspaceId = w.id WHERE w.id = ? LIMIT 1`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'College workspace not found.' });
    const workspacePlan = await getPlanDefinitionFromDb(pool, rows[0].planId || 'pilot');
    const [contacts]: any = await pool.execute(
      `SELECT u.name, u.email, m.status, u.isActive AS accountActive FROM WorkspaceMemberships m JOIN Users u ON u.id = m.userId
       WHERE m.workspaceId = ? AND m.role = 'college_admin' ORDER BY (m.status = 'active') DESC, u.name ASC`,
      [req.params.id],
    );
    const [adminInvitations]: any = await pool.execute(
      `SELECT i.id, i.email, i.acceptedAt IS NOT NULL AS accepted, i.revokedAt IS NOT NULL AS revoked,
              i.expiresAt <= UTC_TIMESTAMP() AS expired,
              DATE_FORMAT(i.createdAt, '%Y-%m-%d %H:%i:%s') AS createdAt,
              DATE_FORMAT(i.expiresAt, '%Y-%m-%d %H:%i:%s') AS expiresAt,
              DATE_FORMAT(i.acceptedAt, '%Y-%m-%d %H:%i:%s') AS acceptedAt,
              DATE_FORMAT(i.revokedAt, '%Y-%m-%d %H:%i:%s') AS revokedAt,
              a.name AS invitedBy
       FROM PlatformWorkspaceAdminInvitations i
       JOIN PlatformAdminAccounts a ON a.id = i.invitedByPlatformAdminId
       WHERE i.workspaceId = ? ORDER BY i.createdAt DESC LIMIT 100`,
      [req.params.id],
    );
    const invitationsWithStatus = adminInvitations.map((invitation: any) => ({
      ...invitation,
      status: invitation.accepted ? 'accepted' : invitation.revoked ? 'revoked' : invitation.expired ? 'expired' : 'pending',
      canResend: !invitation.accepted && !invitation.revoked,
      canRevoke: !invitation.accepted && !invitation.revoked && !invitation.expired,
    }));
    const initialAdminInvitation = invitationsWithStatus[invitationsWithStatus.length - 1] || null;
    const activeCollegeAdminCount = contacts.filter((contact: any) => Number(contact.status === 'active') && Number(contact.accountActive) === 1).length;
    const [audit]: any = await pool.execute(
      `SELECT action, reason, DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s') AS createdAt
       FROM PlatformAuditEvents WHERE targetType = 'workspace' AND targetId = ? ORDER BY createdAt DESC LIMIT 20`,
      [req.params.id],
    );
    res.json({
      ...rows[0],
      planName: workspacePlan.name,
      planDescription: workspacePlan.description,
      collegeAdmins: contacts,
      adminInvitations: invitationsWithStatus,
      initialAdminInvitation,
      onboardingReadiness: {
        workspaceCreated: true,
        activeCollegeAdminCount,
        hasActiveCollegeAdmin: activeCollegeAdminCount > 0,
        canActivate: activeCollegeAdminCount > 0,
      },
      recentPlatformActivity: audit,
    });
  } catch (error) {
    console.error('Platform workspace detail query failed:', error);
    res.status(500).json({ error: 'Could not load this workspace.' });
  }
});

app.post('/api/platform/workspaces', requirePlatformPermission('platform.workspaces.manage'), async (req, res) => {
  const admin = (req as PlatformAuthenticatedRequest).platformAuth!;
  const { name, adminName, adminEmail } = req.body || {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.length > 191 || typeof adminName !== 'string' || adminName.trim().length < 2 || adminName.length > 191 || !validEmail(adminEmail)) return res.status(400).json({ error: 'Enter a college name and the first administrator’s name and email.' });
  if (!(await reserveAccountEmailRateLimit(null, adminEmail, 'college_admin_invitation', req.ip))) return res.status(429).json({ code: 'EMAIL_RATE_LIMITED', error: 'Too many administrator invitation emails were requested. Try again later.' });
  const connection = await pool.getConnection();
  const token = randomBytes(32).toString('base64url');
  try {
    await connection.beginTransaction();
    const id = randomUUID();
    const collegeName = name.trim();
    const slug = `${collegeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 140) || 'college'}-${id.slice(0, 8)}`;
    await connection.execute("INSERT INTO Workspaces (id, name, slug, lifecycleStatus) VALUES (?, ?, ?, 'onboarding')", [id, collegeName, slug]);
    await ensureWorkspaceSubscription(connection, id);
    await connection.execute(
      `INSERT INTO PlatformWorkspaceAdminInvitations (id, workspaceId, email, tokenHash, invitedByPlatformAdminId, expiresAt)
       VALUES (?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 72 HOUR))`,
      [randomUUID(), id, adminEmail.toLowerCase(), hashToken(token), admin.platformAdminId],
    );
    await connection.execute('INSERT INTO PlatformAuditEvents (id, platformAdminId, action, targetType, targetId, reason, afterJson) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [randomUUID(), admin.platformAdminId, 'workspace.created', 'workspace', id, 'Provisioned with onboarding status', JSON.stringify({ name: collegeName, initialAdmin: adminEmail.toLowerCase() })]);
    await connection.commit();
    const inviteUrl = `/platform-admin?collegeInvite=${encodeURIComponent(token)}`;
    const delivery = await sendAccountLifecycleEmail(req, { workspaceId: id, recipientEmail: adminEmail.toLowerCase(), recipientName: adminName.trim(), type: 'college_admin_invitation', relatedEntityId: id, heading: `Set up ${collegeName} on TalentEdge`, message: `${adminName.trim()} has been invited to become the first administrator for ${collegeName}.`, actionLabel: 'Set up administrator account', actionUrl: inviteUrl, expiry: 'This invitation link expires in 72 hours.', rateLimitReserved: true });
    res.status(201).json({ id, name: collegeName, lifecycleStatus: 'onboarding', inviteUrl: `${req.protocol}://${req.get('host')}${inviteUrl}`, delivery });
  } catch (error: any) {
    await connection.rollback();
    console.error('Platform workspace creation failed:', error);
    res.status(500).json({ error: error?.code === 'ER_DUP_ENTRY' ? 'This workspace name or administrator email is already in use.' : 'Could not create this workspace.' });
  } finally { connection.release(); }
});

app.post('/api/platform/workspaces/:id/admin-invitations', requirePlatformPermission('platform.workspaces.manage'), async (req, res) => {
  const admin = (req as PlatformAuthenticatedRequest).platformAuth!;
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid first college administrator email.' });
  if (!(await reserveAccountEmailRateLimit(req.params.id, email, 'college_admin_invitation', req.ip))) return res.status(429).json({ code: 'EMAIL_RATE_LIMITED', error: 'Too many administrator invitation emails were requested. Try again later.' });
  const token = randomBytes(32).toString('base64url');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [workspaces]: any = await connection.execute('SELECT id, lifecycleStatus FROM Workspaces WHERE id = ? LIMIT 1 FOR UPDATE', [req.params.id]);
    if (!workspaces.length) { await connection.rollback(); return res.status(404).json({ error: 'College workspace not found.' }); }
    if (['suspended', 'archived'].includes(workspaces[0].lifecycleStatus)) { await connection.rollback(); return res.status(409).json({ error: 'Reactivate this workspace before inviting an administrator.' }); }
    const [existingAdmins]: any = await connection.execute('SELECT id FROM WorkspaceMemberships WHERE workspaceId = ? AND userId IN (SELECT id FROM Users WHERE email = ?) AND role = \'college_admin\' AND status = \'active\' LIMIT 1', [req.params.id, email]);
    if (existingAdmins.length) { await connection.rollback(); return res.status(409).json({ error: 'This person is already an active college administrator.' }); }
    await connection.execute(
      'UPDATE PlatformWorkspaceAdminInvitations SET revokedAt = UTC_TIMESTAMP() WHERE workspaceId = ? AND email = ? AND acceptedAt IS NULL AND revokedAt IS NULL AND expiresAt > UTC_TIMESTAMP()',
      [req.params.id, email],
    );
    const invitationId = randomUUID();
    await connection.execute('INSERT INTO PlatformWorkspaceAdminInvitations (id, workspaceId, email, tokenHash, invitedByPlatformAdminId, expiresAt) VALUES (?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 72 HOUR))', [invitationId, req.params.id, email, hashToken(token), admin.platformAdminId]);
    await connection.execute('INSERT INTO PlatformAuditEvents (id, platformAdminId, action, targetType, targetId, reason, afterJson) VALUES (?, ?, ?, ?, ?, ?, ?)', [randomUUID(), admin.platformAdminId, 'workspace.admin_invited', 'workspace', req.params.id, `Administrator invitation created for ${email}; prior pending links for this address were revoked`, JSON.stringify({ invitationId, email })]);
    await connection.commit();
    const invitePath = `/platform-admin?collegeInvite=${encodeURIComponent(token)}`;
    const delivery = await sendAccountLifecycleEmail(req, { workspaceId: req.params.id, recipientEmail: email, type: 'college_admin_invitation', relatedEntityId: invitationId, heading: 'You are invited to manage a TalentEdge workspace', message: 'You have been invited to become a college administrator. Use the secure link to set up your account.', actionLabel: 'Accept administrator invitation', actionUrl: invitePath, expiry: 'This invitation link expires in 72 hours.', rateLimitReserved: true });
    res.status(201).json({ invitationId, email, inviteUrl: `${req.protocol}://${req.get('host')}${invitePath}`, delivery });
  } catch (error) { await connection.rollback(); console.error('College administrator invitation creation failed:', error); res.status(500).json({ error: 'Could not create this college administrator invitation.' }); }
  finally { connection.release(); }
});

app.post('/api/platform/workspaces/:id/admin-invitations/:invitationId/resend', requirePlatformPermission('platform.workspaces.manage'), async (req, res) => {
  const admin = (req as PlatformAuthenticatedRequest).platformAuth!;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 5 || reason.length > 1000) return res.status(400).json({ error: 'Provide a reason of at least five characters for resending this invitation.' });
  const token = randomBytes(32).toString('base64url');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [workspaces]: any = await connection.execute('SELECT id, lifecycleStatus FROM Workspaces WHERE id = ? LIMIT 1 FOR UPDATE', [req.params.id]);
    if (!workspaces.length) { await connection.rollback(); return res.status(404).json({ error: 'College workspace not found.' }); }
    if (['suspended', 'archived'].includes(workspaces[0].lifecycleStatus)) { await connection.rollback(); return res.status(409).json({ error: 'Reactivate this workspace before resending an administrator invitation.' }); }
    const [invites]: any = await connection.execute('SELECT id, email, acceptedAt, revokedAt, expiresAt > UTC_TIMESTAMP() AS pending FROM PlatformWorkspaceAdminInvitations WHERE id = ? AND workspaceId = ? LIMIT 1 FOR UPDATE', [req.params.invitationId, req.params.id]);
    if (!invites.length) { await connection.rollback(); return res.status(404).json({ error: 'Administrator invitation not found.' }); }
    if (invites[0].acceptedAt) { await connection.rollback(); return res.status(409).json({ error: 'This invitation has already been accepted. Create a new invitation for another administrator.' }); }
    if (invites[0].revokedAt) { await connection.rollback(); return res.status(409).json({ error: 'This invitation was revoked. Create a new invitation instead.' }); }
    if (!(await reserveAccountEmailRateLimit(req.params.id, invites[0].email, 'college_admin_invitation', req.ip))) { await connection.rollback(); return res.status(429).json({ code: 'EMAIL_RATE_LIMITED', error: 'Too many administrator invitation emails were requested. Try again later.' }); }
    const [activeAdmins]: any = await connection.execute('SELECT id FROM WorkspaceMemberships WHERE workspaceId = ? AND userId IN (SELECT id FROM Users WHERE email = ?) AND role = \'college_admin\' AND status = \'active\' LIMIT 1', [req.params.id, invites[0].email]);
    if (activeAdmins.length) { await connection.rollback(); return res.status(409).json({ error: 'This person is already an active college administrator.' }); }
    await connection.execute('UPDATE PlatformWorkspaceAdminInvitations SET revokedAt = UTC_TIMESTAMP() WHERE workspaceId = ? AND email = ? AND acceptedAt IS NULL AND revokedAt IS NULL AND expiresAt > UTC_TIMESTAMP()', [req.params.id, invites[0].email]);
    const newInvitationId = randomUUID();
    await connection.execute('INSERT INTO PlatformWorkspaceAdminInvitations (id, workspaceId, email, tokenHash, invitedByPlatformAdminId, expiresAt) VALUES (?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 72 HOUR))', [newInvitationId, req.params.id, invites[0].email, hashToken(token), admin.platformAdminId]);
    await connection.execute('INSERT INTO PlatformAuditEvents (id, platformAdminId, action, targetType, targetId, reason, beforeJson, afterJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [randomUUID(), admin.platformAdminId, 'workspace.admin_invitation_resent', 'workspace', req.params.id, reason, JSON.stringify({ invitationId: invites[0].id, email: invites[0].email }), JSON.stringify({ invitationId: newInvitationId, email: invites[0].email })]);
    await connection.commit();
    const invitePath = `/platform-admin?collegeInvite=${encodeURIComponent(token)}`;
    const delivery = await sendAccountLifecycleEmail(req, { workspaceId: req.params.id, recipientEmail: invites[0].email, type: 'college_admin_invitation', relatedEntityId: newInvitationId, heading: 'Your TalentEdge administrator invitation was renewed', message: 'A fresh administrator invitation link has been issued for this college workspace.', actionLabel: 'Accept administrator invitation', actionUrl: invitePath, expiry: 'This new link expires in 72 hours. The previous pending link is no longer valid.', rateLimitReserved: true });
    res.json({ invitationId: newInvitationId, email: invites[0].email, inviteUrl: `${req.protocol}://${req.get('host')}${invitePath}`, delivery });
  } catch (error) { await connection.rollback(); console.error('College administrator invitation resend failed:', error); res.status(500).json({ error: 'Could not resend this college administrator invitation.' }); }
  finally { connection.release(); }
});

app.post('/api/platform/workspaces/:id/admin-invitations/:invitationId/revoke', requirePlatformPermission('platform.workspaces.manage'), async (req, res) => {
  const admin = (req as PlatformAuthenticatedRequest).platformAuth!;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 5 || reason.length > 1000) return res.status(400).json({ error: 'Provide a reason of at least five characters for revoking this invitation.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [workspaces]: any = await connection.execute('SELECT id FROM Workspaces WHERE id = ? LIMIT 1 FOR UPDATE', [req.params.id]);
    if (!workspaces.length) { await connection.rollback(); return res.status(404).json({ error: 'College workspace not found.' }); }
    const [invites]: any = await connection.execute('SELECT id, email, acceptedAt, revokedAt, expiresAt > UTC_TIMESTAMP() AS pending FROM PlatformWorkspaceAdminInvitations WHERE id = ? AND workspaceId = ? LIMIT 1 FOR UPDATE', [req.params.invitationId, req.params.id]);
    if (!invites.length) { await connection.rollback(); return res.status(404).json({ error: 'Administrator invitation not found.' }); }
    if (invites[0].acceptedAt) { await connection.rollback(); return res.status(409).json({ error: 'An accepted invitation cannot be revoked. Deactivate the workspace member instead.' }); }
    if (invites[0].revokedAt) { await connection.rollback(); return res.status(409).json({ error: 'This invitation has already been revoked.' }); }
    if (!Number(invites[0].pending)) { await connection.rollback(); return res.status(409).json({ error: 'This invitation has expired already.' }); }
    await connection.execute('UPDATE PlatformWorkspaceAdminInvitations SET revokedAt = UTC_TIMESTAMP() WHERE id = ?', [invites[0].id]);
    await connection.execute('INSERT INTO PlatformAuditEvents (id, platformAdminId, action, targetType, targetId, reason, beforeJson, afterJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [randomUUID(), admin.platformAdminId, 'workspace.admin_invitation_revoked', 'workspace', req.params.id, reason, JSON.stringify({ invitationId: invites[0].id, email: invites[0].email, status: 'pending' }), JSON.stringify({ invitationId: invites[0].id, email: invites[0].email, status: 'revoked' })]);
    await connection.commit();
    res.json({ success: true });
  } catch (error) { await connection.rollback(); console.error('College administrator invitation revoke failed:', error); res.status(500).json({ error: 'Could not revoke this college administrator invitation.' }); }
  finally { connection.release(); }
});

app.patch('/api/platform/workspaces/:id/status', requirePlatformPermission('platform.workspaces.manage'), async (req, res) => {
  const admin = (req as PlatformAuthenticatedRequest).platformAuth!;
  const status = String(req.body?.status || '');
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!['onboarding', 'active', 'suspended', 'archived'].includes(status) || reason.length < 5 || reason.length > 1000) return res.status(400).json({ error: 'Choose a valid workspace state and provide a reason of at least five characters.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows]: any = await connection.execute('SELECT id, name, lifecycleStatus, statusReason FROM Workspaces WHERE id = ? LIMIT 1 FOR UPDATE', [req.params.id]);
    if (!rows.length) { await connection.rollback(); return res.status(404).json({ error: 'College workspace not found.' }); }
    if (status === 'active') {
      const [activeAdmins]: any = await connection.execute(
        `SELECT 1 FROM WorkspaceMemberships m JOIN Users u ON u.id = m.userId
         WHERE m.workspaceId = ? AND m.role = 'college_admin' AND m.status = 'active' AND u.isActive = 1 LIMIT 1`,
        [req.params.id],
      );
      if (!activeAdmins.length) {
        await connection.rollback();
        return res.status(409).json({ error: 'An active college administrator must accept the invitation before this workspace can be activated.' });
      }
    }
    const before = { lifecycleStatus: rows[0].lifecycleStatus, statusReason: rows[0].statusReason };
    const after = { lifecycleStatus: status, statusReason: reason };
    await connection.execute('UPDATE Workspaces SET lifecycleStatus = ?, statusReason = ?, lifecycleUpdatedAt = UTC_TIMESTAMP() WHERE id = ?', [status, reason, req.params.id]);
    await connection.execute('INSERT INTO PlatformAuditEvents (id, platformAdminId, action, targetType, targetId, reason, beforeJson, afterJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [randomUUID(), admin.platformAdminId, `workspace.${status}`, 'workspace', req.params.id, reason, JSON.stringify(before), JSON.stringify(after)]);
    if (['suspended', 'archived'].includes(status)) await connection.execute('DELETE FROM AuthSessions WHERE workspaceId = ?', [req.params.id]);
    await connection.commit();
    res.json({ success: true, ...after });
  } catch (error) {
    await connection.rollback();
    console.error('Platform workspace status update failed:', error);
    res.status(500).json({ error: 'Could not update this workspace status.' });
  } finally { connection.release(); }
});

app.post('/api/platform/admin-invitations', requirePlatformPermission('platform.settings.manage'), async (req, res) => {
  const admin = (req as PlatformAuthenticatedRequest).platformAuth!;
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid platform administrator email.' });
  if (!(await reserveAccountEmailRateLimit(null, email, 'platform_admin_invitation', req.ip))) return res.status(429).json({ code: 'EMAIL_RATE_LIMITED', error: 'Too many platform invitation emails were requested. Try again later.' });
  const token = randomBytes(32).toString('base64url');
  try {
    const [existing]: any = await pool.execute('SELECT id FROM PlatformAdminAccounts WHERE email = ? LIMIT 1', [email]);
    if (existing.length) return res.status(409).json({ error: 'A platform administrator already uses this email.' });
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('UPDATE PlatformAdminInvitations SET expiresAt = UTC_TIMESTAMP() WHERE email = ? AND acceptedAt IS NULL', [email]);
      await connection.execute('INSERT INTO PlatformAdminInvitations (id, email, tokenHash, invitedByPlatformAdminId, expiresAt) VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 72 HOUR))', [randomUUID(), email, hashToken(token), admin.platformAdminId]);
      await connection.execute('INSERT INTO PlatformAuditEvents (id, platformAdminId, action, targetType, targetId, reason) VALUES (?, ?, ?, ?, ?, ?)', [randomUUID(), admin.platformAdminId, 'platform_admin.invited', 'platform_admin_invitation', email, 'Invitation link generated for out-of-band delivery']);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
    const invitePath = `/platform-admin?invite=${encodeURIComponent(token)}`;
    const delivery = await sendAccountLifecycleEmail(req, { workspaceId: null, recipientEmail: email, type: 'platform_admin_invitation', relatedEntityId: email, heading: 'You are invited to administer TalentEdge', message: 'A platform administrator invited you to join the TalentEdge platform operations team.', actionLabel: 'Set up platform account', actionUrl: invitePath, expiry: 'This invitation link expires in 72 hours.', rateLimitReserved: true });
    res.status(201).json({ inviteUrl: `${req.protocol}://${req.get('host')}${invitePath}`, delivery });
  } catch (error) {
    console.error('Platform administrator invitation failed:', error);
    res.status(500).json({ error: 'Could not create this platform administrator invitation.' });
  }
});

app.post('/api/platform/admins/:id/mfa-reset', requirePlatformPermission('platform.settings.manage'), async (req, res) => {
  const actor = (req as PlatformAuthenticatedRequest).platformAuth!;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 5 || reason.length > 1000) return res.status(400).json({ error: 'Provide a reason of at least five characters.' });
  try {
    const [targets]: any = await pool.execute('SELECT id, email FROM PlatformAdminAccounts WHERE id = ? AND isActive = 1 LIMIT 1', [req.params.id]);
    if (!targets.length) return res.status(404).json({ error: 'Active platform administrator not found.' });
    if (!(await reserveAccountEmailRateLimit(null, targets[0].email, 'mfa_reset', req.ip))) return res.status(429).json({ code: 'EMAIL_RATE_LIMITED', error: 'Too many authenticator reset emails were requested. Try again later.' });
    const token = randomBytes(32).toString('base64url');
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('UPDATE PlatformAdminMfaResets SET expiresAt = UTC_TIMESTAMP() WHERE platformAdminId = ? AND usedAt IS NULL', [req.params.id]);
      await connection.execute('INSERT INTO PlatformAdminMfaResets (id, platformAdminId, tokenHash, requestedByPlatformAdminId, reason, expiresAt) VALUES (?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR))', [randomUUID(), req.params.id, hashToken(token), actor.platformAdminId, reason]);
      await connection.execute('INSERT INTO PlatformAuditEvents (id, platformAdminId, action, targetType, targetId, reason) VALUES (?, ?, ?, ?, ?, ?)', [randomUUID(), actor.platformAdminId, 'platform_admin.mfa_reset_requested', 'platform_admin', req.params.id, reason]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
    const resetPath = `/platform-admin?mfaReset=${encodeURIComponent(token)}`;
    const delivery = await sendAccountLifecycleEmail(req, { workspaceId: null, recipientEmail: targets[0].email, type: 'mfa_reset', relatedEntityId: req.params.id, heading: 'Reset your TalentEdge authenticator', message: `A platform administrator initiated an authenticator reset. Reason: ${reason}`, actionLabel: 'Set up a new authenticator', actionUrl: resetPath, expiry: 'This reset link expires in one hour.', rateLimitReserved: true });
    res.status(201).json({ email: targets[0].email, inviteUrl: `${req.protocol}://${req.get('host')}${resetPath}`, delivery });
  } catch (error) { console.error('Platform MFA reset creation failed:', error); res.status(500).json({ error: 'Could not create an MFA reset link.' }); }
});

app.get('/api/platform/auth/mfa-resets/:token', async (req, res) => {
  try {
    const [rows]: any = await pool.execute(
      `SELECT a.email FROM PlatformAdminMfaResets r JOIN PlatformAdminAccounts a ON a.id = r.platformAdminId
       WHERE r.tokenHash = ? AND r.usedAt IS NULL AND r.expiresAt > UTC_TIMESTAMP() AND a.isActive = 1 LIMIT 1`,
      [hashToken(String(req.params.token || ''))],
    );
    if (!rows.length) return res.status(404).json({ error: 'MFA reset link is invalid or expired.' });
    res.json({ email: rows[0].email, totpSecret: generateTotpSecret() });
  } catch (error) { console.error('Platform MFA reset lookup failed:', error); res.status(500).json({ error: 'Could not load MFA reset.' }); }
});

app.post('/api/platform/auth/mfa-resets/complete', async (req, res) => {
  const { token, totpSecret, code } = req.body || {};
  if (typeof token !== 'string' || typeof totpSecret !== 'string' || totpSecret.length < 24 || !verifyTotp(totpSecret, code)) return res.status(400).json({ error: 'Enter a valid authenticator code for the new secret.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows]: any = await connection.execute(
      `SELECT r.id, r.platformAdminId, r.requestedByPlatformAdminId FROM PlatformAdminMfaResets r
       JOIN PlatformAdminAccounts a ON a.id = r.platformAdminId
       WHERE r.tokenHash = ? AND r.usedAt IS NULL AND r.expiresAt > UTC_TIMESTAMP() AND a.isActive = 1 LIMIT 1 FOR UPDATE`,
      [hashToken(token)],
    );
    if (!rows.length) { await connection.rollback(); return res.status(400).json({ error: 'MFA reset link is invalid or expired.' }); }
    const reset = rows[0];
    await connection.execute('UPDATE PlatformAdminAccounts SET totpSecretEncrypted = ? WHERE id = ?', [encryptTotpSecret(totpSecret), reset.platformAdminId]);
    await connection.execute('UPDATE PlatformAdminMfaResets SET usedAt = UTC_TIMESTAMP() WHERE id = ?', [reset.id]);
    await connection.execute('DELETE FROM PlatformAdminSessions WHERE platformAdminId = ?', [reset.platformAdminId]);
    await connection.execute('INSERT INTO PlatformAuditEvents (id, platformAdminId, action, targetType, targetId, reason) VALUES (?, ?, ?, ?, ?, ?)', [randomUUID(), reset.requestedByPlatformAdminId, 'platform_admin.mfa_reset_completed', 'platform_admin', reset.platformAdminId, 'Authenticator re-enrolled through one-time reset link']);
    await connection.commit();
    res.json({ success: true });
  } catch (error) { await connection.rollback(); console.error('Platform MFA reset completion failed:', error); res.status(500).json({ error: 'Could not complete MFA reset.' }); }
  finally { connection.release(); }
});

app.get('/api/platform/admins', requirePlatformPermission('platform.settings.manage'), async (_req, res) => {
  try {
    const [rows]: any = await pool.query('SELECT id, name, email, isActive, DATE_FORMAT(lastLoginAt, \'%Y-%m-%d %H:%i:%s\') AS lastLoginAt, DATE_FORMAT(createdAt, \'%Y-%m-%d %H:%i:%s\') AS createdAt FROM PlatformAdminAccounts ORDER BY isActive DESC, name ASC');
    res.json(rows.map((row: any) => ({ ...row, isActive: Boolean(row.isActive) })));
  } catch (error) { console.error('Platform administrators query failed:', error); res.status(500).json({ error: 'Could not load platform administrators.' }); }
});

app.patch('/api/platform/admins/:id/status', requirePlatformPermission('platform.settings.manage'), async (req, res) => {
  const actor = (req as PlatformAuthenticatedRequest).platformAuth!;
  const isActive = req.body?.isActive;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (typeof isActive !== 'boolean' || reason.length < 5 || reason.length > 1000) return res.status(400).json({ error: 'Provide an active state and a reason of at least five characters.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows]: any = await connection.execute('SELECT id, name, email, isActive FROM PlatformAdminAccounts WHERE id = ? LIMIT 1 FOR UPDATE', [req.params.id]);
    if (!rows.length) { await connection.rollback(); return res.status(404).json({ error: 'Platform administrator not found.' }); }
    if (!isActive && rows[0].isActive) {
      const [activeAdmins]: any = await connection.query('SELECT id FROM PlatformAdminAccounts WHERE isActive = 1 FOR UPDATE');
      if (activeAdmins.length <= 1) { await connection.rollback(); return res.status(409).json({ error: 'The last active platform administrator cannot be deactivated.' }); }
    }
    await connection.execute('UPDATE PlatformAdminAccounts SET isActive = ? WHERE id = ?', [isActive ? 1 : 0, req.params.id]);
    if (!isActive) await connection.execute('DELETE FROM PlatformAdminSessions WHERE platformAdminId = ?', [req.params.id]);
    await connection.execute('INSERT INTO PlatformAuditEvents (id, platformAdminId, action, targetType, targetId, reason, beforeJson, afterJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [randomUUID(), actor.platformAdminId, isActive ? 'platform_admin.activated' : 'platform_admin.deactivated', 'platform_admin', req.params.id, reason, JSON.stringify({ isActive: Boolean(rows[0].isActive) }), JSON.stringify({ isActive })]);
    await connection.commit();
    res.json({ success: true, isActive });
  } catch (error) { await connection.rollback(); console.error('Platform administrator status update failed:', error); res.status(500).json({ error: 'Could not update this platform administrator.' }); }
  finally { connection.release(); }
});

// Panelist accounts are limited to their assigned interviews and account maintenance.
app.use('/api', (req, res, next) => {
  const auth = (req as AuthenticatedRequest).auth;
  if (auth?.role !== 'panelist') return next();
  const allowed = (req.method === 'GET' && ['/auth/me', '/interview-schedules/assigned', '/notifications'].includes(req.path))
    || (req.method === 'POST' && (req.path === '/auth/logout' || /^\/interview-schedules\/[^/]+\/evaluation$/.test(req.path)))
    || (req.method === 'PATCH' && (/^\/notifications\/[^/]+\/read$/.test(req.path) || req.path === '/auth/profile'))
    || (req.method === 'POST' && req.path === '/auth/change-password');
  if (!allowed) return res.status(403).json({ error: 'Panelist accounts can only access assigned interviews and their account settings.' });
  next();
});

function getRazorpayCredentials() {
  const keyId = process.env.RAZORPAY_KEY_ID || '';
  const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
  return keyId && keySecret ? { keyId, keySecret } : null;
}

async function razorpayRequest<T = any>(resource: string, method = 'GET', body?: Record<string, unknown>): Promise<T> {
  const credentials = getRazorpayCredentials();
  if (!credentials) throw new Error('Razorpay is not configured. Add server-side API credentials to enable billing.');
  const response = await fetch(`https://api.razorpay.com/v1${resource}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${credentials.keyId}:${credentials.keySecret}`).toString('base64')}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12000),
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.description || `Razorpay request failed (${response.status}).`);
  return data as T;
}

function safeHexEqual(expected: string, actual: string) {
  if (!/^[a-f0-9]{64}$/i.test(actual) || expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}

function isRazorpayInvoiceUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'rzp.io' || url.hostname === 'razorpay.com' || url.hostname.endsWith('.razorpay.com'));
  } catch { return false; }
}

function periodEndFrom(start: Date, interval: 'monthly' | 'annual') {
  const end = new Date(start);
  if (interval === 'annual') end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return end;
}

let billingCancellationWorkerRunning = false;
async function processBillingCancellationQueue() {
  if (billingCancellationWorkerRunning || !getRazorpayCredentials()) return;
  billingCancellationWorkerRunning = true;
  try {
    const [rows]: any = await pool.query("SELECT id, providerSubscriptionId FROM WorkspaceBillingCancellationQueue WHERE attempts < 10 AND (status IN ('pending','failed') OR (status = 'processing' AND updatedAt < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 MINUTE))) ORDER BY createdAt LIMIT 5");
    for (const row of rows) {
      const [claim]: any = await pool.execute("UPDATE WorkspaceBillingCancellationQueue SET status = 'processing' WHERE id = ? AND (status IN ('pending','failed') OR (status = 'processing' AND updatedAt < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 MINUTE)))", [row.id]);
      if (!claim.affectedRows) continue;
      try {
        await razorpayRequest(`/subscriptions/${encodeURIComponent(row.providerSubscriptionId)}/cancel`, 'POST', { cancel_at_cycle_end: 1 });
        await pool.execute("UPDATE WorkspaceBillingCancellationQueue SET status = 'completed', lastError = NULL WHERE id = ?", [row.id]);
      } catch (error) {
        await pool.execute("UPDATE WorkspaceBillingCancellationQueue SET status = 'failed', attempts = attempts + 1, lastError = ? WHERE id = ?", [String(error).slice(0, 490), row.id]);
      }
    }
  } catch (error) { console.warn('Billing cancellation queue is not ready:', error); }
  finally { billingCancellationWorkerRunning = false; }
}
const billingCancellationTimer = setInterval(() => { void processBillingCancellationQueue(); }, 30000);
billingCancellationTimer.unref();

async function saveBillingPayment(attempt: any, subscription: any, payment: any, status: 'paid' | 'failed') {
  if (!payment?.id) return;
  const year = new Date().getUTCFullYear();
  const invoiceNumber = `TE-${year}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const invoiceId = payment.invoice_id || null;
  const periodStart = subscription?.current_start ? new Date(Number(subscription.current_start) * 1000) : null;
  const periodEnd = subscription?.current_end ? new Date(Number(subscription.current_end) * 1000) : null;
  await pool.execute(
    `INSERT INTO WorkspaceBillingInvoices
     (id, invoiceNumber, workspaceId, billingAttemptId, planId, billingInterval, amountPaise, currency, status,
      providerPaymentId, providerInvoiceId, providerSubscriptionId, invoiceUrl, paymentMethod, issuedAt, periodStart, periodEnd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?, ?)
     ON DUPLICATE KEY UPDATE status = IF(VALUES(status) = 'paid', 'paid', status),
       providerInvoiceId = COALESCE(VALUES(providerInvoiceId), providerInvoiceId), invoiceUrl = COALESCE(VALUES(invoiceUrl), invoiceUrl)`,
    [randomUUID(), invoiceNumber, attempt.workspaceId, attempt.id, attempt.planId, attempt.billingInterval,
      Number(payment.amount || attempt.amountPaise), payment.currency || 'INR', status, payment.id, invoiceId,
      subscription?.id || attempt.providerSubscriptionId, null, payment.method || null, periodStart, periodEnd],
  );
}

async function activateBillingAttempt(attemptId: string, providerSubscriptionId: string, paymentId?: string, subscriptionEntity?: any) {
  const connection = await pool.getConnection();
  let previousProviderSubscriptionId: string | null = null;
  let previousCancelAtPeriodEnd = false;
  let attempt: any;
  try {
    await connection.beginTransaction();
    const [attemptRows]: any = await connection.execute('SELECT * FROM WorkspaceBillingAttempts WHERE id = ? AND providerSubscriptionId = ? FOR UPDATE', [attemptId, providerSubscriptionId]);
    attempt = attemptRows[0];
    if (!attempt) { await connection.rollback(); return null; }
    const [subscriptionRows]: any = await connection.execute('SELECT providerSubscriptionId, cancelAtPeriodEnd FROM WorkspaceSubscriptions WHERE workspaceId = ? FOR UPDATE', [attempt.workspaceId]);
    previousProviderSubscriptionId = subscriptionRows[0]?.providerSubscriptionId || null;
    previousCancelAtPeriodEnd = Boolean(subscriptionRows[0]?.cancelAtPeriodEnd);
    const start = subscriptionEntity?.current_start ? new Date(Number(subscriptionEntity.current_start) * 1000) : new Date();
    const end = subscriptionEntity?.current_end ? new Date(Number(subscriptionEntity.current_end) * 1000) : periodEndFrom(start, attempt.billingInterval);
    await connection.execute(
      `UPDATE WorkspaceSubscriptions SET planId = ?, status = 'active', billingInterval = ?, currency = 'INR',
       currentPeriodStart = ?, currentPeriodEnd = ?, trialEndsAt = NULL,
       cancelAtPeriodEnd = IF(providerSubscriptionId = ?, cancelAtPeriodEnd, 0),
       providerSubscriptionId = ?, pendingBillingAttemptId = NULL WHERE workspaceId = ?`,
      [attempt.planId, attempt.billingInterval, start, end, providerSubscriptionId, providerSubscriptionId, attempt.workspaceId],
    );
    await connection.execute("UPDATE WorkspaceBillingAttempts SET status = 'active', providerPaymentId = COALESCE(?, providerPaymentId) WHERE id = ?", [paymentId || null, attemptId]);
    await connection.execute("UPDATE WorkspaceBillingAttempts SET status = 'superseded' WHERE workspaceId = ? AND id <> ? AND status IN ('creating','created','authenticated')", [attempt.workspaceId, attemptId]);
    if (previousProviderSubscriptionId && previousProviderSubscriptionId !== providerSubscriptionId && !previousCancelAtPeriodEnd) {
      await connection.execute('INSERT IGNORE INTO WorkspaceBillingCancellationQueue (id, workspaceId, providerSubscriptionId) VALUES (?, ?, ?)', [randomUUID(), attempt.workspaceId, previousProviderSubscriptionId]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
  if (previousProviderSubscriptionId && previousProviderSubscriptionId !== providerSubscriptionId && !previousCancelAtPeriodEnd) void processBillingCancellationQueue();
  return attempt;
}

async function schedulePreviousSubscriptionEnd(workspaceId: string, replacementSubscriptionId: string) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[current]]: any = await connection.execute('SELECT providerSubscriptionId, cancelAtPeriodEnd FROM WorkspaceSubscriptions WHERE workspaceId = ? FOR UPDATE', [workspaceId]);
    if (current?.providerSubscriptionId && current.providerSubscriptionId !== replacementSubscriptionId && !current.cancelAtPeriodEnd) {
      await connection.execute('INSERT IGNORE INTO WorkspaceBillingCancellationQueue (id, workspaceId, providerSubscriptionId) VALUES (?, ?, ?)', [randomUUID(), workspaceId, current.providerSubscriptionId]);
      await connection.execute('UPDATE WorkspaceSubscriptions SET cancelAtPeriodEnd = 1 WHERE workspaceId = ?', [workspaceId]);
    }
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  void processBillingCancellationQueue();
}

app.get('/api/workspace/subscription', requireWorkspacePermission('subscription.read'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [subscriptionRows]: any = await pool.execute(
      `SELECT workspaceId, planId, status, billingInterval, currency, currentPeriodStart, currentPeriodEnd, trialEndsAt, cancelAtPeriodEnd
       FROM WorkspaceSubscriptions WHERE workspaceId = ? LIMIT 1`,
      [auth.workspaceId],
    );
    const subscription = subscriptionRows[0] || {
      workspaceId: auth.workspaceId,
      planId: 'pilot', status: 'not_configured', interval: 'monthly', currency: 'INR',
      currentPeriodStart: null, currentPeriodEnd: null, trialEndsAt: null, cancelAtPeriodEnd: false,
    };
    const [memberRows]: any = await pool.execute(
      `SELECT SUM(role = 'student') AS activeStudents, SUM(role IN ('trainer', 'panelist')) AS trainerSeats,
              (SELECT COUNT(*) FROM WorkspaceInvitations WHERE workspaceId = ? AND role = 'student' AND acceptedAt IS NULL AND expiresAt > UTC_TIMESTAMP()) AS pendingStudentInvitations,
              (SELECT COUNT(*) FROM WorkspaceInvitations WHERE workspaceId = ? AND role IN ('trainer', 'panelist') AND acceptedAt IS NULL AND expiresAt > UTC_TIMESTAMP()) AS pendingTrainerInvitations
       FROM WorkspaceMemberships WHERE workspaceId = ? AND status = 'active'`,
      [auth.workspaceId, auth.workspaceId, auth.workspaceId],
    );
    const [batchRows]: any = await pool.execute(
      'SELECT COUNT(*) AS activeBatches FROM Batches WHERE workspaceId = ? AND isArchived = 0',
      [auth.workspaceId],
    );
    const usagePeriodStart = subscription.currentPeriodStart
      ? new Date(subscription.currentPeriodStart).toISOString().slice(0, 10)
      : (() => { const date = new Date(); date.setDate(1); return date.toISOString().slice(0, 10); })();
    const [aiRows]: any = await pool.execute(
      'SELECT creditsUsed FROM WorkspaceAiUsage WHERE workspaceId = ? AND periodStart = ? LIMIT 1',
      [auth.workspaceId, usagePeriodStart],
    );
    const plan = await getPlanDefinitionFromDb(pool, subscription.planId || 'pilot');
    const result: WorkspaceSubscriptionOverview = {
      subscription: {
        id: auth.workspaceId,
        tenantId: auth.workspaceId,
        planId: plan.id,
        status: subscription.status,
      interval: subscription.billingInterval || 'monthly',
        currency: 'INR',
        currentPeriodStart: subscription.currentPeriodStart ? new Date(subscription.currentPeriodStart).toISOString() : null,
        currentPeriodEnd: subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toISOString() : null,
        trialEndsAt: subscription.trialEndsAt ? new Date(subscription.trialEndsAt).toISOString() : undefined,
        cancelAtPeriodEnd: Boolean(subscription.cancelAtPeriodEnd),
      },
      plan,
      usage: {
        activeStudents: Number(memberRows[0]?.activeStudents || 0),
        pendingStudentInvitations: Number(memberRows[0]?.pendingStudentInvitations || 0),
        trainerSeats: Number(memberRows[0]?.trainerSeats || 0),
        pendingTrainerInvitations: Number(memberRows[0]?.pendingTrainerInvitations || 0),
        activeBatches: Number(batchRows[0]?.activeBatches || 0),
        aiCreditsUsed: Number(aiRows[0]?.creditsUsed || 0),
        aiCreditsTracked: process.env.AI_EXTERNAL_PROCESSING_ENABLED === 'true' && Boolean(process.env.GEMINI_API_KEY),
        aiUsagePeriodStart: usagePeriodStart,
      },
    };
    res.json(result);
  } catch (error) {
    console.error('Workspace subscription overview failed:', error);
    res.status(500).json({ error: 'Could not load subscription and usage details.' });
  }
});

app.get('/api/workspace/billing/plans', requireWorkspacePermission('subscription.read'), async (_req, res) => {
  try {
    const [rows]: any = await pool.query('SELECT id, name, description, monthlyPricePaise, annualPricePaise FROM PlatformSubscriptionPlans WHERE isActive = 1 ORDER BY FIELD(id, \'pilot\', \'campus\', \'campus_plus\')');
    res.json(rows.map((row: any) => ({ id: row.id, name: row.name, description: row.description, monthlyPricePaise: row.monthlyPricePaise === null ? null : Number(row.monthlyPricePaise), annualPricePaise: row.annualPricePaise === null ? null : Number(row.annualPricePaise), currency: 'INR' })));
  } catch (error) { console.error('Billing plan catalog query failed:', error); res.status(503).json({ error: 'Apply the billing database migration to enable self-service plan selection.' }); }
});

app.get('/api/workspace/billing/invoices', requireWorkspacePermission('billing.manage'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [rows]: any = await pool.execute(
      `SELECT i.id, i.invoiceNumber, i.planId, COALESCE(p.name, i.planId) AS planName, i.amountPaise, i.currency, i.status,
       i.providerPaymentId, i.providerInvoiceId, i.invoiceUrl, i.paymentMethod,
       DATE_FORMAT(i.issuedAt, '%Y-%m-%d %H:%i:%s') AS issuedAt,
       DATE_FORMAT(i.periodStart, '%Y-%m-%d') AS periodStart, DATE_FORMAT(i.periodEnd, '%Y-%m-%d') AS periodEnd
       FROM WorkspaceBillingInvoices i LEFT JOIN PlatformSubscriptionPlans p ON p.id = i.planId
       WHERE i.workspaceId = ? ORDER BY i.issuedAt DESC LIMIT 100`, [auth.workspaceId],
    );
    res.json(rows.map((row: any) => ({ ...row, amountPaise: Number(row.amountPaise) })));
  } catch (error) { console.error('Workspace billing history query failed:', error); res.status(503).json({ error: 'Apply the billing database migration to enable billing history.' }); }
});

app.get('/api/workspace/billing/invoices/:id/view', requireWorkspacePermission('billing.manage'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [[invoice]]: any = await pool.execute('SELECT providerInvoiceId, invoiceUrl FROM WorkspaceBillingInvoices WHERE id = ? AND workspaceId = ? LIMIT 1', [req.params.id, auth.workspaceId]);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
    if (isRazorpayInvoiceUrl(invoice.invoiceUrl)) return res.redirect(302, invoice.invoiceUrl);
    if (!invoice.providerInvoiceId) return res.status(404).json({ error: 'The payment provider has not issued a hosted invoice for this payment.' });
    const providerInvoice: any = await razorpayRequest(`/invoices/${encodeURIComponent(invoice.providerInvoiceId)}`);
    const invoiceUrl = isRazorpayInvoiceUrl(providerInvoice.short_url) ? providerInvoice.short_url : null;
    if (!invoiceUrl) return res.status(404).json({ error: 'The payment provider invoice link is not available.' });
    await pool.execute('UPDATE WorkspaceBillingInvoices SET invoiceUrl = ? WHERE id = ? AND workspaceId = ?', [invoiceUrl, req.params.id, auth.workspaceId]);
    res.redirect(302, invoiceUrl);
  } catch (error) { console.error('Hosted billing invoice lookup failed:', error); res.status(502).json({ error: 'Could not open the payment provider invoice.' }); }
});

app.post('/api/workspace/billing/checkout', requireWorkspacePermission('subscription.manage'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const planId = req.body?.planId;
  const interval = req.body?.interval;
  if (!['pilot', 'campus', 'campus_plus'].includes(planId) || !['monthly', 'annual'].includes(interval)) return res.status(400).json({ error: 'Choose an available plan and monthly or annual billing.' });
  if (!getRazorpayCredentials()) return res.status(503).json({ error: 'Billing is not enabled. Configure Razorpay API credentials on the server.' });
  const attemptId = randomUUID();
  try {
    const [plans]: any = await pool.execute('SELECT id, name, monthlyPricePaise, annualPricePaise FROM PlatformSubscriptionPlans WHERE id = ? AND isActive = 1 LIMIT 1', [planId]);
    if (!plans.length) return res.status(400).json({ error: 'That plan is not available.' });
    const amountPaise = Number(interval === 'monthly' ? plans[0].monthlyPricePaise : plans[0].annualPricePaise);
    if (!Number.isSafeInteger(amountPaise) || amountPaise < 100) return res.status(409).json({ error: 'This plan does not have a valid price configured yet.' });
    const [[currentSubscription]]: any = await pool.execute('SELECT providerSubscriptionId, status, currentPeriodEnd FROM WorkspaceSubscriptions WHERE workspaceId = ? LIMIT 1', [auth.workspaceId]);
    const effectiveAt = currentSubscription?.providerSubscriptionId && ['active', 'past_due'].includes(currentSubscription.status)
      && currentSubscription.currentPeriodEnd && new Date(currentSubscription.currentPeriodEnd).getTime() > Date.now()
      ? new Date(currentSubscription.currentPeriodEnd) : null;
    await pool.execute(
      `INSERT INTO WorkspaceBillingAttempts (id, workspaceId, requestedByUserId, planId, billingInterval, amountPaise)
       VALUES (?, ?, ?, ?, ?, ?)`, [attemptId, auth.workspaceId, auth.userId, planId, interval, amountPaise],
    );
    let [catalog]: any = await pool.execute('SELECT providerPlanId, amountPaise FROM RazorpayPlanCatalog WHERE planId = ? AND billingInterval = ? LIMIT 1', [planId, interval]);
    if (!catalog.length || Number(catalog[0].amountPaise) !== amountPaise) {
      const providerPlan: any = await razorpayRequest('/plans', 'POST', {
        period: interval === 'annual' ? 'yearly' : 'monthly', interval: 1,
        item: { name: `${plans[0].name} (${interval})`, amount: amountPaise, currency: 'INR', description: `TalentEdge ${plans[0].name} subscription` },
        notes: { talentedgePlanId: planId, billingInterval: interval },
      });
      await pool.execute(
        `INSERT INTO RazorpayPlanCatalog (planId, billingInterval, amountPaise, providerPlanId) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE amountPaise = VALUES(amountPaise), providerPlanId = VALUES(providerPlanId)`,
        [planId, interval, amountPaise, providerPlan.id],
      );
      catalog = [{ providerPlanId: providerPlan.id }];
    }
    const providerSubscription: any = await razorpayRequest('/subscriptions', 'POST', {
      plan_id: catalog[0].providerPlanId, total_count: 100, quantity: 1, customer_notify: 1,
      ...(effectiveAt ? { start_at: Math.floor(effectiveAt.getTime() / 1000) } : {}),
      notes: { talentedgeWorkspaceId: auth.workspaceId, talentedgeBillingAttemptId: attemptId },
    });
    await pool.execute("UPDATE WorkspaceBillingAttempts SET status = 'created', providerPlanId = ?, providerSubscriptionId = ? WHERE id = ?", [catalog[0].providerPlanId, providerSubscription.id, attemptId]);
    await pool.execute('UPDATE WorkspaceSubscriptions SET pendingBillingAttemptId = ? WHERE workspaceId = ?', [attemptId, auth.workspaceId]);
    res.json({ attemptId, subscriptionId: providerSubscription.id, keyId: getRazorpayCredentials()!.keyId, name: 'TalentEdge', description: `${plans[0].name} · ${interval}`, amountPaise, currency: 'INR', planName: plans[0].name, interval, effectiveAt: effectiveAt?.toISOString() || null });
  } catch (error) {
    await pool.execute("UPDATE WorkspaceBillingAttempts SET status = 'failed' WHERE id = ?", [attemptId]).catch(() => undefined);
    await pool.execute('UPDATE WorkspaceSubscriptions SET pendingBillingAttemptId = NULL WHERE workspaceId = ? AND pendingBillingAttemptId = ?', [auth.workspaceId, attemptId]).catch(() => undefined);
    console.error('Razorpay subscription checkout creation failed:', error);
    res.status(502).json({ error: error instanceof Error ? error.message : 'Could not create a billing checkout.' });
  }
});

app.post('/api/workspace/billing/confirm', requireWorkspacePermission('subscription.manage'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { attemptId, subscriptionId, paymentId, signature } = req.body || {};
  if (![attemptId, subscriptionId, paymentId, signature].every((value) => typeof value === 'string' && value.length > 0)) return res.status(400).json({ error: 'The payment confirmation is incomplete.' });
  const credentials = getRazorpayCredentials();
  if (!credentials) return res.status(503).json({ error: 'Billing is not configured.' });
  try {
    const [attemptRows]: any = await pool.execute('SELECT * FROM WorkspaceBillingAttempts WHERE id = ? AND workspaceId = ? AND providerSubscriptionId = ? LIMIT 1', [attemptId, auth.workspaceId, subscriptionId]);
    const attempt = attemptRows[0];
    if (!attempt) return res.status(404).json({ error: 'Billing attempt not found.' });
    const expected = createHmac('sha256', credentials.keySecret).update(`${paymentId}|${subscriptionId}`).digest('hex');
    if (!safeHexEqual(expected, signature)) return res.status(400).json({ error: 'The payment signature could not be verified.' });
    const payment: any = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}`);
    if (payment.subscription_id !== subscriptionId || !['authorized', 'captured'].includes(payment.status)) return res.status(409).json({ error: 'Razorpay has not authorized this subscription payment.' });
    const providerSubscription: any = await razorpayRequest(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
    await pool.execute("UPDATE WorkspaceBillingAttempts SET status = 'authenticated', providerPaymentId = ? WHERE id = ? AND status <> 'active'", [paymentId, attemptId]);
    if (providerSubscription.start_at && Number(providerSubscription.start_at) * 1000 > Date.now()) await schedulePreviousSubscriptionEnd(auth.workspaceId, subscriptionId);
    if (providerSubscription.status === 'active') {
      const activated = await activateBillingAttempt(attemptId, subscriptionId, paymentId, providerSubscription);
      if (activated && payment.status === 'captured') await saveBillingPayment(activated, providerSubscription, payment, 'paid');
      return res.json({ success: true, status: 'active', message: 'Subscription activated.' });
    }
    return res.json({ success: true, status: providerSubscription.status || 'authenticated', message: 'Payment method authorized. Subscription activation will be confirmed by Razorpay.' });
  } catch (error) {
    console.error('Razorpay checkout confirmation failed:', error);
    res.status(502).json({ error: error instanceof Error ? error.message : 'Could not confirm the subscription.' });
  }
});

app.post('/api/workspace/billing/cancel', requireWorkspacePermission('subscription.manage'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [rows]: any = await pool.execute('SELECT providerSubscriptionId, status FROM WorkspaceSubscriptions WHERE workspaceId = ? LIMIT 1', [auth.workspaceId]);
    const providerSubscriptionId = rows[0]?.providerSubscriptionId;
    if (!providerSubscriptionId || !['active', 'past_due'].includes(rows[0]?.status)) return res.status(409).json({ error: 'There is no active provider subscription to cancel.' });
    await razorpayRequest(`/subscriptions/${encodeURIComponent(providerSubscriptionId)}/cancel`, 'POST', { cancel_at_cycle_end: 1 });
    await pool.execute('UPDATE WorkspaceSubscriptions SET cancelAtPeriodEnd = 1 WHERE workspaceId = ?', [auth.workspaceId]);
    res.json({ success: true, cancelAtPeriodEnd: true });
  } catch (error) { console.error('Razorpay cancellation request failed:', error); res.status(502).json({ error: error instanceof Error ? error.message : 'Could not schedule cancellation.' }); }
});

app.post('/api/billing/razorpay/webhook', async (req: any, res) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
  if (!webhookSecret || !Buffer.isBuffer(req.rawBody)) return res.status(503).json({ error: 'Billing webhook is not configured.' });
  const signature = String(req.get('x-razorpay-signature') || '');
  const expected = createHmac('sha256', webhookSecret).update(req.rawBody).digest('hex');
  if (!safeHexEqual(expected, signature)) return res.status(400).json({ error: 'Invalid webhook signature.' });
  const eventType = req.body?.event;
  const eventId = String(req.get('x-razorpay-event-id') || createHash('sha256').update(req.rawBody).digest('hex'));
  const event = req.body?.payload || {};
  const sub = event.subscription?.entity || {};
  const payment = event.payment?.entity || {};
  const attemptId = sub.notes?.talentedgeBillingAttemptId || null;
  const subscriptionId = sub.id || payment.subscription_id || null;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('INSERT IGNORE INTO WorkspaceBillingWebhookEvents (providerEventId, eventType) VALUES (?, ?)', [eventId, String(eventType || 'unknown')]);
    const [eventRows]: any = await connection.execute('SELECT processedAt, processingAt FROM WorkspaceBillingWebhookEvents WHERE providerEventId = ? FOR UPDATE', [eventId]);
    if (eventRows[0]?.processedAt || (eventRows[0]?.processingAt && Date.now() - new Date(eventRows[0].processingAt).getTime() < 5 * 60 * 1000)) { await connection.commit(); return res.json({ received: true, duplicate: true }); }
    await connection.execute('UPDATE WorkspaceBillingWebhookEvents SET processingAt = UTC_TIMESTAMP() WHERE providerEventId = ?', [eventId]);
    await connection.commit();
    let [attemptRows]: any = await pool.execute('SELECT * FROM WorkspaceBillingAttempts WHERE providerSubscriptionId = ? OR id = ? ORDER BY createdAt DESC LIMIT 1', [subscriptionId, attemptId || '']);
    let attempt = attemptRows[0];
    if (attempt && !attempt.providerSubscriptionId && subscriptionId) {
      await pool.execute("UPDATE WorkspaceBillingAttempts SET providerSubscriptionId = ?, status = 'created' WHERE id = ? AND providerSubscriptionId IS NULL", [subscriptionId, attempt.id]);
      attempt.providerSubscriptionId = subscriptionId;
    }
    if (attempt && eventType === 'subscription.authenticated') await schedulePreviousSubscriptionEnd(attempt.workspaceId, subscriptionId);
    if (attempt && ['subscription.activated', 'subscription.charged'].includes(eventType)) {
      attempt = await activateBillingAttempt(attempt.id, attempt.providerSubscriptionId || subscriptionId, payment.id, sub);
    } else if (attempt && ['subscription.pending', 'subscription.halted'].includes(eventType)) {
      await pool.execute("UPDATE WorkspaceSubscriptions SET status = 'past_due' WHERE workspaceId = ? AND providerSubscriptionId = ?", [attempt.workspaceId, subscriptionId]);
    } else if (attempt && eventType === 'subscription.resumed') {
      await pool.execute("UPDATE WorkspaceSubscriptions SET status = 'active', cancelAtPeriodEnd = 0 WHERE workspaceId = ? AND providerSubscriptionId = ?", [attempt.workspaceId, subscriptionId]);
    } else if (attempt && ['subscription.cancelled', 'subscription.canceled', 'subscription.completed'].includes(eventType)) {
      await pool.execute("UPDATE WorkspaceSubscriptions SET status = 'canceled', cancelAtPeriodEnd = 0 WHERE workspaceId = ? AND providerSubscriptionId = ?", [attempt.workspaceId, subscriptionId]);
    }
    if (attempt && payment.id && ['subscription.charged', 'payment.captured'].includes(eventType)) await saveBillingPayment(attempt, sub, payment, 'paid');
    if (attempt && payment.id && eventType === 'payment.failed') {
      await saveBillingPayment(attempt, sub, payment, 'failed');
      await pool.execute("UPDATE WorkspaceSubscriptions SET status = 'past_due' WHERE workspaceId = ? AND providerSubscriptionId = ?", [attempt.workspaceId, subscriptionId]);
    }
    await pool.execute('UPDATE WorkspaceBillingWebhookEvents SET processedAt = UTC_TIMESTAMP(), processingAt = NULL, processingError = NULL WHERE providerEventId = ?', [eventId]);
    res.json({ received: true });
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    console.error('Razorpay webhook processing failed:', error);
    await pool.execute('UPDATE WorkspaceBillingWebhookEvents SET processingAt = NULL, processingError = ? WHERE providerEventId = ?', [String(error).slice(0, 490), eventId]).catch(() => undefined);
    res.status(500).json({ error: 'Webhook processing failed; provider may retry.' });
  } finally { connection.release(); }
});

app.get('/api/workspace/settings', requireWorkspacePermission('workspace.configure'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [rows]: any = await pool.execute('SELECT settingsJson FROM WorkspaceSettings WHERE workspaceId = ? LIMIT 1', [auth.workspaceId]);
    const stored = rows[0] ? JSON.parse(rows[0].settingsJson) : {};
    res.json({ settings: { ...DEFAULT_WORKSPACE_SETTINGS, ...stored } satisfies WorkspaceSettings });
  } catch (error) {
    console.error('Workspace settings query failed:', error);
    res.status(500).json({ error: 'Could not load workspace settings.' });
  }
});

app.put('/api/workspace/settings', requireWorkspacePermission('workspace.configure'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { atRiskBelow, tierOneAtOrAbove, defaultInterviewDurationMinutes } = req.body || {};
  if (!Number.isInteger(atRiskBelow) || atRiskBelow < 0 || atRiskBelow > 99
    || !Number.isInteger(tierOneAtOrAbove) || tierOneAtOrAbove < 1 || tierOneAtOrAbove > 100
    || atRiskBelow >= tierOneAtOrAbove
    || !Number.isInteger(defaultInterviewDurationMinutes) || defaultInterviewDurationMinutes < 15 || defaultInterviewDurationMinutes > 180) {
    return res.status(400).json({ error: 'Use valid score thresholds (at-risk below tier 1) and an interview duration from 15 to 180 minutes.' });
  }
  const settings: WorkspaceSettings = { atRiskBelow, tierOneAtOrAbove, defaultInterviewDurationMinutes };
  try {
    await pool.execute(
      `INSERT INTO WorkspaceSettings (workspaceId, settingsJson, updatedByUserId) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE settingsJson = VALUES(settingsJson), updatedByUserId = VALUES(updatedByUserId)`,
      [auth.workspaceId, JSON.stringify(settings), auth.userId],
    );
    await pool.execute(
      'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, targetUserId, detailsJson) VALUES (?, ?, ?, ?, ?, ?)',
      [randomUUID(), auth.workspaceId, auth.userId, 'workspace.settings_updated', auth.userId, JSON.stringify(settings)],
    );
    res.json({ settings });
  } catch (error) {
    console.error('Workspace settings update failed:', error);
    res.status(500).json({ error: 'Could not save workspace settings.' });
  }
});

function parseScheduleDate(value: unknown) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 19).replace('T', ' ');
}

function isFutureScheduleDate(value: string) {
  return new Date(`${value.replace(' ', 'T')}Z`).getTime() > Date.now();
}

function validInterviewScheduleInput(body: any) {
  const scheduledAt = parseScheduleDate(body?.scheduledAt);
  const valid = typeof body?.studentId === 'string' && body.studentId.length > 0
    && ['tech', 'hr'].includes(body?.interviewType)
    && typeof body?.panelistId === 'string' && body.panelistId.length > 0
    && scheduledAt !== null
    && Number.isInteger(body?.durationMinutes) && body.durationMinutes >= 15 && body.durationMinutes <= 180
    && typeof (body?.location ?? '') === 'string' && (body.location ?? '').length <= 500
    && typeof (body?.notes ?? '') === 'string' && (body.notes ?? '').length <= 2000;
  return valid ? scheduledAt : null;
}

async function hasInterviewConflict(db: any, input: { workspaceId: string; studentId: string; panelistId: string; panelistName: string; scheduledAt: string; durationMinutes: number; excludeId?: string }) {
  const [rows]: any = await db.execute(
    `SELECT id, studentUserId, panelistId, panelist FROM WorkspaceInterviewSchedules
     WHERE workspaceId = ? AND status = 'scheduled' AND id <> ?
       AND scheduledAt < DATE_ADD(?, INTERVAL ? MINUTE)
       AND DATE_ADD(scheduledAt, INTERVAL durationMinutes MINUTE) > ?
       AND (studentUserId = ? OR panelistId = ? OR LOWER(TRIM(panelist)) = LOWER(TRIM(?)))
     LIMIT 1`,
    [input.workspaceId, input.excludeId || '', input.scheduledAt, input.durationMinutes, input.scheduledAt, input.studentId, input.panelistId, input.panelistName],
  );
  return rows[0] || null;
}

async function createInterviewScheduleNotification(db: any, workspaceId: string, studentId: string, scheduleId: string, action: 'scheduled' | 'updated' | 'cancelled', interviewType: 'tech' | 'hr', scheduledAt: string | Date, panelist: string) {
  const kind = interviewType === 'tech' ? 'Technical' : 'HR & behavioral';
  const normalizedDate = scheduledAt instanceof Date
    ? scheduledAt.toISOString().slice(0, 19).replace('T', ' ')
    : String(scheduledAt).replace('T', ' ');
  const timing = `${normalizedDate} UTC`;
  const title = action === 'cancelled' ? 'Mock interview cancelled' : action === 'updated' ? 'Mock interview updated' : 'Mock interview scheduled';
  const description = action === 'cancelled'
    ? `Your ${kind.toLowerCase()} mock interview for ${timing} was cancelled. Contact your college administrator if you need a new time.`
    : `Your ${kind.toLowerCase()} mock interview is ${action} for ${timing} with ${panelist}. Open Mock Interview Scores to view the details.`;
  await db.execute(
    `INSERT INTO WorkspaceUserNotifications
     (id, workspaceId, userId, notificationType, title, description, relatedEntityId)
     VALUES (?, ?, ?, 'interview_schedule', ?, ?, ?)`,
    [randomUUID(), workspaceId, studentId, title, description, scheduleId],
  );
}

async function createPanelistScheduleNotification(db: any, workspaceId: string, panelistUserId: string | null, scheduleId: string, action: 'scheduled' | 'updated' | 'cancelled' | 'removed', interviewType: 'tech' | 'hr', scheduledAt: string | Date) {
  if (!panelistUserId) return;
  const kind = interviewType === 'tech' ? 'technical' : 'HR & behavioral';
  const normalizedDate = scheduledAt instanceof Date
    ? scheduledAt.toISOString().slice(0, 19).replace('T', ' ')
    : String(scheduledAt).replace('T', ' ');
  const title = action === 'scheduled' ? 'New interview assigned'
    : action === 'cancelled' ? 'Interview assignment cancelled'
      : action === 'removed' ? 'Interview assignment changed' : 'Interview schedule updated';
  const description = action === 'cancelled'
    ? `Your ${kind} interview assignment for ${normalizedDate} UTC was cancelled.`
    : action === 'removed'
      ? 'You are no longer assigned to this interview. Check your interview schedule for current assignments.'
      : `A ${kind} interview is ${action === 'scheduled' ? 'assigned' : 'updated'} for ${normalizedDate} UTC. Open Assigned Interviews for the student, meeting details, and preparation notes.`;
  await db.execute(
    `INSERT INTO WorkspaceUserNotifications
     (id, workspaceId, userId, notificationType, title, description, relatedEntityId)
     VALUES (?, ?, ?, 'panelist_interview', ?, ?, ?)`,
    [randomUUID(), workspaceId, panelistUserId, title, description, scheduleId],
  );
}

app.get('/api/interview-panelists', requireWorkspacePermission('interview.schedule_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [rows]: any = await pool.execute(
      `SELECT p.id, p.name, COALESCE(p.email, '') AS email, wm.userId, p.designation, p.specialties, p.isActive
       FROM WorkspaceInterviewPanelists p
       LEFT JOIN WorkspaceMemberships wm ON wm.workspaceId = p.workspaceId AND wm.userId = p.userId AND wm.role = 'panelist' AND wm.status = 'active'
       WHERE p.workspaceId = ? ORDER BY p.isActive DESC, p.name ASC`,
      [auth.workspaceId],
    );
    res.json(rows.map((row: any) => ({ ...row, isActive: Boolean(row.isActive) })));
  } catch (error) {
    console.error('Interview panelist query failed:', error);
    res.status(500).json({ error: 'Could not load interview panelists.' });
  }
});

app.post('/api/interview-panelists', requireWorkspacePermission('interview.schedule_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { name, email = '', designation = '', specialties = '' } = req.body || {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.length > 191
    || (email && !validEmail(email)) || typeof designation !== 'string' || designation.length > 191
    || typeof specialties !== 'string' || specialties.length > 500) {
    return res.status(400).json({ error: 'Enter a panelist name and valid optional email, designation, and specialties.' });
  }
  try {
    const [linkedAccounts]: any = await pool.execute(
      `SELECT u.id FROM Users u JOIN WorkspaceMemberships wm ON wm.userId = u.id
       WHERE wm.workspaceId = ? AND wm.role = 'panelist' AND wm.status = 'active' AND LOWER(u.email) = LOWER(?) LIMIT 1`,
      [auth.workspaceId, email.trim()],
    );
    const id = randomUUID();
    await pool.execute(
      `INSERT INTO WorkspaceInterviewPanelists (id, workspaceId, name, email, userId, designation, specialties, createdByUserId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, auth.workspaceId, name.trim(), email.trim().toLowerCase() || null, linkedAccounts[0]?.id || null, designation.trim(), specialties.trim(), auth.userId],
    );
    await pool.execute(
      'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, detailsJson) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), auth.workspaceId, auth.userId, 'interview_panelist.created', JSON.stringify({ panelistId: id, name: name.trim() })],
    );
    res.status(201).json({ success: true, id });
  } catch (error: any) {
    if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A panelist with this name already exists in the workspace.' });
    console.error('Interview panelist creation failed:', error);
    res.status(500).json({ error: 'Could not add this interview panelist.' });
  }
});

app.patch('/api/interview-panelists/:id', requireWorkspacePermission('interview.schedule_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { id } = req.params;
  const { name, email, designation, specialties, isActive } = req.body || {};
  if (name !== undefined && (typeof name !== 'string' || name.trim().length < 2 || name.length > 191)
    || email !== undefined && email !== '' && !validEmail(email)
    || designation !== undefined && (typeof designation !== 'string' || designation.length > 191)
    || specialties !== undefined && (typeof specialties !== 'string' || specialties.length > 500)
    || isActive !== undefined && typeof isActive !== 'boolean') {
    return res.status(400).json({ error: 'Panelist details are invalid.' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows]: any = await connection.execute('SELECT * FROM WorkspaceInterviewPanelists WHERE id = ? AND workspaceId = ? FOR UPDATE', [id, auth.workspaceId]);
    const panelist = rows[0];
    if (!panelist) { await connection.rollback(); return res.status(404).json({ error: 'Panelist not found in this workspace.' }); }
    if (isActive === false && panelist.isActive) {
      const [schedules]: any = await connection.execute(
        `SELECT COUNT(*) AS activeCount FROM WorkspaceInterviewSchedules
         WHERE workspaceId = ? AND panelistId = ? AND status = 'scheduled' AND scheduledAt >= UTC_TIMESTAMP()`,
        [auth.workspaceId, id],
      );
      if (Number(schedules[0]?.activeCount || 0) > 0) {
        await connection.rollback();
        return res.status(409).json({ error: 'This panelist has future scheduled interviews. Reschedule or cancel them before deactivating the panelist.' });
      }
    }
    const nextName = name === undefined ? panelist.name : name.trim();
    const nextEmail = email === undefined ? panelist.email : email.trim().toLowerCase() || null;
    const [linkedAccounts]: any = nextEmail ? await connection.execute(
      `SELECT u.id FROM Users u JOIN WorkspaceMemberships wm ON wm.userId = u.id
       WHERE wm.workspaceId = ? AND wm.role = 'panelist' AND wm.status = 'active' AND LOWER(u.email) = LOWER(?) LIMIT 1`,
      [auth.workspaceId, nextEmail],
    ) : [[]];
    const nextUserId = linkedAccounts[0]?.id || (email === undefined ? panelist.userId : null);
    await connection.execute(
      `UPDATE WorkspaceInterviewPanelists SET name = ?, email = ?, userId = ?, designation = ?, specialties = ?, isActive = ?
       WHERE id = ? AND workspaceId = ?`,
      [nextName, nextEmail, nextUserId, designation === undefined ? panelist.designation : designation.trim(), specialties === undefined ? panelist.specialties : specialties.trim(), isActive === undefined ? panelist.isActive : Number(isActive), id, auth.workspaceId],
    );
    if (name !== undefined) await connection.execute('UPDATE WorkspaceInterviewSchedules SET panelist = ? WHERE workspaceId = ? AND panelistId = ?', [nextName, auth.workspaceId, id]);
    await connection.execute(
      'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, detailsJson) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), auth.workspaceId, auth.userId, isActive === undefined ? 'interview_panelist.updated' : isActive ? 'interview_panelist.activated' : 'interview_panelist.deactivated', JSON.stringify({ panelistId: id, name: nextName })],
    );
    await connection.commit();
    res.json({ success: true });
  } catch (error: any) {
    await connection.rollback();
    if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A panelist with this name already exists in the workspace.' });
    console.error('Interview panelist update failed:', error);
    res.status(500).json({ error: 'Could not update this interview panelist.' });
  } finally {
    connection.release();
  }
});

app.get('/api/interview-schedules', requireWorkspacePermission('interview.read_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [rows]: any = await pool.execute(
      `SELECT s.id, s.studentUserId AS studentId, u.name AS studentName, COALESCE(sp.rollNo, '') AS rollNo,
              COALESCE(b.name, '') AS batchName, s.interviewType, DATE_FORMAT(s.scheduledAt, '%Y-%m-%d %H:%i:%s') AS scheduledAt,
              s.durationMinutes, s.panelist, s.panelistId, s.location, COALESCE(s.notes, '') AS notes, s.status,
              ir.score AS evaluationScore, ir.recommendation AS evaluationRecommendation, ir.date AS evaluationDate,
              fu.outcome AS followUpOutcome, COALESCE(fu.notes, '') AS followUpNotes,
              COALESCE(fu.studentNotes, '') AS followUpStudentNotes,
              (ir.id IS NOT NULL) AS hasEvaluation
       FROM WorkspaceInterviewSchedules s
       JOIN Users u ON u.id = s.studentUserId
       LEFT JOIN WorkspaceStudentProfiles sp ON sp.workspaceId = s.workspaceId AND sp.userId = s.studentUserId
       LEFT JOIN Batches b ON b.id = sp.batchId AND b.workspaceId = s.workspaceId
       LEFT JOIN InterviewRecords ir ON ir.workspaceId = s.workspaceId AND ir.scheduleId = s.id
       LEFT JOIN WorkspaceInterviewFollowUps fu ON fu.workspaceId = s.workspaceId AND fu.scheduleId = s.id
       WHERE s.workspaceId = ?
       ORDER BY FIELD(s.status, 'scheduled', 'completed', 'cancelled'), s.scheduledAt ASC, u.name ASC`,
      [auth.workspaceId],
    );
    res.json(rows.map((row: any) => ({ ...row, hasEvaluation: Boolean(row.hasEvaluation) })));
  } catch (error) {
    console.error('Interview schedule query failed:', error);
    res.status(500).json({ error: 'Could not load interview schedules.' });
  }
});

app.put('/api/interview-schedules/:id/follow-up', requireWorkspacePermission('interview.schedule_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const outcome = String(req.body?.outcome || '');
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';
  const studentNotes = typeof req.body?.studentNotes === 'string' ? req.body.studentNotes.trim() : '';
  const allowedOutcomes = ['needs_another_interview', 'referred_for_placement', 'offer_confirmed', 'no_further_action'];
  if (!allowedOutcomes.includes(outcome) || notes.length > 4000 || studentNotes.length > 2000) {
    return res.status(400).json({ error: 'Choose a valid follow-up outcome, keep admin notes under 4,000 characters, and student notes under 2,000 characters.' });
  }
  try {
    const [rows]: any = await pool.execute(
      `SELECT s.id FROM WorkspaceInterviewSchedules s
       JOIN InterviewRecords ir ON ir.workspaceId = s.workspaceId AND ir.scheduleId = s.id
       WHERE s.id = ? AND s.workspaceId = ? AND s.status = 'completed' LIMIT 1`,
      [req.params.id, auth.workspaceId],
    );
    if (!rows.length) return res.status(409).json({ error: 'Follow-up can be recorded after a panelist submits an evaluation.' });
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [existingRows]: any = await connection.execute(
        'SELECT outcome, COALESCE(notes, \'\') AS notes, COALESCE(studentNotes, \'\') AS studentNotes FROM WorkspaceInterviewFollowUps WHERE workspaceId = ? AND scheduleId = ? LIMIT 1 FOR UPDATE',
        [auth.workspaceId, req.params.id],
      );
      const previous = existingRows[0];
      if (previous && previous.outcome === outcome && previous.studentNotes === studentNotes && (previous.notes || '') === notes) {
        await connection.rollback();
        return res.json({ success: true, changed: false, outcome, notes, studentNotes });
      }
      await connection.execute(
      `INSERT INTO WorkspaceInterviewFollowUps (id, workspaceId, scheduleId, outcome, notes, studentNotes, updatedByUserId)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE outcome = VALUES(outcome), notes = VALUES(notes), studentNotes = VALUES(studentNotes), updatedByUserId = VALUES(updatedByUserId), updatedAt = CURRENT_TIMESTAMP`,
      [randomUUID(), auth.workspaceId, req.params.id, outcome, notes || null, studentNotes || null, auth.userId],
      );
      await connection.execute(
        `INSERT INTO WorkspaceInterviewFollowUpHistory (id, workspaceId, scheduleId, outcome, notes, studentNotes, updatedByUserId)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), auth.workspaceId, req.params.id, outcome, notes || null, studentNotes || null, auth.userId],
      );
      const outcomeLabels: Record<string, string> = {
        needs_another_interview: 'Another interview is recommended',
        referred_for_placement: 'You have been referred for placement',
        offer_confirmed: 'Your placement offer has been confirmed',
        no_further_action: 'Your placement follow-up status was updated',
      };
      const description = `${outcomeLabels[outcome]}${studentNotes ? ` — ${studentNotes}` : '.'}`;
      await connection.execute(
        `INSERT INTO WorkspaceUserNotifications (id, workspaceId, userId, notificationType, title, description, relatedEntityId)
         SELECT ?, ?, s.studentUserId, 'placement_outcome', 'Placement progress updated', ?, s.id
         FROM WorkspaceInterviewSchedules s WHERE s.id = ? AND s.workspaceId = ?`,
        [randomUUID(), auth.workspaceId, description, req.params.id, auth.workspaceId],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    res.json({ success: true, changed: true, outcome, notes, studentNotes });
  } catch (error) {
    console.error('Interview follow-up update failed:', error);
    res.status(500).json({ error: 'Could not save interview follow-up.' });
  }
});

app.get('/api/interview-follow-ups/mine', requireWorkspacePermission('interview.read_own'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [rows]: any = await pool.execute(
      `SELECT f.id, f.outcome, COALESCE(f.studentNotes, '') AS studentNotes,
              DATE_FORMAT(f.updatedAt, '%Y-%m-%d %H:%i:%s') AS updatedAt,
              s.interviewType, DATE_FORMAT(s.scheduledAt, '%Y-%m-%d %H:%i:%s') AS interviewDate
       FROM WorkspaceInterviewFollowUps f
       JOIN WorkspaceInterviewSchedules s ON s.id = f.scheduleId AND s.workspaceId = f.workspaceId
       JOIN InterviewRecords ir ON ir.scheduleId = s.id AND ir.workspaceId = s.workspaceId
       WHERE f.workspaceId = ? AND s.studentUserId = ?
       ORDER BY f.updatedAt DESC, s.scheduledAt DESC`,
      [auth.workspaceId, auth.userId],
    );
    res.json(rows);
  } catch (error) {
    console.error('Student interview follow-up query failed:', error);
    res.status(500).json({ error: 'Could not load your placement updates.' });
  }
});

app.get('/api/interview-follow-ups/:scheduleId/history', requireWorkspacePermission('interview.read_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [rows]: any = await pool.execute(
      `SELECT h.id, h.outcome, COALESCE(h.notes, '') AS notes, COALESCE(h.studentNotes, '') AS studentNotes,
              DATE_FORMAT(h.createdAt, '%Y-%m-%d %H:%i:%s') AS createdAt, u.name AS updatedBy
       FROM WorkspaceInterviewFollowUpHistory h
       JOIN Users u ON u.id = h.updatedByUserId
       WHERE h.workspaceId = ? AND h.scheduleId = ?
       ORDER BY h.createdAt DESC, h.id DESC`,
      [auth.workspaceId, req.params.scheduleId],
    );
    res.json(rows);
  } catch (error) {
    console.error('Interview follow-up history query failed:', error);
    res.status(500).json({ error: 'Could not load interview follow-up history.' });
  }
});

app.get('/api/interview-schedules/mine', requireWorkspacePermission('interview.read_own'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [rows]: any = await pool.execute(
      `SELECT id, studentUserId AS studentId, interviewType, DATE_FORMAT(scheduledAt, '%Y-%m-%d %H:%i:%s') AS scheduledAt,
              durationMinutes, panelist, panelistId, location, COALESCE(notes, '') AS notes, status
       FROM WorkspaceInterviewSchedules
       WHERE workspaceId = ? AND studentUserId = ? AND status = 'scheduled' AND scheduledAt >= UTC_TIMESTAMP()
       ORDER BY scheduledAt ASC`,
      [auth.workspaceId, auth.userId],
    );
    res.json(rows);
  } catch (error) {
    console.error('Student interview schedule query failed:', error);
    res.status(500).json({ error: 'Could not load your upcoming interviews.' });
  }
});

app.get('/api/interview-schedules/assigned', requireWorkspacePermission('interview.panelist.read_assigned'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [rows]: any = await pool.execute(
      `SELECT s.id, s.studentUserId AS studentId, u.name AS studentName, COALESCE(sp.rollNo, '') AS rollNo,
              s.interviewType, DATE_FORMAT(s.scheduledAt, '%Y-%m-%d %H:%i:%s') AS scheduledAt,
              s.durationMinutes, s.panelist, s.location, COALESCE(s.notes, '') AS notes, s.status,
              EXISTS(SELECT 1 FROM InterviewRecords ir WHERE ir.workspaceId = s.workspaceId AND ir.scheduleId = s.id) AS hasEvaluation
       FROM WorkspaceInterviewSchedules s
       JOIN WorkspaceInterviewPanelists p ON p.id = s.panelistId AND p.workspaceId = s.workspaceId AND p.userId = ?
       JOIN Users u ON u.id = s.studentUserId
       LEFT JOIN WorkspaceStudentProfiles sp ON sp.workspaceId = s.workspaceId AND sp.userId = s.studentUserId
       WHERE s.workspaceId = ?
       ORDER BY (s.status = 'scheduled') DESC, s.scheduledAt ASC, u.name ASC`,
      [auth.userId, auth.workspaceId],
    );
    res.json(rows.map((row: any) => ({ ...row, hasEvaluation: Boolean(row.hasEvaluation) })));
  } catch (error) {
    console.error('Assigned panelist interview query failed:', error);
    res.status(500).json({ error: 'Could not load your assigned interviews.' });
  }
});

app.get('/api/interview-schedules/:id/evaluation', requireWorkspacePermission('interview.read_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [rows]: any = await pool.execute(
      `SELECT ir.id, ir.studentId, u.name AS studentName, COALESCE(sp.rollNo, '') AS rollNo,
              s.interviewType, s.panelist, DATE_FORMAT(s.scheduledAt, '%Y-%m-%d %H:%i:%s') AS scheduledAt,
              ir.date AS evaluationDate, ir.ratingsJson, ir.remarks, ir.recommendation, ir.score
       FROM WorkspaceInterviewSchedules s
       JOIN InterviewRecords ir ON ir.workspaceId = s.workspaceId AND ir.scheduleId = s.id
       JOIN Users u ON u.id = s.studentUserId
       LEFT JOIN WorkspaceStudentProfiles sp ON sp.workspaceId = s.workspaceId AND sp.userId = s.studentUserId
       WHERE s.id = ? AND s.workspaceId = ? LIMIT 1`,
      [req.params.id, auth.workspaceId],
    );
    if (!rows.length) return res.status(404).json({ error: 'No saved evaluation exists for this interview.' });
    const evaluation = rows[0];
    let ratings: Record<string, number> = {};
    try { ratings = JSON.parse(evaluation.ratingsJson || '{}'); } catch { ratings = {}; }
    delete evaluation.ratingsJson;
    res.json({ ...evaluation, ratings });
  } catch (error) {
    console.error('Interview evaluation detail query failed:', error);
    res.status(500).json({ error: 'Could not load the saved interview evaluation.' });
  }
});

app.post('/api/interview-schedules/:id/evaluation', requireWorkspacePermission('interview.panelist.evaluate_assigned'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { ratings, remarks, recommendation } = req.body || {};
  if (!ratings || typeof ratings !== 'object' || Array.isArray(ratings)
    || Object.keys(ratings).length < 1 || Object.keys(ratings).length > 20
    || Object.values(ratings).some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10)
    || typeof remarks !== 'string' || remarks.trim().length < 3 || remarks.length > 5000
    || !['hire', 'borderline', 'remedial'].includes(recommendation)) {
    return res.status(400).json({ error: 'Provide valid rubric scores, feedback, and a recommendation.' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [scheduleRows]: any = await connection.execute(
      `SELECT s.id, s.workspaceId, s.studentUserId, s.interviewType, s.scheduledAt, s.status,
              (s.scheduledAt <= UTC_TIMESTAMP()) AS interviewStarted,
              p.name AS panelistName, p.userId AS panelistUserId
       FROM WorkspaceInterviewSchedules s
       JOIN WorkspaceInterviewPanelists p ON p.id = s.panelistId AND p.workspaceId = s.workspaceId
       WHERE s.id = ? AND s.workspaceId = ? AND p.userId = ? LIMIT 1 FOR UPDATE`,
      [req.params.id, auth.workspaceId, auth.userId],
    );
    const schedule = scheduleRows[0];
    if (!schedule) { await connection.rollback(); return res.status(404).json({ error: 'This interview is not assigned to your panelist account.' }); }
    if (schedule.status !== 'scheduled') { await connection.rollback(); return res.status(409).json({ error: 'Canceled interviews cannot be evaluated.' }); }
    if (!Boolean(schedule.interviewStarted)) { await connection.rollback(); return res.status(409).json({ error: 'Evaluation can be submitted after the scheduled interview time.' }); }
    const [existing]: any = await connection.execute('SELECT id FROM InterviewRecords WHERE workspaceId = ? AND scheduleId = ? LIMIT 1', [auth.workspaceId, schedule.id]);
    if (existing.length) { await connection.rollback(); return res.status(409).json({ error: 'An evaluation has already been submitted for this interview.' }); }
    const score = Math.round(Object.values(ratings as Record<string, number>).reduce((sum, value) => sum + value, 0) / Object.keys(ratings).length * 10);
    const normalizedRecommendation = recommendation === 'hire' ? 'Hire' : recommendation === 'remedial' ? 'Need Improvement' : 'Borderline';
    const [profiles]: any = await connection.execute(
      `SELECT recentRemarksJson, coding, aptitude, reasoning, sqlScore, csFundamentals, communication, techInterview, hrInterview
       FROM WorkspaceStudentProfiles WHERE workspaceId = ? AND userId = ? FOR UPDATE`,
      [auth.workspaceId, schedule.studentUserId],
    );
    if (!profiles.length) { await connection.rollback(); return res.status(404).json({ error: 'Student profile is not available for this interview.' }); }
    const profile = profiles[0];
    const techInterview = schedule.interviewType === 'tech' ? score : Number(profile.techInterview);
    const hrInterview = schedule.interviewType === 'hr' ? score : Number(profile.hrInterview);
    const overallReadiness = explainReadiness({ coding: profile.coding, aptitude: profile.aptitude, reasoning: profile.reasoning,
      sql: profile.sqlScore, csFundamentals: profile.csFundamentals, communication: profile.communication,
      techInterview, hrInterview }).score;
    const remark = { id: `interview-${schedule.id}`, trainerName: auth.name, date: new Date().toISOString().slice(0, 10), comment: remarks.trim(), type: schedule.interviewType, score };
    let recentRemarks: any[] = [];
    try { recentRemarks = JSON.parse(profile.recentRemarksJson || '[]'); if (!Array.isArray(recentRemarks)) recentRemarks = []; } catch { recentRemarks = []; }
    recentRemarks.unshift(remark);
    const scoreColumn = schedule.interviewType === 'tech' ? 'techInterview' : 'hrInterview';
    await connection.execute(
      `UPDATE WorkspaceStudentProfiles SET recentRemarksJson = ?, ${scoreColumn} = ?, overallReadiness = ?, placementReadinessScore = ?
       WHERE workspaceId = ? AND userId = ?`,
      [JSON.stringify(recentRemarks), score, overallReadiness, overallReadiness, auth.workspaceId, schedule.studentUserId],
    );
    await connection.execute(
      `INSERT INTO InterviewRecords (id, workspaceId, scheduleId, studentId, type, date, panel, status, ratingsJson, remarks, recommendation, score, createdByUserId)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Completed', ?, ?, ?, ?, ?)`,
      [randomUUID(), auth.workspaceId, schedule.id, schedule.studentUserId, schedule.interviewType, new Date().toISOString().slice(0, 10), schedule.panelistName,
        JSON.stringify(ratings), remarks.trim(), normalizedRecommendation, score, auth.userId],
    );
    await connection.execute("UPDATE WorkspaceInterviewSchedules SET status = 'completed' WHERE id = ? AND workspaceId = ? AND status = 'scheduled'", [schedule.id, auth.workspaceId]);
    await connection.execute(
      `INSERT INTO WorkspaceUserNotifications (id, workspaceId, userId, notificationType, title, description, relatedEntityId)
       VALUES (?, ?, ?, 'interview_evaluation', 'Mock interview evaluation available', ?, ?)`,
      [randomUUID(), auth.workspaceId, schedule.studentUserId, `Your ${schedule.interviewType === 'tech' ? 'technical' : 'HR & behavioral'} interview evaluation is available. Score: ${score}%. Open Mock Interview Scores to review your feedback.`, schedule.id],
    );
    await connection.execute(
      'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, targetUserId, detailsJson) VALUES (?, ?, ?, ?, ?, ?)',
      [randomUUID(), auth.workspaceId, auth.userId, 'interview.evaluation_saved', schedule.studentUserId, JSON.stringify({ scheduleId: schedule.id, type: schedule.interviewType, score })],
    );
    await connection.commit();
    res.status(201).json({ success: true, score });
  } catch (error: any) {
    await connection.rollback();
    if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'An evaluation has already been submitted for this interview.' });
    console.error('Panelist evaluation save failed:', error);
    res.status(500).json({ error: 'Could not save this interview evaluation.' });
  } finally { connection.release(); }
});

app.post('/api/interview-schedules', requireWorkspacePermission('interview.schedule_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const scheduledAt = validInterviewScheduleInput(req.body);
  if (!scheduledAt || !isFutureScheduleDate(scheduledAt)) return res.status(400).json({ error: 'Choose a valid future interview time, student, panelist, and duration.' });
  const { studentId, interviewType, durationMinutes, panelistId, location = '', notes = '' } = req.body;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [members]: any = await connection.execute("SELECT userId FROM WorkspaceMemberships WHERE workspaceId = ? AND userId = ? AND role = 'student' AND status = 'active' LIMIT 1 FOR UPDATE", [auth.workspaceId, studentId]);
    if (!members.length) { await connection.rollback(); return res.status(404).json({ error: 'Choose an active student in this workspace.' }); }
    const [panelists]: any = await connection.execute(
      `SELECT p.id, p.name, p.userId FROM WorkspaceInterviewPanelists p
       JOIN WorkspaceMemberships wm ON wm.workspaceId = p.workspaceId AND wm.userId = p.userId AND wm.role = 'panelist' AND wm.status = 'active'
       WHERE p.id = ? AND p.workspaceId = ? AND p.isActive = 1 LIMIT 1 FOR UPDATE`,
      [panelistId, auth.workspaceId],
    );
    if (!panelists.length) { await connection.rollback(); return res.status(404).json({ error: 'Choose an active panelist with a linked workspace account.' }); }
    const panelistName = panelists[0].name;
    if (await hasInterviewConflict(connection, { workspaceId: auth.workspaceId, studentId, panelistId, panelistName, scheduledAt, durationMinutes })) {
      await connection.rollback(); return res.status(409).json({ error: 'The student or panelist already has an overlapping interview. Choose another time or panelist.' });
    }
    const id = randomUUID();
    await connection.execute(`INSERT INTO WorkspaceInterviewSchedules
      (id, workspaceId, studentUserId, interviewType, scheduledAt, durationMinutes, panelist, panelistId, location, notes, createdByUserId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, auth.workspaceId, studentId, interviewType, scheduledAt, durationMinutes, panelistName, panelistId, location.trim(), notes.trim(), auth.userId]);
    await createInterviewScheduleNotification(connection, auth.workspaceId, studentId, id, 'scheduled', interviewType, scheduledAt, panelistName);
    await createPanelistScheduleNotification(connection, auth.workspaceId, panelists[0].userId, id, 'scheduled', interviewType, scheduledAt);
    await connection.execute('INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, targetUserId, detailsJson) VALUES (?, ?, ?, ?, ?, ?)',
      [randomUUID(), auth.workspaceId, auth.userId, 'interview.scheduled', studentId, JSON.stringify({ scheduleId: id, interviewType, scheduledAt, panelist: panelistName })]);
    await connection.commit();
    res.status(201).json({ success: true, id });
  } catch (error) {
    await connection.rollback();
    console.error('Interview schedule creation failed:', error);
    res.status(500).json({ error: 'Could not create the interview schedule.' });
  } finally { connection.release(); }
});

app.patch('/api/interview-schedules/:id', requireWorkspacePermission('interview.schedule_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { status } = req.body || {};
  if (status === 'cancelled') {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [scheduleRows]: any = await connection.execute(
        'SELECT * FROM WorkspaceInterviewSchedules WHERE id = ? AND workspaceId = ? LIMIT 1 FOR UPDATE',
        [req.params.id, auth.workspaceId],
      );
      const existing = scheduleRows[0];
      if (!existing) { await connection.rollback(); return res.status(404).json({ error: 'Interview schedule not found.' }); }
      if (existing.status === 'cancelled') { await connection.commit(); return res.json({ success: true }); }
      if (existing.status === 'completed') { await connection.rollback(); return res.status(409).json({ error: 'Completed interviews with saved evaluations cannot be cancelled.' }); }
      const [panelistRows]: any = await connection.execute('SELECT userId FROM WorkspaceInterviewPanelists WHERE id = ? AND workspaceId = ? LIMIT 1', [existing.panelistId, auth.workspaceId]);
      await connection.execute(
        "UPDATE WorkspaceInterviewSchedules SET status = 'cancelled' WHERE id = ? AND workspaceId = ?",
        [req.params.id, auth.workspaceId],
      );
      await createInterviewScheduleNotification(connection, auth.workspaceId, existing.studentUserId, existing.id, 'cancelled', existing.interviewType, existing.scheduledAt, existing.panelist);
      await createPanelistScheduleNotification(connection, auth.workspaceId, panelistRows[0]?.userId || null, existing.id, 'cancelled', existing.interviewType, existing.scheduledAt);
      await connection.execute(
        'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, targetUserId, detailsJson) VALUES (?, ?, ?, ?, ?, ?)',
        [randomUUID(), auth.workspaceId, auth.userId, 'interview.cancelled', existing.studentUserId, JSON.stringify({ scheduleId: existing.id })],
      );
      await connection.commit();
      return res.json({ success: true });
    } catch (error) {
      await connection.rollback();
      console.error('Interview schedule cancellation failed:', error);
      return res.status(500).json({ error: 'Could not cancel this interview.' });
    } finally { connection.release(); }
  }
  const scheduledAt = validInterviewScheduleInput(req.body);
  if (!scheduledAt || !['scheduled', 'cancelled'].includes(status)
    || (status === 'scheduled' && !isFutureScheduleDate(scheduledAt))) {
    return res.status(400).json({ error: 'Schedule details are invalid. Active schedules must be set in the future.' });
  }
  const { studentId, interviewType, durationMinutes, panelistId, location = '', notes = '' } = req.body;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [scheduleRows]: any = await connection.execute('SELECT * FROM WorkspaceInterviewSchedules WHERE id = ? AND workspaceId = ? LIMIT 1 FOR UPDATE', [req.params.id, auth.workspaceId]);
    const existing = scheduleRows[0];
    if (!existing) { await connection.rollback(); return res.status(404).json({ error: 'Interview schedule not found.' }); }
    if (existing.status === 'completed') { await connection.rollback(); return res.status(409).json({ error: 'Completed interviews cannot be changed after an evaluation is saved.' }); }
    const [oldPanelistRows]: any = existing.panelistId
      ? await connection.execute('SELECT userId FROM WorkspaceInterviewPanelists WHERE id = ? AND workspaceId = ? LIMIT 1', [existing.panelistId, auth.workspaceId])
      : [[]];
    const oldPanelistUserId = oldPanelistRows[0]?.userId || null;
    const [members]: any = await connection.execute("SELECT userId FROM WorkspaceMemberships WHERE workspaceId = ? AND userId = ? AND role = 'student' AND status = 'active' LIMIT 1 FOR UPDATE", [auth.workspaceId, studentId]);
    if (!members.length) { await connection.rollback(); return res.status(404).json({ error: 'Choose an active student in this workspace.' }); }
    const [panelists]: any = await connection.execute(
      `SELECT p.id, p.name, p.userId FROM WorkspaceInterviewPanelists p
       JOIN WorkspaceMemberships wm ON wm.workspaceId = p.workspaceId AND wm.userId = p.userId AND wm.role = 'panelist' AND wm.status = 'active'
       WHERE p.id = ? AND p.workspaceId = ? AND p.isActive = 1 LIMIT 1 FOR UPDATE`,
      [panelistId, auth.workspaceId],
    );
    if (!panelists.length) { await connection.rollback(); return res.status(404).json({ error: 'Choose an active panelist with a linked workspace account.' }); }
    const panelistName = panelists[0].name;
    if (await hasInterviewConflict(connection, { workspaceId: auth.workspaceId, studentId, panelistId, panelistName, scheduledAt, durationMinutes, excludeId: req.params.id })) {
      await connection.rollback(); return res.status(409).json({ error: 'The student or panelist already has an overlapping interview. Choose another time or panelist.' });
    }
    await connection.execute(`UPDATE WorkspaceInterviewSchedules SET studentUserId = ?, interviewType = ?, scheduledAt = ?, durationMinutes = ?,
      panelist = ?, panelistId = ?, location = ?, notes = ?, status = 'scheduled' WHERE id = ? AND workspaceId = ?`,
    [studentId, interviewType, scheduledAt, durationMinutes, panelistName, panelistId, location.trim(), notes.trim(), req.params.id, auth.workspaceId]);
    await createInterviewScheduleNotification(connection, auth.workspaceId, studentId, req.params.id, 'updated', interviewType, scheduledAt, panelistName);
    if (existing.studentUserId !== studentId) await createInterviewScheduleNotification(connection, auth.workspaceId, existing.studentUserId, req.params.id, 'cancelled', existing.interviewType, existing.scheduledAt, existing.panelist);
    if (oldPanelistUserId && oldPanelistUserId !== panelists[0].userId) await createPanelistScheduleNotification(connection, auth.workspaceId, oldPanelistUserId, req.params.id, 'removed', existing.interviewType, existing.scheduledAt);
    await createPanelistScheduleNotification(connection, auth.workspaceId, panelists[0].userId, req.params.id, oldPanelistUserId === panelists[0].userId ? 'updated' : 'scheduled', interviewType, scheduledAt);
    await connection.execute('INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, targetUserId, detailsJson) VALUES (?, ?, ?, ?, ?, ?)',
      [randomUUID(), auth.workspaceId, auth.userId, 'interview.rescheduled', studentId, JSON.stringify({ scheduleId: req.params.id, interviewType, scheduledAt, panelist: panelistName })]);
    await connection.commit();
    res.json({ success: true });
  } catch (error) {
    await connection.rollback();
    console.error('Interview schedule update failed:', error);
    res.status(500).json({ error: 'Could not update the interview schedule.' });
  } finally { connection.release(); }
});
app.get('/api/workspace/members', requireWorkspacePermission('members.read'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [rows]: any = await pool.execute(
      `SELECT u.id, u.name, u.email, wm.role, wm.status, wm.createdAt, sp.batchId, b.name AS batchName
       FROM WorkspaceMemberships wm JOIN Users u ON u.id = wm.userId
       LEFT JOIN WorkspaceStudentProfiles sp ON sp.workspaceId = wm.workspaceId AND sp.userId = wm.userId
       LEFT JOIN Batches b ON b.id = sp.batchId AND b.workspaceId = wm.workspaceId
       WHERE wm.workspaceId = ? ORDER BY wm.role, u.name`,
      [auth.workspaceId],
    );
    res.json(rows);
  } catch (error) {
    console.error('Workspace members query failed:', error);
    res.status(500).json({ error: 'Could not load workspace members.' });
  }
});

app.patch('/api/workspace/members/:id', requireWorkspacePermission('members.change_role'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { id } = req.params;
  const { role, batchId } = req.body || {};
  if (role !== undefined && !['college_admin', 'trainer', 'student', 'panelist'].includes(role)) return res.status(400).json({ error: 'Choose a valid workspace role.' });
  if (batchId !== undefined && batchId !== null && typeof batchId !== 'string') return res.status(400).json({ error: 'Choose a valid batch.' });
  if (role === undefined && batchId === undefined) return res.status(400).json({ error: 'Choose a role or student batch to update.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('SELECT id FROM Workspaces WHERE id = ? FOR UPDATE', [auth.workspaceId]);
    const [rows]: any = await connection.execute(
      'SELECT userId, role, status FROM WorkspaceMemberships WHERE workspaceId = ? AND userId = ? FOR UPDATE',
      [auth.workspaceId, id],
    );
    const member = rows[0];
    if (!member) { await connection.rollback(); return res.status(404).json({ error: 'Workspace member not found.' }); }
    const [profileRows]: any = await connection.execute('SELECT batchId FROM WorkspaceStudentProfiles WHERE workspaceId = ? AND userId = ? LIMIT 1', [auth.workspaceId, id]);
    member.batchId = profileRows[0]?.batchId || null;
    const nextRole = role || member.role;
    if (id === auth.userId && nextRole !== member.role) {
      await connection.rollback();
      return res.status(400).json({ error: 'You cannot change your own workspace role.' });
    }
    if (batchId !== undefined && nextRole !== 'student') {
      await connection.rollback();
      return res.status(400).json({ error: 'Batch assignment is only available for student members.' });
    }
    const nextBatchId = nextRole === 'student' ? (batchId === undefined ? member.batchId : batchId || null) : null;
    if (nextBatchId) {
      const [batchRows]: any = await connection.execute('SELECT id FROM Batches WHERE id = ? AND workspaceId = ? AND isArchived = 0', [nextBatchId, auth.workspaceId]);
      if (!batchRows.length) { await connection.rollback(); return res.status(400).json({ error: 'Choose an active batch in this workspace.' }); }
    }
    if (member.status === 'active' && nextRole !== member.role && (nextRole === 'student' || nextRole === 'trainer' || nextRole === 'panelist')) {
      const capacity = await getWorkspaceLimitState(connection, auth.workspaceId, nextRole === 'student' ? 'active_students' : 'trainer_seats');
      if (capacity.limit !== null && capacity.usage >= capacity.limit) {
        await connection.rollback();
        return res.status(409).json(planLimitResponse(capacity));
      }
    }
    if (member.role === 'college_admin' && nextRole !== 'college_admin' && member.status === 'active') {
      const [adminRows]: any = await connection.execute(
        `SELECT COUNT(*) AS adminCount FROM WorkspaceMemberships
         WHERE workspaceId = ? AND role = 'college_admin' AND status = 'active'`,
        [auth.workspaceId],
      );
      if (Number(adminRows[0]?.adminCount || 0) <= 1) {
        await connection.rollback();
        return res.status(409).json({ error: 'The last active college administrator cannot be changed to another role.' });
      }
    }
    await connection.execute('UPDATE WorkspaceMemberships SET role = ? WHERE workspaceId = ? AND userId = ?', [nextRole, auth.workspaceId, id]);
    if (member.role === 'panelist' && nextRole !== 'panelist') await connection.execute('UPDATE WorkspaceInterviewPanelists SET userId = NULL WHERE workspaceId = ? AND userId = ?', [auth.workspaceId, id]);
    if (nextRole === 'panelist') await connection.execute('UPDATE WorkspaceInterviewPanelists SET userId = ? WHERE workspaceId = ? AND LOWER(email) = (SELECT LOWER(email) FROM Users WHERE id = ?)', [id, auth.workspaceId, id]);
    if (nextRole === 'student') {
      await connection.execute(
        `INSERT IGNORE INTO StudentProfiles (id, eligibilityJson, weakAreasJson, strengthsJson, recentRemarksJson, batchId)
         VALUES (?, '[]', '[]', '[]', '[]', NULL)`, [id],
      );
      await connection.execute(
        `INSERT INTO WorkspaceStudentProfiles
         (workspaceId, userId, rollNo, phone, college, department, branch, trainerName, attendancePercent, currentDay,
          overallProgressPercent, placementReadinessScore, coding, aptitude, reasoning, sqlScore, csFundamentals,
          communication, techInterview, hrInterview, overallReadiness, eligibilityJson, weakAreasJson, strengthsJson,
          recentRemarksJson, batchId)
         SELECT ?, u.id, u.rollNo, u.phone, w.name, u.department, u.branch, u.trainerName, 0, 1, 0, 0,
          0, 0, 0, 0, 0, 0, 0, 0, 0, '[]', '[]', '[]', '[]', ?
         FROM Users u JOIN Workspaces w ON w.id = ? WHERE u.id = ?
         ON DUPLICATE KEY UPDATE batchId = VALUES(batchId)`,
        [auth.workspaceId, nextBatchId, auth.workspaceId, id],
      );
    }
    await connection.execute(
      'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, targetUserId, detailsJson) VALUES (?, ?, ?, ?, ?, ?)',
      [randomUUID(), auth.workspaceId, auth.userId, 'member.updated', id, JSON.stringify({ previousRole: member.role, role: nextRole, previousBatchId: member.batchId || null, batchId: nextBatchId })],
    );
    await connection.commit();
    res.json({ success: true });
  } catch (error) {
    await connection.rollback();
    console.error('Workspace member update failed:', error);
    res.status(500).json({ error: 'Could not update this workspace member.' });
  } finally {
    connection.release();
  }
});

app.get('/api/workspace/trainers', requireWorkspacePermission('members.read'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [rows]: any = await pool.execute(
      `SELECT u.id, u.name, u.email FROM WorkspaceMemberships wm JOIN Users u ON u.id = wm.userId
       WHERE wm.workspaceId = ? AND wm.role = 'trainer' AND wm.status = 'active' ORDER BY u.name`,
      [auth.workspaceId],
    );
    res.json(rows);
  } catch (error) {
    console.error('Workspace trainers query failed:', error);
    res.status(500).json({ error: 'Could not load workspace trainers.' });
  }
});

app.patch('/api/workspace/students/:id', requireWorkspacePermission('students.update_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { id } = req.params;
  const { batchId, rollNo, phone, department, branch } = req.body || {};
  if (batchId !== undefined && batchId !== null && typeof batchId !== 'string') return res.status(400).json({ error: 'Batch selection is invalid.' });
  for (const [field, value] of Object.entries({ rollNo, phone, department, branch })) {
    if (value !== undefined && (typeof value !== 'string' || value.length > 191)) return res.status(400).json({ error: `${field} must be a short text value.` });
  }
  try {
    const [students]: any = await pool.execute(
      `SELECT 1 FROM WorkspaceMemberships WHERE workspaceId = ? AND userId = ? AND role = 'student' AND status = 'active'`,
      [auth.workspaceId, id],
    );
    if (!students.length) return res.status(404).json({ error: 'Active student not found in this workspace.' });
    if (batchId) {
      const [batches]: any = await pool.execute('SELECT id FROM Batches WHERE id = ? AND workspaceId = ? AND isArchived = 0', [batchId, auth.workspaceId]);
      if (!batches.length) return res.status(400).json({ error: 'Choose a batch in this workspace.' });
    }
    const updates = ['batchId = ?'];
    const values: any[] = [batchId || null];
    for (const field of ['rollNo', 'phone', 'department', 'branch'] as const) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(req.body[field] || null);
      }
    }
    values.push(auth.workspaceId, id);
    await pool.execute(`UPDATE WorkspaceStudentProfiles SET ${updates.join(', ')} WHERE workspaceId = ? AND userId = ?`, values);
    await pool.execute(
      'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, targetUserId, detailsJson) VALUES (?, ?, ?, ?, ?, ?)',
      [randomUUID(), auth.workspaceId, auth.userId, 'student.profile_updated', id, JSON.stringify({ batchId: batchId || null })],
    );
    res.json({ success: true });
  } catch (error: any) {
    if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That roll number is already in use in this workspace.' });
    console.error('Student profile update failed:', error);
    res.status(500).json({ error: 'Could not update the student profile.' });
  }
});

app.post('/api/workspace/members/:id/password-reset', requireWorkspacePermission('members.password_reset'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { id } = req.params;
  if (id === auth.userId) return res.status(400).json({ error: 'Use the account password change option for your own account.' });
  try {
    const [members]: any = await pool.execute(
      `SELECT u.id AS userId, u.name, u.email FROM WorkspaceMemberships m JOIN Users u ON u.id = m.userId
       WHERE m.workspaceId = ? AND m.userId = ? AND m.status = 'active'`,
      [auth.workspaceId, id],
    );
    if (!members.length) return res.status(404).json({ error: 'Active workspace member not found.' });
    if (!(await reserveAccountEmailRateLimit(auth.workspaceId, members[0].email, 'password_reset', req.ip))) return res.status(429).json({ code: 'EMAIL_RATE_LIMITED', error: 'Too many account emails were requested. Try again later.' });
    const token = randomBytes(32).toString('base64url');
    const resetId = randomUUID();
    await pool.execute(
      `INSERT INTO WorkspacePasswordResets (id, workspaceId, userId, tokenHash, expiresAt, createdByUserId)
       VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR), ?)`,
      [resetId, auth.workspaceId, id, hashToken(token), auth.userId],
    );
    await pool.execute(
      'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, targetUserId) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), auth.workspaceId, auth.userId, 'member.password_reset_link_created', id],
    );
    const resetPath = `/?reset=${encodeURIComponent(token)}`;
    const delivery = await sendAccountLifecycleEmail(req, { workspaceId: auth.workspaceId, recipientEmail: members[0].email, recipientName: members[0].name, type: 'password_reset', relatedEntityId: resetId, heading: 'Reset your TalentEdge password', message: 'A college administrator requested a password reset for your account.', actionLabel: 'Reset password', actionUrl: resetPath, expiry: 'This one-time link expires in 60 minutes.', rateLimitReserved: true });
    res.status(201).json({ success: true, resetPath, expiresInMinutes: 60, delivery });
  } catch (error) {
    console.error('Password reset link creation failed:', error);
    res.status(500).json({ error: 'Could not create a password reset link.' });
  }
});

app.get('/api/workspace/email-deliveries', requireWorkspacePermission('audit.read'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [rows]: any = await pool.execute(
      `SELECT id, recipientEmail, deliveryType, relatedEntityId, status, lastError,
       DATE_FORMAT(requestedAt, '%Y-%m-%d %H:%i:%s') AS requestedAt,
       DATE_FORMAT(sentAt, '%Y-%m-%d %H:%i:%s') AS sentAt
       FROM AccountEmailDeliveries WHERE workspaceId = ? ORDER BY requestedAt DESC LIMIT 50`, [auth.workspaceId],
    );
    res.json(rows);
  } catch (error) { console.error('Workspace email delivery history failed:', error); res.status(503).json({ error: 'Apply the account email migration to view delivery history.' }); }
});

app.get('/api/workspace/audit', requireWorkspacePermission('audit.read'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [rows]: any = await pool.execute(
      `SELECT e.id, e.action, e.targetUserId, e.detailsJson, e.createdAt, u.name AS actorName
       FROM WorkspaceAuditEvents e LEFT JOIN Users u ON u.id = e.actorUserId
       WHERE e.workspaceId = ? ORDER BY e.createdAt DESC LIMIT 100`,
      [auth.workspaceId],
    );
    res.json(rows.map((row: any) => ({ ...row, details: JSON.parse(row.detailsJson || '{}') })));
  } catch (error) {
    console.error('Workspace audit query failed:', error);
    res.status(500).json({ error: 'Could not load workspace activity.' });
  }
});

app.patch('/api/workspace/members/:id/status', requireWorkspacePermission('members.change_status'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { id } = req.params;
  const { status } = req.body || {};
  if (!['active', 'inactive'].includes(status)) return res.status(400).json({ error: 'Status must be active or inactive.' });
  if (id === auth.userId && status === 'inactive') return res.status(400).json({ error: 'You cannot deactivate your own account.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('SELECT id FROM Workspaces WHERE id = ? FOR UPDATE', [auth.workspaceId]);
    const [rows]: any = await connection.execute(
      'SELECT m.userId, m.role, m.status, u.name, u.email FROM WorkspaceMemberships m JOIN Users u ON u.id = m.userId WHERE m.workspaceId = ? AND m.userId = ? FOR UPDATE',
      [auth.workspaceId, id],
    );
    const member = rows[0];
    if (!member) {
      await connection.rollback();
      return res.status(404).json({ error: 'Workspace member not found.' });
    }
    if (status === 'active' && member.status !== 'active' && (member.role === 'student' || member.role === 'trainer' || member.role === 'panelist')) {
      const key: PlanLimitKey = member.role === 'student' ? 'active_students' : 'trainer_seats';
      const capacity = await getWorkspaceLimitState(connection, auth.workspaceId, key);
      if (capacity.limit !== null && capacity.usage >= capacity.limit) {
        await connection.rollback();
        return res.status(409).json(planLimitResponse(capacity));
      }
    }
    if (member.role === 'college_admin' && status === 'inactive') {
      const [admins]: any = await connection.execute(
        "SELECT COUNT(*) AS count FROM WorkspaceMemberships WHERE workspaceId = ? AND role = 'college_admin' AND status = 'active'",
        [auth.workspaceId],
      );
      if (Number(admins[0].count) <= 1) {
        await connection.rollback();
        return res.status(400).json({ error: 'The last active college administrator cannot be deactivated.' });
      }
    }
    await connection.execute('UPDATE WorkspaceMemberships SET status = ? WHERE workspaceId = ? AND userId = ?', [status, auth.workspaceId, id]);
    if (status === 'inactive') await connection.execute('DELETE FROM AuthSessions WHERE userId = ? AND workspaceId = ?', [id, auth.workspaceId]);
    await connection.execute(
      'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, targetUserId, detailsJson) VALUES (?, ?, ?, ?, ?, ?)',
      [randomUUID(), auth.workspaceId, auth.userId, status === 'inactive' ? 'member.deactivated' : 'member.reactivated', id, JSON.stringify({ role: member.role })],
    );
    await connection.commit();
    const delivery = await sendAccountLifecycleEmail(req, { workspaceId: auth.workspaceId, recipientEmail: member.email, recipientName: member.name, type: 'account_notice', relatedEntityId: id, heading: status === 'inactive' ? 'Workspace access paused' : 'Workspace access restored', message: status === 'inactive' ? 'Your college workspace access has been paused by an administrator. Contact your college administrator if you believe this was a mistake.' : 'Your college workspace access has been restored. You can sign in with your existing account.' });
    res.json({ success: true, delivery });
  } catch (error) {
    await connection.rollback();
    console.error('Member status update failed:', error);
    res.status(500).json({ error: 'Could not update member status.' });
  } finally {
    connection.release();
  }
});

app.post('/api/workspace/invitations', requireWorkspacePermission('members.invite'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { email, role, batchId } = req.body || {};
  if (!validEmail(email) || !['college_admin', 'trainer', 'student', 'panelist'].includes(role)) {
    return res.status(400).json({ error: 'A valid email and workspace role are required.' });
  }
  if (role === 'student' && batchId !== undefined && batchId !== null && typeof batchId !== 'string') return res.status(400).json({ error: 'Batch selection is invalid.' });
  if (role !== 'student' && batchId) return res.status(400).json({ error: 'Only student invitations can be assigned to a batch.' });
  const normalizedEmail = email.trim().toLowerCase();
  if (!(await reserveAccountEmailRateLimit(auth.workspaceId, normalizedEmail, 'workspace_invitation', req.ip))) return res.status(429).json({ code: 'EMAIL_RATE_LIMITED', error: 'Too many invitation emails were requested. Try again later.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('SELECT id FROM Workspaces WHERE id = ? FOR UPDATE', [auth.workspaceId]);
    if (role === 'student' || role === 'trainer' || role === 'panelist') {
      const key: PlanLimitKey = role === 'student' ? 'active_students' : 'trainer_seats';
      const capacity = await getWorkspaceLimitState(connection, auth.workspaceId, key);
      if (capacity.limit !== null && capacity.usage >= capacity.limit) {
        await connection.rollback();
        return res.status(409).json(planLimitResponse(capacity));
      }
    }
    if (role === 'student' && batchId) {
      const [batches]: any = await connection.execute('SELECT id FROM Batches WHERE id = ? AND workspaceId = ? AND isArchived = 0', [batchId, auth.workspaceId]);
      if (!batches.length) { await connection.rollback(); return res.status(400).json({ error: 'Choose a batch in this workspace.' }); }
    }
    const token = randomBytes(32).toString('base64url');
    const invitationId = randomUUID();
    await connection.execute(
      `INSERT INTO WorkspaceInvitations (id, workspaceId, email, role, batchId, tokenHash, invitedByUserId, expiresAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY))`,
      [invitationId, auth.workspaceId, normalizedEmail, role, batchId || null, hashToken(token), auth.userId],
    );
    await connection.execute(
      'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, detailsJson) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), auth.workspaceId, auth.userId, 'invitation.created', JSON.stringify({ email: email.toLowerCase(), role })],
    );
    await connection.commit();
    const invitePath = `/?invite=${encodeURIComponent(token)}`;
    const delivery = await sendAccountLifecycleEmail(req, { workspaceId: auth.workspaceId, recipientEmail: normalizedEmail, type: 'workspace_invitation', relatedEntityId: invitationId, heading: 'You are invited to TalentEdge', message: `Your college has invited you to join as a ${role.replace('_', ' ')}.`, actionLabel: 'Accept invitation', actionUrl: invitePath, expiry: 'This invitation link expires in 7 days.', rateLimitReserved: true });
    res.status(201).json({ success: true, invitePath, expiresInDays: 7, delivery });
  } catch (error) {
    await connection.rollback();
    console.error('Invitation creation failed:', error);
    res.status(500).json({ error: 'Could not create the invitation.' });
  } finally {
    connection.release();
  }
});

// Lazy-initialized Gemini AI client
let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (process.env.AI_EXTERNAL_PROCESSING_ENABLED !== 'true' || !process.env.GEMINI_API_KEY) return null;
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return geminiClient;
}

const DAY_ONE_LEARNING_CHECK = {
  title: 'Day 1 Learning Check',
  passingScore: 70,
  questions: [
    { prompt: 'What does Big-O notation describe?', options: ['How an algorithm’s resource use grows with input size', 'The exact runtime on every computer', 'The number of variables in a program', 'The maximum size of a source file'], correctIndex: 0 },
    { prompt: 'Which data type is intended to store a whole number?', options: ['Boolean', 'Integer', 'Character', 'String'], correctIndex: 1 },
    { prompt: 'In a typical array, how are elements accessed?', options: ['By index', 'Only from the end', 'By file name', 'By memory size'], correctIndex: 0 },
    { prompt: 'What is a common reason to validate input at a program boundary?', options: ['To prevent invalid values from reaching program logic', 'To make every algorithm O(1)', 'To avoid declaring variables', 'To increase the input size'], correctIndex: 0 },
    { prompt: 'If an algorithm checks each item in a list once, its time complexity is commonly:', options: ['O(1)', 'O(log n)', 'O(n)', 'O(n²)'], correctIndex: 2 },
    { prompt: 'Which complexity usually grows more slowly as input grows?', options: ['O(n²)', 'O(n log n)', 'O(2ⁿ)', 'O(n!)'], correctIndex: 1 },
    { prompt: 'What does a Boolean value represent?', options: ['A true or false condition', 'A decimal number only', 'A sequence of characters', 'A memory address'], correctIndex: 0 },
    { prompt: 'Why are boundary cases important when testing a program?', options: ['They reveal failures at the limits of valid input', 'They always improve runtime', 'They replace normal test cases', 'They remove the need for input validation'], correctIndex: 0 },
    { prompt: 'For an array with zero-based indexing, what is the first element index?', options: ['0', '1', '-1', 'It depends on the element value'], correctIndex: 0 },
    { prompt: 'If an algorithm halves the remaining search range each step, its time complexity is typically:', options: ['O(n²)', 'O(n)', 'O(log n)', 'O(1)'], correctIndex: 2 },
  ],
};

function getDefaultLearningCheck(dayNumber: number) {
  if (dayNumber === 1) return DAY_ONE_LEARNING_CHECK;
  const day = CURRICULUM_40_DAYS.find((item) => item.dayNumber === dayNumber);
  if (!day) throw new Error('Curriculum day not found.');
  const otherDays = CURRICULUM_40_DAYS.filter((item) => item.dayNumber !== dayNumber);
  const buildQuestion = (prompt: string, answer: string, distractors: string[], offset: number) => {
    const options = [answer, ...Array.from(new Set(distractors.filter((value) => value && value !== answer))).slice(0, 3)];
    while (options.length < 4) options.push(`Another Day ${dayNumber} topic`);
    const rotation = offset % options.length;
    const rotatedOptions = [...options.slice(rotation), ...options.slice(0, rotation)];
    return { prompt, options: rotatedOptions, correctIndex: rotatedOptions.indexOf(answer) };
  };
  return {
    title: `Day ${dayNumber} Learning Check`,
    passingScore: 75,
    questions: [
      buildQuestion('Which topic is the focus of this curriculum day?', day.topic, otherDays.map((item) => item.topic), dayNumber),
      buildQuestion('Which concept is included in today’s modules?', day.subtopics[0] || day.topic, otherDays.flatMap((item) => item.subtopics), dayNumber + 1),
      buildQuestion('Which activity is part of today’s practice plan?', day.activities[0] || day.practice, otherDays.flatMap((item) => item.activities), dayNumber + 2),
      buildQuestion('Which outcome is expected from today’s lesson?', day.expectedOutcome, otherDays.map((item) => item.expectedOutcome), dayNumber + 3),
    ],
  };
}

async function reconcileCurriculumDayCompletion(workspaceId: string, studentUserId: string, dayNumber: number) {
  const [[materialState]]: any = await pool.execute(
    `SELECT COUNT(*) AS requiredCount,
            SUM(CASE WHEN p.status = 'completed' THEN 1 ELSE 0 END) AS completedCount
     FROM WorkspaceCurriculumMaterials m
     LEFT JOIN WorkspaceCurriculumMaterialProgress p
       ON p.workspaceId = m.workspaceId AND p.materialId = m.id AND p.studentUserId = ?
     WHERE m.workspaceId = ? AND m.dayNumber = ? AND m.isRequired = 1 AND m.isArchived = 0`,
    [studentUserId, workspaceId, dayNumber],
  );
  const [[passedAttempt]]: any = await pool.execute(
    `SELECT MAX(passed) AS passed FROM WorkspaceCurriculumLearningCheckAttempts
     WHERE workspaceId = ? AND studentUserId = ? AND dayNumber = ?`,
    [workspaceId, studentUserId, dayNumber],
  );
  const requiredCount = Number(materialState.requiredCount || 0);
  const completedCount = Number(materialState.completedCount || 0);
  const completed = requiredCount > 0 && completedCount === requiredCount && Boolean(passedAttempt?.passed);
  if (completed) {
    await pool.execute(
      `INSERT INTO WorkspaceCurriculumProgress (workspaceId, studentUserId, dayNumber)
       VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE completedAt = completedAt`,
      [workspaceId, studentUserId, dayNumber],
    );
  } else {
    await pool.execute('DELETE FROM WorkspaceCurriculumProgress WHERE workspaceId = ? AND studentUserId = ? AND dayNumber = ?', [workspaceId, studentUserId, dayNumber]);
  }
  return { dayNumber, completed, requiredCount, completedCount, checkPassed: Boolean(passedAttempt?.passed) };
}

async function reconcileAllCurriculumProgress(workspaceId: string, studentUserId: string) {
  const [materialRows]: any = await pool.execute(
    `SELECT m.dayNumber, COUNT(*) AS requiredCount,
            SUM(CASE WHEN p.status = 'completed' THEN 1 ELSE 0 END) AS completedCount
     FROM WorkspaceCurriculumMaterials m
     LEFT JOIN WorkspaceCurriculumMaterialProgress p
       ON p.workspaceId = m.workspaceId AND p.materialId = m.id AND p.studentUserId = ?
     WHERE m.workspaceId = ? AND m.isRequired = 1 AND m.isArchived = 0
     GROUP BY m.dayNumber`,
    [studentUserId, workspaceId],
  );
  const [passedRows]: any = await pool.execute(
    `SELECT dayNumber, MAX(passed) AS passed FROM WorkspaceCurriculumLearningCheckAttempts
     WHERE workspaceId = ? AND studentUserId = ? GROUP BY dayNumber`,
    [workspaceId, studentUserId],
  );
  const [existingRows]: any = await pool.execute(
    'SELECT dayNumber FROM WorkspaceCurriculumProgress WHERE workspaceId = ? AND studentUserId = ?',
    [workspaceId, studentUserId],
  );
  const materialsByDay = new Map(materialRows.map((row: any) => [Number(row.dayNumber), row]));
  const passedByDay = new Map(passedRows.map((row: any) => [Number(row.dayNumber), Boolean(row.passed)]));
  const existingCompletedDays = new Set(existingRows.map((row: any) => Number(row.dayNumber)));
  const completedDays = Array.from({ length: 40 }, (_, index) => index + 1).filter((dayNumber) => {
    const materialState: any = materialsByDay.get(dayNumber);
    // Preserve old manual completion for days that have not yet been configured with new materials/checks.
    if (dayNumber > 1 && !materialState && !passedByDay.has(dayNumber) && existingCompletedDays.has(dayNumber)) return true;
    return Number(materialState?.requiredCount || 0) > 0
      && Number(materialState.completedCount || 0) === Number(materialState.requiredCount)
      && passedByDay.get(dayNumber) === true;
  });
  const staleDays = existingRows.map((row: any) => Number(row.dayNumber)).filter((dayNumber: number) => !completedDays.includes(dayNumber));
  if (staleDays.length) {
    await pool.execute(
      `DELETE FROM WorkspaceCurriculumProgress WHERE workspaceId = ? AND studentUserId = ? AND dayNumber IN (${staleDays.map(() => '?').join(',')})`,
      [workspaceId, studentUserId, ...staleDays],
    );
  }
  if (completedDays.length) {
    const values = completedDays.map(() => '(?, ?, ?)').join(',');
    await pool.execute(
      `INSERT INTO WorkspaceCurriculumProgress (workspaceId, studentUserId, dayNumber) VALUES ${values}
       ON DUPLICATE KEY UPDATE completedAt = completedAt`,
      completedDays.flatMap((dayNumber) => [workspaceId, studentUserId, dayNumber]),
    );
  }
  return completedDays;
}

app.get('/api/curriculum/progress', requireWorkspacePermission('curriculum.read_own'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    res.json(await reconcileAllCurriculumProgress(auth.workspaceId, auth.userId));
  } catch (error) {
    console.error('Curriculum progress query failed:', error);
    res.status(500).json({ error: 'Could not load your curriculum progress.' });
  }
});

app.put('/api/curriculum/progress/:dayNumber', requireWorkspacePermission('curriculum.progress.update_own'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const dayNumber = Number(req.params.dayNumber);
  const { completed } = req.body || {};
  if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 40 || typeof completed !== 'boolean') {
    return res.status(400).json({ error: 'Choose a curriculum day from 1 to 40 and provide its completion status.' });
  }
  return res.status(409).json({ error: `Day ${dayNumber} completion is automatic. Review all required materials and pass its learning check.` });
});

app.get('/api/curriculum/learning-check', requireWorkspacePermission('curriculum.read_own'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const dayNumber = Number(req.query.dayNumber || 1);
  if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 40) return res.status(400).json({ error: 'Choose a curriculum day from 1 to 40.' });
  const defaultCheck = getDefaultLearningCheck(dayNumber);
  try {
    await pool.execute(
      `INSERT IGNORE INTO WorkspaceCurriculumLearningChecks (workspaceId, dayNumber, title, passingScore, questionsJson)
       VALUES (?, ?, ?, ?, ?)`,
      [auth.workspaceId, dayNumber, defaultCheck.title, defaultCheck.passingScore, JSON.stringify(defaultCheck.questions)],
    );
    const [[check]]: any = await pool.execute(
      'SELECT title, passingScore, questionsJson FROM WorkspaceCurriculumLearningChecks WHERE workspaceId = ? AND dayNumber = ? LIMIT 1',
      [auth.workspaceId, dayNumber],
    );
    const [[attemptSummary]]: any = await pool.execute(
      `SELECT COUNT(*) AS attemptCount FROM WorkspaceCurriculumLearningCheckAttempts
       WHERE workspaceId = ? AND studentUserId = ? AND dayNumber = ?`,
      [auth.workspaceId, auth.userId, dayNumber],
    );
    const [[latestAttempt]]: any = await pool.execute(
      `SELECT score, questionCount, passed, submittedAt FROM WorkspaceCurriculumLearningCheckAttempts
       WHERE workspaceId = ? AND studentUserId = ? AND dayNumber = ?
       ORDER BY submittedAt DESC, id DESC LIMIT 1`,
      [auth.workspaceId, auth.userId, dayNumber],
    );
    const questions = JSON.parse(check.questionsJson || '[]').map(({ prompt, options }: any) => ({ prompt, options }));
    const completion = await reconcileCurriculumDayCompletion(auth.workspaceId, auth.userId, dayNumber);
    res.json({ dayNumber, title: check.title, passingScore: Number(check.passingScore), questions, attemptCount: Number(attemptSummary.attemptCount || 0), latestAttempt: latestAttempt ? { score: Number(latestAttempt.score), questionCount: Number(latestAttempt.questionCount), passed: Boolean(latestAttempt.passed), submittedAt: latestAttempt.submittedAt } : null, completion });
  } catch (error) {
    console.error('Learning check query failed:', error);
    res.status(500).json({ error: `Could not load the Day ${dayNumber} learning check.` });
  }
});

app.post('/api/curriculum/learning-check/attempts', requireWorkspacePermission('curriculum.progress.update_own'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { answers, dayNumber = 1 } = req.body || {};
  if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 40) return res.status(400).json({ error: 'Choose a curriculum day from 1 to 40.' });
  const defaultCheck = getDefaultLearningCheck(dayNumber);
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return res.status(400).json({ error: 'Answer every learning check question before submitting.' });
  try {
    await pool.execute(
      `INSERT IGNORE INTO WorkspaceCurriculumLearningChecks (workspaceId, dayNumber, title, passingScore, questionsJson)
       VALUES (?, ?, ?, ?, ?)`,
      [auth.workspaceId, dayNumber, defaultCheck.title, defaultCheck.passingScore, JSON.stringify(defaultCheck.questions)],
    );
    const [[check]]: any = await pool.execute(
      'SELECT passingScore, questionsJson FROM WorkspaceCurriculumLearningChecks WHERE workspaceId = ? AND dayNumber = ? LIMIT 1',
      [auth.workspaceId, dayNumber],
    );
    const questions = JSON.parse(check.questionsJson || '[]');
    const submittedAnswers: Record<string, number> = {};
    for (let index = 0; index < questions.length; index += 1) {
      const answer = answers[String(index)];
      if (!Number.isInteger(answer) || answer < 0 || answer >= questions[index].options.length) {
        return res.status(400).json({ error: 'Answer every learning check question before submitting.' });
      }
      submittedAnswers[String(index)] = answer;
    }
    const correct = questions.reduce((count: number, question: any, index: number) => count + (submittedAnswers[String(index)] === question.correctIndex ? 1 : 0), 0);
    const score = questions.length ? Math.round(correct / questions.length * 100) : 0;
    const passed = score >= Number(check.passingScore);
    const attemptId = randomUUID();
    await pool.execute(
      `INSERT INTO WorkspaceCurriculumLearningCheckAttempts (id, workspaceId, studentUserId, dayNumber, score, questionCount, passed, answersJson)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [attemptId, auth.workspaceId, auth.userId, dayNumber, score, questions.length, passed ? 1 : 0, JSON.stringify(submittedAnswers)],
    );
    const completion = await reconcileCurriculumDayCompletion(auth.workspaceId, auth.userId, dayNumber);
    res.status(201).json({ id: attemptId, dayNumber, score, questionCount: questions.length, passingScore: Number(check.passingScore), passed, completion });
  } catch (error) {
    console.error('Learning check submission failed:', error);
    res.status(500).json({ error: 'Could not save your learning check attempt.' });
  }
});

// Curriculum materials are shared per workspace; completion is tracked separately for each student.
app.get('/api/curriculum/materials', requireWorkspacePermission('curriculum.read_own', 'curriculum.read_assigned', 'curriculum.manage_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const dayNumber = Number(req.query.dayNumber || 1);
  if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 40) return res.status(400).json({ error: 'Choose a curriculum day from 1 to 40.' });
  try {
    const [rows]: any = await pool.execute(
      `SELECT m.id, m.dayNumber, m.title, m.materialType, m.contentUrl, m.contentText, m.contentFormat,
              m.position, m.isRequired, m.createdAt, m.updatedAt,
              p.status AS progressStatus, p.videoPositionSeconds, p.completedAt
       FROM WorkspaceCurriculumMaterials m
       LEFT JOIN WorkspaceCurriculumMaterialProgress p
         ON p.workspaceId = m.workspaceId AND p.materialId = m.id AND p.studentUserId = ?
       WHERE m.workspaceId = ? AND m.dayNumber = ? AND m.isArchived = 0
       ORDER BY m.position, m.createdAt, m.title`,
      [auth.role === 'student' ? auth.userId : null, auth.workspaceId, dayNumber],
    );
    res.json(rows.map((row: any) => ({ ...row, isRequired: Boolean(row.isRequired), progressStatus: row.progressStatus || 'not_started' })));
  } catch (error) {
    console.error('Curriculum materials query failed:', error);
    res.status(500).json({ error: `Could not load Day ${dayNumber} learning materials. Apply the latest database migration and retry.` });
  }
});

app.post('/api/curriculum/materials', requireWorkspacePermission('curriculum.manage_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { dayNumber, title, materialType, contentUrl, contentText, contentFormat = 'markdown', isRequired = true } = req.body || {};
  const curriculumDayNumber = Number(dayNumber);
  const normalizedTitle = typeof title === 'string' ? title.trim() : '';
  const normalizedText = typeof contentText === 'string' ? contentText.trim() : '';
  let normalizedUrl: string | null = null;
  if (contentUrl) {
    try {
      const parsed = new URL(contentUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad protocol');
      normalizedUrl = parsed.toString();
    } catch {
      return res.status(400).json({ error: 'Enter a valid HTTP or HTTPS URL for the learning resource.' });
    }
  }
  if (!Number.isInteger(curriculumDayNumber) || curriculumDayNumber < 1 || curriculumDayNumber > 40 || normalizedTitle.length < 2 || normalizedTitle.length > 191 || !['video', 'text', 'pdf'].includes(materialType) || !['markdown', 'html'].includes(contentFormat) || typeof isRequired !== 'boolean' || (materialType === 'text' ? !normalizedText || normalizedText.length > 50000 : !normalizedUrl)) {
    return res.status(400).json({ error: 'Choose a curriculum day, enter a title, and provide lesson text or a valid video/PDF URL.' });
  }
  try {
    const id = randomUUID();
    const [[positionRow]]: any = await pool.execute('SELECT COALESCE(MAX(position), -1) + 1 AS nextPosition FROM WorkspaceCurriculumMaterials WHERE workspaceId = ? AND dayNumber = ?', [auth.workspaceId, curriculumDayNumber]);
    await pool.execute(
      `INSERT INTO WorkspaceCurriculumMaterials
       (id, workspaceId, dayNumber, title, materialType, contentUrl, contentText, contentFormat, position, isRequired, createdByUserId, isCustomized)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [id, auth.workspaceId, curriculumDayNumber, normalizedTitle, materialType, normalizedUrl, materialType === 'text' ? normalizedText : null, contentFormat, positionRow.nextPosition, isRequired ? 1 : 0, auth.userId],
    );
    await pool.execute('INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, detailsJson) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), auth.workspaceId, auth.userId, 'curriculum.material_created', JSON.stringify({ materialId: id, dayNumber: curriculumDayNumber, materialType })]);
    res.status(201).json({ id, dayNumber: curriculumDayNumber, title: normalizedTitle, materialType, contentUrl: normalizedUrl, contentText: materialType === 'text' ? normalizedText : null, contentFormat, position: positionRow.nextPosition, isRequired, progressStatus: 'not_started' });
  } catch (error) {
    console.error('Curriculum material creation failed:', error);
    res.status(500).json({ error: 'Could not save this learning material.' });
  }
});

app.patch('/api/curriculum/materials/:id', requireWorkspacePermission('curriculum.manage_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { title, materialType, contentUrl, contentText, contentFormat, isRequired } = req.body || {};
  try {
    const [existingRows]: any = await pool.execute('SELECT * FROM WorkspaceCurriculumMaterials WHERE id = ? AND workspaceId = ? LIMIT 1', [req.params.id, auth.workspaceId]);
    if (!existingRows.length) return res.status(404).json({ error: 'Learning material not found.' });
    const existing = existingRows[0];
    const nextType = materialType ?? existing.materialType;
    const nextTitle = title === undefined ? existing.title : typeof title === 'string' ? title.trim() : '';
    const nextText = contentText === undefined ? existing.contentText : typeof contentText === 'string' ? contentText.trim() : '';
    const nextFormat = contentFormat === undefined ? existing.contentFormat || 'markdown' : contentFormat;
    let nextUrl = contentUrl === undefined ? existing.contentUrl : null;
    if (contentUrl) {
      try {
        const parsed = new URL(contentUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad protocol');
        nextUrl = parsed.toString();
      } catch {
        return res.status(400).json({ error: 'Enter a valid HTTP or HTTPS URL for the learning resource.' });
      }
    }
    const required = isRequired === undefined ? Boolean(existing.isRequired) : isRequired;
    if (nextTitle.length < 2 || nextTitle.length > 191 || !['video', 'text', 'pdf'].includes(nextType) || !['markdown', 'html'].includes(nextFormat) || typeof required !== 'boolean' || (nextType === 'text' ? !nextText || nextText.length > 50000 : !nextUrl)) {
      return res.status(400).json({ error: 'Enter a title and valid text or resource URL for this learning material.' });
    }
    await pool.execute(
      `UPDATE WorkspaceCurriculumMaterials SET title = ?, materialType = ?, contentUrl = ?, contentText = ?, contentFormat = ?, isRequired = ?, isCustomized = 1 WHERE id = ? AND workspaceId = ?`,
      [nextTitle, nextType, nextType === 'text' ? null : nextUrl, nextType === 'text' ? nextText : null, nextFormat, required ? 1 : 0, req.params.id, auth.workspaceId],
    );
    await pool.execute('INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, detailsJson) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), auth.workspaceId, auth.userId, 'curriculum.material_updated', JSON.stringify({ materialId: req.params.id, dayNumber: existing.dayNumber })]);
    res.json({ id: req.params.id, dayNumber: Number(existing.dayNumber), title: nextTitle, materialType: nextType, contentUrl: nextType === 'text' ? null : nextUrl, contentText: nextType === 'text' ? nextText : null, contentFormat: nextFormat, isRequired: required });
  } catch (error) {
    console.error('Curriculum material update failed:', error);
    res.status(500).json({ error: 'Could not update this learning material.' });
  }
});

app.delete('/api/curriculum/materials/:id', requireWorkspacePermission('curriculum.manage_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [rows]: any = await pool.execute('SELECT dayNumber FROM WorkspaceCurriculumMaterials WHERE id = ? AND workspaceId = ? LIMIT 1', [req.params.id, auth.workspaceId]);
    if (!rows.length) return res.status(404).json({ error: 'Learning material not found.' });
    await pool.execute('DELETE FROM WorkspaceCurriculumMaterials WHERE id = ? AND workspaceId = ?', [req.params.id, auth.workspaceId]);
    await pool.execute('INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, detailsJson) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), auth.workspaceId, auth.userId, 'curriculum.material_deleted', JSON.stringify({ materialId: req.params.id, dayNumber: rows[0].dayNumber })]);
    res.json({ success: true });
  } catch (error) {
    console.error('Curriculum material deletion failed:', error);
    res.status(500).json({ error: 'Could not delete this learning material.' });
  }
});

app.put('/api/curriculum/materials/:id/progress', requireWorkspacePermission('curriculum.progress.update_own'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { status } = req.body || {};
  if (!['in_progress', 'completed'].includes(status)) return res.status(400).json({ error: 'Choose in progress or completed for this material.' });
  try {
    const [materials]: any = await pool.execute('SELECT id, dayNumber FROM WorkspaceCurriculumMaterials WHERE id = ? AND workspaceId = ? LIMIT 1', [req.params.id, auth.workspaceId]);
    if (!materials.length) return res.status(404).json({ error: 'Learning material not found.' });
    await pool.execute(
      `INSERT INTO WorkspaceCurriculumMaterialProgress (workspaceId, studentUserId, materialId, status, completedAt)
       VALUES (?, ?, ?, ?, IF(? = 'completed', CURRENT_TIMESTAMP, NULL))
       ON DUPLICATE KEY UPDATE status = VALUES(status), completedAt = IF(VALUES(status) = 'completed', COALESCE(completedAt, CURRENT_TIMESTAMP), NULL)`,
      [auth.workspaceId, auth.userId, req.params.id, status, status],
    );
    await reconcileCurriculumDayCompletion(auth.workspaceId, auth.userId, Number(materials[0].dayNumber));
    res.json({ materialId: req.params.id, status });
  } catch (error) {
    console.error('Curriculum material progress update failed:', error);
    res.status(500).json({ error: 'Could not save your learning material progress.' });
  }
});

// Fetch all students from MySQL
app.get('/api/students', requireWorkspacePermission('students.read_assigned', 'students.read_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [rows]: any = await pool.execute(`
      SELECT 
        sp.*, u.id AS id,
        u.name, u.email, u.avatar as photo, sp.trainerName as trainer,
        b.name as batch
      FROM WorkspaceStudentProfiles sp
      JOIN Users u ON sp.userId = u.id
      JOIN WorkspaceMemberships wm ON wm.userId = u.id AND wm.workspaceId = sp.workspaceId AND wm.status = 'active'
      LEFT JOIN Batches b ON sp.batchId = b.id AND b.workspaceId = wm.workspaceId
      WHERE sp.workspaceId = ? AND (
         (? = 'college_admin')
         OR (? = 'student' AND u.id = ?)
         OR (? = 'trainer' AND EXISTS (
              SELECT 1 FROM WorkspaceBatchAssignments ba
              WHERE ba.workspaceId = wm.workspaceId AND ba.batchId = sp.batchId AND ba.trainerUserId = ?
            ))
      )
    `, [auth.workspaceId, auth.role, auth.role, auth.userId, auth.role, auth.userId]);

    const students = rows.map((student: any) => ({
      ...student,
      readinessExplanation: explainReadiness({ coding: student.coding, aptitude: student.aptitude,
        reasoning: student.reasoning, sql: student.sqlScore, csFundamentals: student.csFundamentals,
        communication: student.communication, techInterview: student.techInterview, hrInterview: student.hrInterview }),
      metrics: {
        coding: student.coding,
        aptitude: student.aptitude,
        reasoning: student.reasoning,
        sql: student.sqlScore,
        csFundamentals: student.csFundamentals,
        communication: student.communication,
        techInterview: student.techInterview,
        hrInterview: student.hrInterview,
        overallReadiness: student.overallReadiness,
      },
      eligibility: JSON.parse(student.eligibilityJson || '[]'),
      weakAreas: JSON.parse(student.weakAreasJson || '[]'),
      strengths: JSON.parse(student.strengthsJson || '[]'),
      recentRemarks: JSON.parse(student.recentRemarksJson || '[]'),
    }));

    res.json(students);
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({ error: 'Database query failed' });
  }
});

app.get('/api/reports/activity', requireWorkspacePermission('report.read_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const activityType = String(req.query.activityType || 'all');
  const batchId = String(req.query.batchId || '');
  const dateFrom = String(req.query.dateFrom || '');
  const dateTo = String(req.query.dateTo || '');
  const tier = String(req.query.tier || 'all');
  const search = String(req.query.query || '').trim().slice(0, 80);
  const allowedTypes = ['all', 'assessment_submitted', 'interview_scheduled', 'interview_completed'];
  if (!allowedTypes.includes(activityType) || !['all', 'tier1', 'tier2', 'at_risk'].includes(tier)) {
    return res.status(400).json({ error: 'Activity or readiness filter is invalid.' });
  }
  const validDate = (value: string) => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
  if (!validDate(dateFrom) || !validDate(dateTo) || (dateFrom && dateTo && dateFrom > dateTo)) {
    return res.status(400).json({ error: 'Enter a valid date range, with the start date no later than the end date.' });
  }
  try {
    if (batchId) {
      const [batchRows]: any = await pool.execute('SELECT id FROM Batches WHERE id = ? AND workspaceId = ? LIMIT 1', [batchId, auth.workspaceId]);
      if (!batchRows.length) return res.status(400).json({ error: 'Choose a batch in this workspace.' });
    }
    let atRiskBelow = 65;
    let tierOneAtOrAbove = 80;
    const [settingsRows]: any = await pool.execute('SELECT settingsJson FROM WorkspaceSettings WHERE workspaceId = ? LIMIT 1', [auth.workspaceId]);
    if (settingsRows[0]) {
      try {
        const settings = JSON.parse(settingsRows[0].settingsJson);
        if (Number.isInteger(settings.atRiskBelow)) atRiskBelow = settings.atRiskBelow;
        if (Number.isInteger(settings.tierOneAtOrAbove)) tierOneAtOrAbove = settings.tierOneAtOrAbove;
      } catch { /* Use the product defaults if a legacy settings row is malformed. */ }
    }

    const activityQueries: Record<string, string> = {
      assessment_submitted: `
        SELECT s.id, 'assessment_submitted' AS activityType, a.title AS activityName,
               DATE_FORMAT(s.submittedAt, '%Y-%m-%d %H:%i:%s') AS activityDate,
               s.studentId, u.name AS studentName, COALESCE(sp.rollNo, '') AS rollNo,
               sp.batchId, COALESCE(b.name, 'Unassigned') AS batchName,
               COALESCE(sp.placementReadinessScore, 0) AS readinessScore,
               s.percentage AS score, CASE WHEN s.passed = 1 THEN 'Passed' ELSE 'Not passed' END AS outcome
        FROM Submissions s
        JOIN Assessments a ON a.id = s.assessmentId AND a.workspaceId = s.workspaceId
        JOIN Users u ON u.id = s.studentId
        LEFT JOIN WorkspaceStudentProfiles sp ON sp.workspaceId = s.workspaceId AND sp.userId = s.studentId
        LEFT JOIN Batches b ON b.id = sp.batchId AND b.workspaceId = s.workspaceId
        WHERE s.workspaceId = ?`,
      interview_scheduled: `
        SELECT s.id, 'interview_scheduled' AS activityType,
               CONCAT(CASE WHEN s.interviewType = 'tech' THEN 'Technical' ELSE 'HR & behavioral' END, ' interview') AS activityName,
               DATE_FORMAT(s.scheduledAt, '%Y-%m-%d %H:%i:%s') AS activityDate,
               s.studentUserId AS studentId, u.name AS studentName, COALESCE(sp.rollNo, '') AS rollNo,
               sp.batchId, COALESCE(b.name, 'Unassigned') AS batchName,
               COALESCE(sp.placementReadinessScore, 0) AS readinessScore,
               NULL AS score, s.status AS outcome
        FROM WorkspaceInterviewSchedules s
        JOIN Users u ON u.id = s.studentUserId
        LEFT JOIN WorkspaceStudentProfiles sp ON sp.workspaceId = s.workspaceId AND sp.userId = s.studentUserId
        LEFT JOIN Batches b ON b.id = sp.batchId AND b.workspaceId = s.workspaceId
        WHERE s.workspaceId = ? AND s.status = 'scheduled'`,
      interview_completed: `
        SELECT i.id, 'interview_completed' AS activityType,
               CONCAT(CASE WHEN i.type = 'tech' THEN 'Technical' ELSE 'HR & behavioral' END, ' interview evaluation') AS activityName,
               DATE_FORMAT(i.date, '%Y-%m-%d') AS activityDate,
               i.studentId, u.name AS studentName, COALESCE(sp.rollNo, '') AS rollNo,
               sp.batchId, COALESCE(b.name, 'Unassigned') AS batchName,
               COALESCE(sp.placementReadinessScore, 0) AS readinessScore,
               i.score AS score, COALESCE(i.recommendation, i.status, 'Completed') AS outcome
        FROM InterviewRecords i
        JOIN Users u ON u.id = i.studentId
        LEFT JOIN WorkspaceStudentProfiles sp ON sp.workspaceId = i.workspaceId AND sp.userId = i.studentId
        LEFT JOIN Batches b ON b.id = sp.batchId AND b.workspaceId = i.workspaceId
        WHERE i.workspaceId = ? AND i.status = 'Completed'`,
    };
    const selectedQueries = activityType === 'all'
      ? Object.values(activityQueries)
      : [activityQueries[activityType]];
    const conditions = ['1 = 1'];
    const params: any[] = selectedQueries.map(() => auth.workspaceId);
    if (batchId) { conditions.push('activityRows.batchId = ?'); params.push(batchId); }
    if (dateFrom) { conditions.push('DATE(activityRows.activityDate) >= ?'); params.push(dateFrom); }
    if (dateTo) { conditions.push('DATE(activityRows.activityDate) <= ?'); params.push(dateTo); }
    if (tier === 'tier1') { conditions.push('activityRows.readinessScore >= ?'); params.push(tierOneAtOrAbove); }
    if (tier === 'tier2') { conditions.push('activityRows.readinessScore >= ? AND activityRows.readinessScore < ?'); params.push(atRiskBelow, tierOneAtOrAbove); }
    if (tier === 'at_risk') { conditions.push('activityRows.readinessScore < ?'); params.push(atRiskBelow); }
    if (search) { conditions.push('LOWER(CONCAT_WS(\' \', activityRows.studentName, activityRows.rollNo, activityRows.activityName)) LIKE LOWER(?)'); params.push(`%${search}%`); }
    const [rows]: any = await pool.execute(
      `SELECT activityRows.* FROM (${selectedQueries.join(' UNION ALL ')}) activityRows
       WHERE ${conditions.join(' AND ')} ORDER BY activityRows.activityDate DESC, activityRows.studentName ASC LIMIT 1001`,
      params,
    );
    res.json({ rows: rows.slice(0, 1000), truncated: rows.length > 1000 });
  } catch (error) {
    console.error('Workspace activity report failed:', error);
    res.status(500).json({ error: 'Could not load activity report data.' });
  }
});

app.get('/api/reports/interviews', requireWorkspacePermission('report.read_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const batchId = String(req.query.batchId || '').trim();
  const dateFrom = String(req.query.dateFrom || '').trim();
  const dateTo = String(req.query.dateTo || '').trim();
  const interviewType = String(req.query.interviewType || 'all');
  const panelistId = String(req.query.panelistId || '').trim();
  const lifecycle = String(req.query.lifecycle || 'all');
  const followUp = String(req.query.followUp || 'all');
  const followUpOutcomes = ['needs_another_interview', 'referred_for_placement', 'offer_confirmed', 'no_further_action'];
  const validDate = (value: string) => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
  if (!validDate(dateFrom) || !validDate(dateTo) || (dateFrom && dateTo && dateFrom > dateTo)
    || !['all', 'tech', 'hr'].includes(interviewType)
    || !['all', 'scheduled', 'awaiting_evaluation', 'completed', 'cancelled'].includes(lifecycle)
    || !['all', 'unset', ...followUpOutcomes].includes(followUp)) {
    return res.status(400).json({ error: 'One or more interview report filters are invalid.' });
  }
  try {
    if (batchId) {
      const [batchRows]: any = await pool.execute('SELECT id FROM Batches WHERE id = ? AND workspaceId = ? LIMIT 1', [batchId, auth.workspaceId]);
      if (!batchRows.length) return res.status(400).json({ error: 'Choose a batch in this workspace.' });
    }
    if (panelistId) {
      const [panelistRows]: any = await pool.execute('SELECT id FROM WorkspaceInterviewPanelists WHERE id = ? AND workspaceId = ? LIMIT 1', [panelistId, auth.workspaceId]);
      if (!panelistRows.length) return res.status(400).json({ error: 'Choose a panelist in this workspace.' });
    }
    const conditions = ['s.workspaceId = ?'];
    const params: any[] = [auth.workspaceId];
    if (batchId) { conditions.push('sp.batchId = ?'); params.push(batchId); }
    if (dateFrom) { conditions.push('s.scheduledAt >= ?'); params.push(`${dateFrom} 00:00:00`); }
    if (dateTo) { conditions.push('s.scheduledAt < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(dateTo); }
    if (interviewType !== 'all') { conditions.push('s.interviewType = ?'); params.push(interviewType); }
    if (panelistId) { conditions.push('s.panelistId = ?'); params.push(panelistId); }
    if (followUp === 'unset') conditions.push('fu.outcome IS NULL');
    else if (followUp !== 'all') { conditions.push('fu.outcome = ?'); params.push(followUp); }
    if (lifecycle === 'scheduled') conditions.push("s.status = 'scheduled' AND s.scheduledAt > UTC_TIMESTAMP()");
    if (lifecycle === 'awaiting_evaluation') conditions.push("s.status = 'scheduled' AND s.scheduledAt <= UTC_TIMESTAMP()");
    if (lifecycle === 'completed') conditions.push("s.status = 'completed'");
    if (lifecycle === 'cancelled') conditions.push("s.status = 'cancelled'");
    const [rows]: any = await pool.execute(
      `SELECT s.id, s.studentUserId AS studentId, u.name AS studentName, COALESCE(sp.rollNo, '') AS rollNo,
              COALESCE(b.name, 'Unassigned') AS batchName, s.interviewType,
              DATE_FORMAT(s.scheduledAt, '%Y-%m-%d %H:%i:%s') AS scheduledAt, s.durationMinutes,
              s.panelistId, COALESCE(p.name, s.panelist, 'Unassigned') AS panelist, s.status,
              ir.score AS evaluationScore, ir.recommendation AS recommendation,
              DATE_FORMAT(ir.date, '%Y-%m-%d %H:%i:%s') AS evaluationDate,
              fu.outcome AS followUpOutcome, COALESCE(fu.notes, '') AS followUpNotes,
              COALESCE(fu.studentNotes, '') AS followUpStudentNotes
       FROM WorkspaceInterviewSchedules s
       JOIN Users u ON u.id = s.studentUserId
       LEFT JOIN WorkspaceStudentProfiles sp ON sp.workspaceId = s.workspaceId AND sp.userId = s.studentUserId
       LEFT JOIN Batches b ON b.id = sp.batchId AND b.workspaceId = s.workspaceId
       LEFT JOIN WorkspaceInterviewPanelists p ON p.id = s.panelistId AND p.workspaceId = s.workspaceId
       LEFT JOIN InterviewRecords ir ON ir.workspaceId = s.workspaceId AND ir.scheduleId = s.id
       LEFT JOIN WorkspaceInterviewFollowUps fu ON fu.workspaceId = s.workspaceId AND fu.scheduleId = s.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY s.scheduledAt DESC, u.name ASC LIMIT 5001`,
      params,
    );
    const truncated = rows.length > 5000;
    const interviews = rows.slice(0, 5000).map((row: any) => ({
      ...row,
      evaluationScore: row.evaluationScore === null ? null : Number(row.evaluationScore),
      lifecycle: row.status === 'cancelled' ? 'cancelled' : row.status === 'completed' ? 'completed' : new Date(`${row.scheduledAt.replace(' ', 'T')}Z`).getTime() <= Date.now() ? 'awaiting_evaluation' : 'scheduled',
    }));
    const recommendationCounts = { hire: 0, borderline: 0, needImprovement: 0, unrecorded: 0 };
    const completed = interviews.filter((item: any) => item.lifecycle === 'completed');
    for (const item of interviews) {
      const recommendation = String(item.recommendation || '').toLowerCase();
      if (recommendation === 'hire') recommendationCounts.hire += 1;
      else if (recommendation === 'borderline') recommendationCounts.borderline += 1;
      else if (recommendation === 'need improvement' || recommendation === 'remedial') recommendationCounts.needImprovement += 1;
      else if (item.lifecycle === 'completed') recommendationCounts.unrecorded += 1;
    }
    const scores = completed.map((item: any) => item.evaluationScore).filter((value: any) => value !== null && Number.isFinite(value));
    res.json({
      interviews,
      truncated,
      summary: {
        total: interviews.length,
        scheduled: interviews.filter((item: any) => item.lifecycle === 'scheduled').length,
        awaitingEvaluation: interviews.filter((item: any) => item.lifecycle === 'awaiting_evaluation').length,
        completed: completed.length,
        cancelled: interviews.filter((item: any) => item.lifecycle === 'cancelled').length,
        averageScore: scores.length ? Math.round(scores.reduce((sum: number, value: number) => sum + value, 0) / scores.length) : null,
      },
      recommendations: recommendationCounts,
    });
  } catch (error) {
    console.error('Interview analytics report failed:', error);
    res.status(500).json({ error: 'Could not load interview analytics.' });
  }
});

app.get('/api/reports/placement-outcomes', requireWorkspacePermission('report.read_workspace'), requireWorkspaceFeature('advanced_analytics'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const batchId = String(req.query.batchId || '').trim();
  const outcome = String(req.query.outcome || 'all');
  const dateFrom = String(req.query.dateFrom || '').trim();
  const dateTo = String(req.query.dateTo || '').trim();
  const outcomes = ['needs_another_interview', 'referred_for_placement', 'offer_confirmed', 'no_further_action'];
  const validDate = (value: string) => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
  if (!['all', ...outcomes].includes(outcome) || !validDate(dateFrom) || !validDate(dateTo) || (dateFrom && dateTo && dateFrom > dateTo)) {
    return res.status(400).json({ error: 'Choose a valid placement outcome and date range.' });
  }
  try {
    if (batchId) {
      const [batches]: any = await pool.execute('SELECT id FROM Batches WHERE id = ? AND workspaceId = ? LIMIT 1', [batchId, auth.workspaceId]);
      if (!batches.length) return res.status(400).json({ error: 'Choose a batch in this workspace.' });
    }
    const conditions = ['f.workspaceId = ?'];
    const params: any[] = [auth.workspaceId];
    if (batchId) { conditions.push('sp.batchId = ?'); params.push(batchId); }
    if (outcome !== 'all') { conditions.push('f.outcome = ?'); params.push(outcome); }
    if (dateFrom) { conditions.push('f.updatedAt >= ?'); params.push(`${dateFrom} 00:00:00`); }
    if (dateTo) { conditions.push('f.updatedAt < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(dateTo); }
    const [rows]: any = await pool.execute(
      `SELECT f.scheduleId, s.studentUserId AS studentId, u.name AS studentName, u.email,
              COALESCE(sp.rollNo, '') AS rollNo, COALESCE(b.name, 'Unassigned') AS batchName,
              s.interviewType, DATE_FORMAT(s.scheduledAt, '%Y-%m-%d %H:%i:%s') AS interviewDate,
              f.outcome, COALESCE(f.notes, '') AS adminNotes, COALESCE(f.studentNotes, '') AS studentNotes,
              DATE_FORMAT(f.updatedAt, '%Y-%m-%d %H:%i:%s') AS updatedAt,
              (SELECT COUNT(*) FROM WorkspaceInterviewFollowUpHistory h WHERE h.workspaceId = f.workspaceId AND h.scheduleId = f.scheduleId) AS historyCount
       FROM WorkspaceInterviewFollowUps f
       JOIN WorkspaceInterviewSchedules s ON s.id = f.scheduleId AND s.workspaceId = f.workspaceId
       JOIN Users u ON u.id = s.studentUserId
       LEFT JOIN WorkspaceStudentProfiles sp ON sp.workspaceId = s.workspaceId AND sp.userId = s.studentUserId
       LEFT JOIN Batches b ON b.id = sp.batchId AND b.workspaceId = s.workspaceId
       WHERE ${conditions.join(' AND ')}
       ORDER BY f.updatedAt DESC, u.name ASC LIMIT 5001`,
      params,
    );
    res.json({ rows: rows.slice(0, 5000), truncated: rows.length > 5000 });
  } catch (error) {
    console.error('Placement outcome report failed:', error);
    res.status(500).json({ error: 'Could not load placement outcome records.' });
  }
});

// Fetch all batches from MySQL
app.get('/api/batches', requireWorkspacePermission('batches.read_assigned', 'batches.read_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [rows]: any = await pool.execute(
      `SELECT b.id, b.name, b.college, b.trainer, b.currentDay, b.startDate, b.completionDate, b.workspaceId,
              COALESCE(stats.totalStudents, 0) AS totalStudents,
              COALESCE(stats.readyCount, 0) AS readyCount,
              COALESCE(stats.atRiskCount, 0) AS atRiskCount,
              COALESCE(stats.averageScore, 0) AS averageScore,
              COALESCE(stats.attendanceRate, 0) AS attendanceRate,
              assignment.trainerUserId
       FROM Batches b
       LEFT JOIN (
         SELECT sp.batchId, COUNT(*) AS totalStudents,
                SUM(sp.placementReadinessScore >= 80) AS readyCount,
                SUM(sp.placementReadinessScore < 65) AS atRiskCount,
                AVG(sp.placementReadinessScore) AS averageScore,
                AVG(sp.attendancePercent) AS attendanceRate
         FROM WorkspaceStudentProfiles sp
         WHERE sp.workspaceId = ?
         GROUP BY sp.batchId
       ) stats ON stats.batchId = b.id
       LEFT JOIN (
         SELECT ba.batchId, MIN(ba.trainerUserId) AS trainerUserId
         FROM WorkspaceBatchAssignments ba WHERE ba.workspaceId = ? GROUP BY ba.batchId
       ) assignment ON assignment.batchId = b.id
       WHERE b.workspaceId = ? AND b.isArchived = 0 AND (
         ? = 'college_admin'
         OR (? = 'trainer' AND EXISTS (
           SELECT 1 FROM WorkspaceBatchAssignments ba
           WHERE ba.workspaceId = b.workspaceId AND ba.batchId = b.id AND ba.trainerUserId = ?
         ))
         OR (? = 'student' AND EXISTS (
           SELECT 1 FROM WorkspaceStudentProfiles sp WHERE sp.workspaceId = b.workspaceId AND sp.userId = ? AND sp.batchId = b.id
         ))
       )`,
      [auth.workspaceId, auth.workspaceId, auth.workspaceId, auth.role, auth.role, auth.userId, auth.role, auth.userId],
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching batches:', error);
    res.status(500).json({ error: 'Database query failed' });
  }
});

app.post('/api/batches', requireWorkspacePermission('batches.manage'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { name, trainerUserId, startDate, completionDate, currentDay } = req.body || {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.length > 191 || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(completionDate)) {
    return res.status(400).json({ error: 'Enter a batch name and valid start and completion dates.' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('SELECT id FROM Workspaces WHERE id = ? FOR UPDATE', [auth.workspaceId]);
    const capacity = await getWorkspaceLimitState(connection, auth.workspaceId, 'active_batches');
    if (capacity.limit !== null && capacity.usage >= capacity.limit) {
      await connection.rollback();
      return res.status(409).json(planLimitResponse(capacity));
    }
    let trainerName = '';
    if (trainerUserId) {
      const [trainers]: any = await connection.execute(
        `SELECT u.name FROM Users u JOIN WorkspaceMemberships wm ON wm.userId = u.id
         WHERE wm.workspaceId = ? AND wm.userId = ? AND wm.role = 'trainer' AND wm.status = 'active'`,
        [auth.workspaceId, trainerUserId],
      );
      if (!trainers.length) {
        await connection.rollback();
        return res.status(400).json({ error: 'Choose an active trainer in this workspace.' });
      }
      trainerName = trainers[0].name;
    }
    const [workspaces]: any = await connection.execute('SELECT name FROM Workspaces WHERE id = ?', [auth.workspaceId]);
    const id = randomUUID();
    await connection.execute(
      `INSERT INTO Batches (id, name, college, trainer, totalStudents, readyCount, atRiskCount, averageScore, currentDay, startDate, completionDate, attendanceRate, workspaceId, isArchived)
       VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?, 0, ?, 0)`,
      [id, name.trim(), workspaces[0].name, trainerName, Number.isInteger(currentDay) ? Math.max(1, Math.min(40, currentDay)) : 1, startDate, completionDate, auth.workspaceId],
    );
    if (trainerUserId) {
      await connection.execute('INSERT INTO WorkspaceBatchAssignments (workspaceId, batchId, trainerUserId) VALUES (?, ?, ?)', [auth.workspaceId, id, trainerUserId]);
    }
    await connection.execute(
      'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, detailsJson) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), auth.workspaceId, auth.userId, 'batch.created', JSON.stringify({ batchId: id, name: name.trim() })],
    );
    await connection.commit();
    res.status(201).json({ success: true, id });
  } catch (error) {
    await connection.rollback();
    console.error('Batch creation failed:', error);
    res.status(500).json({ error: 'Could not create the batch.' });
  } finally {
    connection.release();
  }
});

app.patch('/api/batches/:id', requireWorkspacePermission('batches.manage'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { id } = req.params;
  const { name, trainerUserId, startDate, completionDate, currentDay, isArchived } = req.body || {};
  if (name !== undefined && (typeof name !== 'string' || name.trim().length < 2 || name.length > 191)) return res.status(400).json({ error: 'Batch name must be at least 2 characters.' });
  if (startDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return res.status(400).json({ error: 'Start date must use YYYY-MM-DD format.' });
  if (completionDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(completionDate)) return res.status(400).json({ error: 'Completion date must use YYYY-MM-DD format.' });
  if (currentDay !== undefined && (!Number.isInteger(currentDay) || currentDay < 1 || currentDay > 40)) return res.status(400).json({ error: 'Current day must be between 1 and 40.' });
  if (isArchived !== undefined && typeof isArchived !== 'boolean') return res.status(400).json({ error: 'Archive state must be boolean.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('SELECT id FROM Workspaces WHERE id = ? FOR UPDATE', [auth.workspaceId]);
    const [batches]: any = await connection.execute('SELECT id, isArchived FROM Batches WHERE id = ? AND workspaceId = ? FOR UPDATE', [id, auth.workspaceId]);
    if (!batches.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'Batch not found in this workspace.' });
    }
    if (batches[0].isArchived && isArchived === false) {
      const capacity = await getWorkspaceLimitState(connection, auth.workspaceId, 'active_batches');
      if (capacity.limit !== null && capacity.usage >= capacity.limit) {
        await connection.rollback();
        return res.status(409).json(planLimitResponse(capacity));
      }
    }
    let trainerName: string | undefined;
    if (trainerUserId !== undefined) {
      trainerName = '';
      if (trainerUserId) {
        const [trainers]: any = await connection.execute(
          `SELECT u.name FROM Users u JOIN WorkspaceMemberships wm ON wm.userId = u.id
           WHERE wm.workspaceId = ? AND wm.userId = ? AND wm.role = 'trainer' AND wm.status = 'active'`,
          [auth.workspaceId, trainerUserId],
        );
        if (!trainers.length) {
          await connection.rollback();
          return res.status(400).json({ error: 'Choose an active trainer in this workspace.' });
        }
        trainerName = trainers[0].name;
      }
      await connection.execute('DELETE FROM WorkspaceBatchAssignments WHERE workspaceId = ? AND batchId = ?', [auth.workspaceId, id]);
      if (trainerUserId) await connection.execute('INSERT INTO WorkspaceBatchAssignments (workspaceId, batchId, trainerUserId) VALUES (?, ?, ?)', [auth.workspaceId, id, trainerUserId]);
    }
    await connection.execute(
      `UPDATE Batches SET name = COALESCE(?, name), trainer = COALESCE(?, trainer),
       startDate = COALESCE(?, startDate), completionDate = COALESCE(?, completionDate),
       currentDay = COALESCE(?, currentDay), isArchived = COALESCE(?, isArchived)
       WHERE id = ? AND workspaceId = ?`,
      [name === undefined ? null : name.trim(), trainerName === undefined ? null : trainerName, startDate ?? null, completionDate ?? null, currentDay ?? null, isArchived === undefined ? null : Number(isArchived), id, auth.workspaceId],
    );
    await connection.execute(
      'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, targetUserId, detailsJson) VALUES (?, ?, ?, ?, ?, ?)',
      [randomUUID(), auth.workspaceId, auth.userId, isArchived ? 'batch.archived' : 'batch.updated', null, JSON.stringify({ batchId: id })],
    );
    await connection.commit();
    res.json({ success: true });
  } catch (error) {
    await connection.rollback();
    console.error('Batch update failed:', error);
    res.status(500).json({ error: 'Could not update the batch.' });
  } finally {
    connection.release();
  }
});

app.get('/api/assessments', requireWorkspacePermission('assessment.read_assigned', 'assessment.read_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    await ensureWorkspaceAssessments(pool, auth.workspaceId);
    const [rows]: any = await pool.execute(
      `SELECT a.* FROM Assessments a
       WHERE a.workspaceId = ? AND a.isArchived = 0 AND (
         ? = 'college_admin'
         OR (? = 'trainer' AND (a.batchId IS NULL OR EXISTS (
           SELECT 1 FROM WorkspaceBatchAssignments ba WHERE ba.workspaceId = a.workspaceId
             AND ba.batchId = a.batchId AND ba.trainerUserId = ?
         )))
         OR (? = 'student' AND (a.batchId IS NULL OR a.batchId = (
           SELECT sp.batchId FROM WorkspaceStudentProfiles sp WHERE sp.workspaceId = a.workspaceId AND sp.userId = ?
         )))
       ) ORDER BY a.dayNumber, a.title`,
      [auth.workspaceId, auth.role, auth.role, auth.userId, auth.role, auth.userId],
    );
    let attemptsByAssessment: Record<string, any> = {};
    if (auth.role === 'student') {
      const [attempts]: any = await pool.execute(
        `SELECT s.assessmentId, COUNT(*) AS attemptCount, MAX(s.submittedAt) AS lastSubmittedAt,
           (SELECT latest.percentage FROM Submissions latest
            WHERE latest.workspaceId = s.workspaceId AND latest.studentId = s.studentId AND latest.assessmentId = s.assessmentId
              AND (latest.resultReleased = 1 OR (latest.gradingStatus <> 'pending_review'
                AND a.resultReleasePolicy = 'after_due' AND a.dueAt IS NOT NULL AND a.dueAt <= UTC_TIMESTAMP()))
            ORDER BY latest.submittedAt DESC, latest.id DESC LIMIT 1) AS latestPercentage,
           (SELECT latest.gradingStatus FROM Submissions latest
            WHERE latest.workspaceId = s.workspaceId AND latest.studentId = s.studentId AND latest.assessmentId = s.assessmentId
            ORDER BY latest.submittedAt DESC, latest.id DESC LIMIT 1) AS latestGradingStatus
         FROM Submissions s
         JOIN Assessments a ON a.workspaceId = s.workspaceId AND a.id = s.assessmentId
         WHERE s.workspaceId = ? AND s.studentId = ?
         GROUP BY s.workspaceId, s.studentId, s.assessmentId`,
        [auth.workspaceId, auth.userId],
      );
      attemptsByAssessment = Object.fromEntries(attempts.map((attempt: any) => [attempt.assessmentId, attempt]));
    }
    res.json(rows.map((row: any) => {
      const attempt = attemptsByAssessment[row.id];
      return serializeAssessment({
        ...row,
        studentStatus: auth.role === 'student' ? (attempt ? 'submitted' : 'not_started') : undefined,
        studentAttemptCount: attempt ? Number(attempt.attemptCount) : 0,
        studentLastSubmittedAt: attempt?.lastSubmittedAt || null,
        studentLatestPercentage: attempt?.latestGradingStatus === 'pending_review' || attempt?.latestPercentage == null
          ? null : Number(attempt.latestPercentage),
        studentLatestGradingStatus: attempt?.latestGradingStatus || null,
        studentLatestResultReleased: attempt?.latestGradingStatus === 'pending_review'
          ? false : attempt?.latestPercentage != null,
        studentCanStart: auth.role !== 'student' || (row.status === 'live'
          && (!(Number(row.maxAttempts) > 0) || Number(attempt?.attemptCount || 0) < Number(row.maxAttempts))
          && (!row.availableAt || Date.now() >= new Date(row.availableAt).getTime())
          && (!row.dueAt || Number(row.allowLateSubmission) || Date.now() <= new Date(row.dueAt).getTime())),
      }, auth.role === 'student');
    }));
  } catch (error) {
    console.error('Assessment catalog query failed:', error);
    res.status(500).json({ error: 'Could not load workspace assessments.' });
  }
});

app.post('/api/assessments', requireWorkspacePermission('assessment.manage_assigned', 'assessment.manage_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { sourceAssessmentId, title, status, scheduledDate, batchId, dayNumber, durationMinutes, purpose, sections, coverage, type, targetCompanies,
    maxAttempts = 0, passPercent = ASSESSMENT_PASS_PERCENT, availableAt = null, dueAt = null, allowLateSubmission = false, resultReleasePolicy = 'immediate' } = req.body || {};
  if (auth.role === 'trainer' && (typeof batchId !== 'string' || !batchId)) return res.status(400).json({ error: 'Assign trainer-created assessments to one of your batches.' });
  if (typeof sourceAssessmentId !== 'string' || typeof title !== 'string' || title.trim().length < 3 || title.length > 191 || !['upcoming', 'live', 'completed'].includes(status) || typeof scheduledDate !== 'string' || scheduledDate.length > 191) {
    return res.status(400).json({ error: 'Choose a source assessment and provide a title, status, and scheduled date.' });
  }
  const normalizedAvailableAt = normalizeAssessmentDate(availableAt);
  const normalizedDueAt = normalizeAssessmentDate(dueAt);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 0 || maxAttempts > 100
    || !Number.isInteger(passPercent) || passPercent < 0 || passPercent > 100
    || (availableAt !== null && normalizedAvailableAt === undefined)
    || (dueAt !== null && normalizedDueAt === undefined)
    || (normalizedAvailableAt && normalizedDueAt && Date.parse(normalizedDueAt) <= Date.parse(normalizedAvailableAt))
    || typeof allowLateSubmission !== 'boolean'
    || !['immediate', 'after_due', 'manual'].includes(resultReleasePolicy)) {
    return res.status(400).json({ error: 'Set a valid attempt limit, availability window, late policy, and result release rule.' });
  }
  try {
    let source: any = null;
    if (sourceAssessmentId?.startsWith('template:')) {
      source = ASSESSMENTS_CATALOG.find((item) => `template:${item.id}` === sourceAssessmentId) || null;
      if (source) source = {
        ...source,
        sectionsJson: JSON.stringify(source.sections), coverageJson: JSON.stringify(source.coverage),
        targetCompaniesJson: JSON.stringify(source.targetCompanies),
      };
    } else if (sourceAssessmentId) {
      const [sources]: any = await pool.execute('SELECT * FROM Assessments WHERE id = ? AND workspaceId = ? AND isArchived = 0 LIMIT 1', [sourceAssessmentId, auth.workspaceId]);
      source = sources[0] || null;
    }
    if (!source) return res.status(404).json({ error: 'Source assessment not found in this workspace.' });
    const parsedSections = sections === undefined ? (source ? JSON.parse(source.sectionsJson) : []) : sections;
    const questionSet = validateAssessmentSections(parsedSections);
    if (questionSet.error) return res.status(400).json({ error: questionSet.error });
    const computedMarks = questionSet.totalMarks;
    if (batchId) {
      const [batches]: any = await pool.execute('SELECT id FROM Batches WHERE id = ? AND workspaceId = ? AND isArchived = 0', [batchId, auth.workspaceId]);
      if (!batches.length) return res.status(400).json({ error: 'Choose a batch in this workspace.' });
      if (auth.role === 'trainer') {
        const [assignments]: any = await pool.execute('SELECT 1 FROM WorkspaceBatchAssignments WHERE workspaceId = ? AND batchId = ? AND trainerUserId = ?', [auth.workspaceId, batchId, auth.userId]);
        if (!assignments.length) return res.status(403).json({ error: 'You are not assigned to that batch.' });
      }
    }
    const assessmentType = type || source?.type || 'technical';
    if (!['diagnostic', 'coding_benchmark', 'aptitude', 'reasoning', 'communication', 'technical', 'sql', 'interview', 'placement_drive', 'final'].includes(assessmentType)) return res.status(400).json({ error: 'Choose a valid assessment type.' });
    const id = randomUUID();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
      `INSERT INTO Assessments
       (id, workspaceId, dayNumber, title, type, durationMinutes, totalMarks, passPercent, coverageJson, purpose, status, scheduledDate, sectionsJson, targetCompaniesJson, createdByUserId, batchId, isCustomized, maxAttempts, availableAt, dueAt, allowLateSubmission, resultReleasePolicy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
      [id, auth.workspaceId, Number.isInteger(dayNumber) ? Math.max(1, Math.min(40, dayNumber)) : source?.dayNumber || 1, title.trim(), assessmentType, Number.isInteger(durationMinutes) ? Math.max(1, Math.min(600, durationMinutes)) : source?.durationMinutes || 60, computedMarks, passPercent, JSON.stringify(Array.isArray(coverage) ? coverage.filter((item: any) => typeof item === 'string').slice(0, 50) : source ? JSON.parse(source.coverageJson) : []), typeof purpose === 'string' ? purpose.slice(0, 255) : source?.purpose || '', status, scheduledDate, JSON.stringify(parsedSections), JSON.stringify(Array.isArray(targetCompanies) ? targetCompanies.filter((item: any) => typeof item === 'string').slice(0, 50) : source ? JSON.parse(source.targetCompaniesJson) : []), auth.userId, batchId || null, maxAttempts, normalizedAvailableAt || null, normalizedDueAt || null, allowLateSubmission ? 1 : 0, resultReleasePolicy],
      );
      await connection.execute(
      `INSERT INTO AssessmentAssignmentRules (assessmentId, workspaceId, batchId, maxAttempts, availableAt, dueAt, allowLateSubmission, resultReleasePolicy, updatedByUserId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, auth.workspaceId, batchId || null, maxAttempts, normalizedAvailableAt || null, normalizedDueAt || null, allowLateSubmission ? 1 : 0, resultReleasePolicy, auth.userId],
      );
      await connection.execute(
      'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, detailsJson) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), auth.workspaceId, auth.userId, 'assessment.created', JSON.stringify({ assessmentId: id, title: title.trim() })],
      );
      const [rows]: any = await connection.execute('SELECT * FROM Assessments WHERE id = ? AND workspaceId = ?', [id, auth.workspaceId]);
      await saveAssessmentVersion(connection, rows[0], auth.userId, 'Assessment created');
      await connection.commit();
      res.status(201).json(serializeAssessment(rows[0]));
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Assessment creation failed:', error);
    res.status(500).json({ error: 'Could not create the assessment.' });
  }
});

app.patch('/api/assessments/:id', requireWorkspacePermission('assessment.manage_assigned', 'assessment.manage_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { id } = req.params;
  const { title, dayNumber, durationMinutes, purpose, status, scheduledDate, batchId, sections, coverage,
    maxAttempts, passPercent, availableAt, dueAt, allowLateSubmission, resultReleasePolicy } = req.body || {};
  if (title !== undefined && (typeof title !== 'string' || title.trim().length < 3 || title.length > 191)) return res.status(400).json({ error: 'Assessment title must be at least 3 characters.' });
  if (dayNumber !== undefined && (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 40)) return res.status(400).json({ error: 'Day number must be between 1 and 40.' });
  if (durationMinutes !== undefined && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 600)) return res.status(400).json({ error: 'Duration must be between 1 and 600 minutes.' });
  if (status !== undefined && !['upcoming', 'live', 'completed'].includes(status)) return res.status(400).json({ error: 'Invalid assessment status.' });
  if (scheduledDate !== undefined && (typeof scheduledDate !== 'string' || scheduledDate.length > 191)) return res.status(400).json({ error: 'Scheduled date is invalid.' });
  if (maxAttempts !== undefined && (!Number.isInteger(maxAttempts) || maxAttempts < 0 || maxAttempts > 100)) return res.status(400).json({ error: 'Maximum attempts must be from 0 (unlimited) to 100.' });
  if (passPercent !== undefined && (!Number.isInteger(passPercent) || passPercent < 0 || passPercent > 100)) return res.status(400).json({ error: 'Pass threshold must be from 0 to 100 percent.' });
  if (allowLateSubmission !== undefined && typeof allowLateSubmission !== 'boolean') return res.status(400).json({ error: 'Late submission setting is invalid.' });
  if (resultReleasePolicy !== undefined && !['immediate', 'after_due', 'manual'].includes(resultReleasePolicy)) return res.status(400).json({ error: 'Result release rule is invalid.' });
  const normalizedAvailableAt = normalizeAssessmentDate(availableAt);
  const normalizedDueAt = normalizeAssessmentDate(dueAt);
  if ((availableAt !== undefined && normalizedAvailableAt === undefined)
    || (dueAt !== undefined && normalizedDueAt === undefined)) return res.status(400).json({ error: 'Availability dates are invalid.' });
  try {
    const [rows]: any = await pool.execute('SELECT * FROM Assessments WHERE id = ? AND workspaceId = ? AND isArchived = 0', [id, auth.workspaceId]);
    if (!rows.length) return res.status(404).json({ error: 'Assessment not found in this workspace.' });
    const existing = rows[0];
    if (auth.role === 'trainer' && !existing.batchId) return res.status(403).json({ error: 'Trainers can only update assessments assigned to their batches.' });
    if (auth.role === 'trainer' && existing.batchId) {
      const [assignments]: any = await pool.execute('SELECT 1 FROM WorkspaceBatchAssignments WHERE workspaceId = ? AND batchId = ? AND trainerUserId = ?', [auth.workspaceId, existing.batchId, auth.userId]);
      if (!assignments.length) return res.status(403).json({ error: 'You are not assigned to this assessment batch.' });
    }
    if (batchId !== undefined && batchId !== null) {
      const [batches]: any = await pool.execute('SELECT id FROM Batches WHERE id = ? AND workspaceId = ? AND isArchived = 0', [batchId, auth.workspaceId]);
      if (!batches.length) return res.status(400).json({ error: 'Choose a batch in this workspace.' });
      if (auth.role === 'trainer') {
        const [assignments]: any = await pool.execute('SELECT 1 FROM WorkspaceBatchAssignments WHERE workspaceId = ? AND batchId = ? AND trainerUserId = ?', [auth.workspaceId, batchId, auth.userId]);
        if (!assignments.length) return res.status(403).json({ error: 'You are not assigned to that batch.' });
      }
    }
    if (auth.role === 'trainer' && batchId === null) return res.status(403).json({ error: 'Trainer-managed assessments must remain assigned to a batch.' });
    const parsedSections = sections === undefined ? JSON.parse(existing.sectionsJson || '[]') : sections;
    const questionSet = validateAssessmentSections(parsedSections);
    if (questionSet.error) return res.status(400).json({ error: questionSet.error });
    const nextAvailableAt = availableAt === undefined ? existing.availableAt : normalizedAvailableAt;
    const nextDueAt = dueAt === undefined ? existing.dueAt : normalizedDueAt;
    if (nextAvailableAt && nextDueAt && new Date(nextDueAt).getTime() <= new Date(nextAvailableAt).getTime()) return res.status(400).json({ error: 'The due date must be later than the available date.' });
    const nextMaxAttempts = maxAttempts === undefined ? Number(existing.maxAttempts || 0) : maxAttempts;
    const nextPassPercent = passPercent === undefined ? Number(existing.passPercent ?? ASSESSMENT_PASS_PERCENT) : passPercent;
    if (nextMaxAttempts > 0) {
      const [[attemptLimitCheck]]: any = await pool.execute(
        `SELECT COUNT(*) AS count FROM (SELECT studentId FROM Submissions WHERE workspaceId = ? AND assessmentId = ? GROUP BY studentId HAVING COUNT(*) > ?) over_limit`,
        [auth.workspaceId, id, nextMaxAttempts],
      );
      if (Number(attemptLimitCheck.count) > 0) return res.status(400).json({ error: 'The attempt limit cannot be lower than attempts already submitted.' });
    }
    const nextBatchId = batchId === undefined ? existing.batchId : batchId;
    const nextAllowLate = allowLateSubmission === undefined ? Boolean(existing.allowLateSubmission) : allowLateSubmission;
    const nextResultPolicy = resultReleasePolicy === undefined ? existing.resultReleasePolicy : resultReleasePolicy;
    const nextTitle = title === undefined ? existing.title : title.trim();
    const nextPurpose = purpose === undefined ? existing.purpose : purpose;
    const nextDayNumber = dayNumber === undefined ? existing.dayNumber : dayNumber;
    const nextDuration = durationMinutes === undefined ? existing.durationMinutes : durationMinutes;
    const nextStatus = status === undefined ? existing.status : status;
    const nextScheduledDate = scheduledDate === undefined ? existing.scheduledDate : scheduledDate;
    const nextCoverage = coverage === undefined ? JSON.parse(existing.coverageJson || '[]') : coverage;
    if (!Array.isArray(nextCoverage) || nextCoverage.length > 50 || nextCoverage.some((topic: any) => typeof topic !== 'string')) return res.status(400).json({ error: 'Assessment topics must be a list of up to 50 text values.' });
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [lockedAssessments]: any = await connection.execute(
        'SELECT currentVersion FROM Assessments WHERE id = ? AND workspaceId = ? AND isArchived = 0 LIMIT 1 FOR UPDATE',
        [id, auth.workspaceId],
      );
      if (!lockedAssessments.length) { await connection.rollback(); return res.status(404).json({ error: 'Assessment not found.' }); }
      if (Number(lockedAssessments[0].currentVersion || 1) !== Number(existing.currentVersion || 1)) {
        await connection.rollback();
        return res.status(409).json({ error: 'Another editor saved a newer assessment version. Reload before saving your changes.' });
      }
      if (nextMaxAttempts > 0) {
        const [[lockedAttemptLimitCheck]]: any = await connection.execute(
          `SELECT COUNT(*) AS count FROM (SELECT studentId FROM Submissions WHERE workspaceId = ? AND assessmentId = ? GROUP BY studentId HAVING COUNT(*) > ?) over_limit`,
          [auth.workspaceId, id, nextMaxAttempts],
        );
        if (Number(lockedAttemptLimitCheck.count) > 0) {
          await connection.rollback();
          return res.status(400).json({ error: 'The attempt limit cannot be lower than attempts already submitted.' });
        }
      }
      await connection.execute(
      `UPDATE Assessments SET title = COALESCE(?, title), dayNumber = COALESCE(?, dayNumber),
       durationMinutes = ?, purpose = ?, status = ?, scheduledDate = ?, batchId = ?,
       sectionsJson = ?, totalMarks = ?, coverageJson = ?, maxAttempts = ?, availableAt = ?, dueAt = ?,
       passPercent = ?, allowLateSubmission = ?, resultReleasePolicy = ?, currentVersion = currentVersion + 1,
       isCustomized = 1, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND workspaceId = ?`,
      [nextTitle, nextDayNumber, nextDuration, nextPurpose, nextStatus, nextScheduledDate, nextBatchId,
        JSON.stringify(parsedSections), questionSet.totalMarks, JSON.stringify(nextCoverage), nextMaxAttempts,
        nextAvailableAt || null, nextDueAt || null, nextPassPercent, nextAllowLate ? 1 : 0, nextResultPolicy, id, auth.workspaceId],
      );
      await connection.execute(
      `UPDATE AssessmentAssignmentRules SET batchId = ?, maxAttempts = ?, availableAt = ?, dueAt = ?,
       allowLateSubmission = ?, resultReleasePolicy = ?, updatedByUserId = ? WHERE assessmentId = ? AND workspaceId = ?`,
      [nextBatchId, nextMaxAttempts, nextAvailableAt || null, nextDueAt || null, nextAllowLate ? 1 : 0, nextResultPolicy, auth.userId, id, auth.workspaceId],
      );
      await connection.execute(
      'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, detailsJson) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), auth.workspaceId, auth.userId, 'assessment.updated', JSON.stringify({ assessmentId: id })],
      );
      const [updated]: any = await connection.execute('SELECT * FROM Assessments WHERE id = ? AND workspaceId = ?', [id, auth.workspaceId]);
      await saveAssessmentVersion(connection, updated[0], auth.userId, 'Assessment content, schedule, or assignment updated');
      await connection.commit();
      res.json(serializeAssessment(updated[0]));
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Assessment update failed:', error);
    res.status(500).json({ error: 'Could not update the assessment.' });
  }
});

app.delete('/api/assessments/:id', requireWorkspacePermission('assessment.manage_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [result]: any = await pool.execute('UPDATE Assessments SET isArchived = 1 WHERE id = ? AND workspaceId = ? AND isArchived = 0', [req.params.id, auth.workspaceId]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Assessment not found in this workspace.' });
    await pool.execute(
      'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, detailsJson) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), auth.workspaceId, auth.userId, 'assessment.archived', JSON.stringify({ assessmentId: req.params.id })],
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Assessment archive failed:', error);
    res.status(500).json({ error: 'Could not archive the assessment.' });
  }
});

app.post('/api/assessments/:id/submissions', requireWorkspacePermission('assessment.submit_own'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { answers, codingAnswers = {}, timeSpentSeconds, assessmentVersion, requestId } = req.body || {};
  if (!answers || typeof answers !== 'object' || Array.isArray(answers) || !codingAnswers
    || typeof codingAnswers !== 'object' || Array.isArray(codingAnswers)
    || !Number.isInteger(timeSpentSeconds) || timeSpentSeconds < 0
    || !Number.isInteger(assessmentVersion) || assessmentVersion < 1
    || typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId)) {
    return res.status(400).json({ error: 'Assessment answers and elapsed time are required.' });
  }
  const connection = await pool.getConnection();
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const [assessmentLocks]: any = await connection.execute(
      'SELECT id FROM Assessments WHERE id = ? AND workspaceId = ? LIMIT 1 FOR UPDATE',
      [req.params.id, auth.workspaceId],
    );
    if (!assessmentLocks.length) {
      await connection.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'Assessment not found.' });
    }
    const [priorAttempts]: any = await connection.execute(
      `SELECT id, assessmentId, score, totalMarks, percentage, passed, timeSpentSeconds, attemptNumber, gradingStatus, resultReleased
       FROM Submissions WHERE workspaceId = ? AND studentId = ? AND clientRequestId = ? LIMIT 1 FOR UPDATE`,
      [auth.workspaceId, auth.userId, requestId],
    );
    if (priorAttempts.length) {
      const prior = priorAttempts[0];
      await connection.rollback(); transactionStarted = false;
      if (prior.assessmentId !== req.params.id) return res.status(409).json({ error: 'This submission request was already used.' });
      return res.status(200).json({ id: prior.id, score: Number(prior.score), totalMarks: Number(prior.totalMarks),
        percentage: Number(prior.percentage), passed: Boolean(prior.passed), timeSpentSeconds: Number(prior.timeSpentSeconds),
        attemptNumber: Number(prior.attemptNumber), gradingStatus: prior.gradingStatus, resultReleased: Boolean(prior.resultReleased) });
    }
    const [rows]: any = await connection.execute(
      `SELECT a.* FROM Assessments a
       JOIN WorkspaceMemberships wm ON wm.workspaceId = a.workspaceId AND wm.userId = ? AND wm.status = 'active'
       JOIN WorkspaceStudentProfiles sp ON sp.workspaceId = wm.workspaceId AND sp.userId = wm.userId
       WHERE a.id = ? AND a.workspaceId = ? AND a.isArchived = 0 AND a.status = 'live'
         AND (a.batchId IS NULL OR a.batchId = sp.batchId) LIMIT 1 FOR UPDATE`,
      [auth.userId, req.params.id, auth.workspaceId],
    );
    const assessment = rows[0];
    if (!assessment) {
      await connection.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'This assessment is not live or assigned to your batch.' });
    }
    if (Number(assessment.currentVersion || 1) !== assessmentVersion) {
      await connection.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'This assessment was revised while you were taking it. Reload the current version before submitting.' });
    }
    const now = Date.now();
    if (assessment.availableAt && now < new Date(assessment.availableAt).getTime()) {
      await connection.rollback(); transactionStarted = false;
      return res.status(403).json({ error: 'This assessment is not available yet.' });
    }
    if (assessment.dueAt && now > new Date(assessment.dueAt).getTime() && !Number(assessment.allowLateSubmission)) {
      await connection.rollback(); transactionStarted = false;
      return res.status(403).json({ error: 'The submission deadline has passed.' });
    }
    if (timeSpentSeconds > Number(assessment.durationMinutes) * 60 + 120) {
      await connection.rollback(); transactionStarted = false;
      return res.status(400).json({ error: 'Elapsed time exceeds the assessment duration.' });
    }
    const [[attemptSummary]]: any = await connection.execute(
      'SELECT COUNT(*) AS attemptCount FROM Submissions WHERE workspaceId = ? AND assessmentId = ? AND studentId = ?',
      [auth.workspaceId, assessment.id, auth.userId],
    );
    const attemptNumber = Number(attemptSummary.attemptCount || 0) + 1;
    const maximumAttempts = Number(assessment.maxAttempts || 0);
    if (maximumAttempts > 0 && attemptNumber > maximumAttempts) {
      await connection.rollback(); transactionStarted = false;
      return res.status(403).json({ error: `You have used all ${maximumAttempts} allowed attempts.` });
    }
    const sections = JSON.parse(assessment.sectionsJson || '[]');
    const questions = sections.flatMap((section: any) => section.questions || []);
    let score = 0;
    let maxMarks = 0;
    let hasCodingQuestions = false;
    const codingResults: Record<string, any> = {};
    const normalizedAnswers: Record<string, number> = {};
    const normalizedCodingAnswers: Record<string, { code: string; language: string }> = {};
    for (const [index, question] of questions.entries()) {
      if (question.type === 'mcq') {
        const marks = Number(question.data?.marks || 0);
        maxMarks += marks;
        const submitted = answers[String(index)];
        if (submitted !== undefined) {
          if (!Number.isInteger(submitted) || submitted < 0 || submitted >= question.data.options.length) {
            await connection.rollback(); transactionStarted = false;
            return res.status(400).json({ error: 'One or more multiple-choice answers are invalid.' });
          }
          normalizedAnswers[String(index)] = submitted;
          if (submitted === Number(question.data?.correctIndex)) score += marks;
        }
      } else if (question.type === 'coding') {
        maxMarks += Number(question.data?.marks || 30);
        hasCodingQuestions = true;
        const submitted = codingAnswers[String(index)];
        if (submitted !== undefined) {
          if (!submitted || typeof submitted.code !== 'string' || submitted.code.length > 100000
            || typeof submitted.language !== 'string' || submitted.language.length > 32) {
            await connection.rollback(); transactionStarted = false;
            return res.status(400).json({ error: 'A submitted code answer is invalid or too large.' });
          }
          normalizedCodingAnswers[String(index)] = submitted;
          const judged = await executeOnJudge0(submitted.code, submitted.language, question.data.testCases || [], question.data);
          const codingScore = Math.round(Number(question.data?.marks || 30) * judged.score / 100);
          codingResults[String(index)] = { score: codingScore, passedTestCases: judged.passedTestCases,
            totalTestCases: judged.totalTestCases, executionTimeMs: judged.executionTimeMs,
            memoryKb: judged.memoryKb, results: judged.results };
          score += codingScore;
        } else {
          codingResults[String(index)] = { score: 0, passedTestCases: 0, totalTestCases: (question.data.testCases || []).length, results: [] };
        }
      }
    }
    const questionKeys = new Set(questions.map((_question: any, index: number) => String(index)));
    if (Object.keys(answers).some((key) => !questionKeys.has(key))
      || Object.keys(codingAnswers).some((key) => !questionKeys.has(key) || questions[Number(key)]?.type !== 'coding')) {
      await connection.rollback(); transactionStarted = false;
      return res.status(400).json({ error: 'Answers include an unknown question.' });
    }
    maxMarks = maxMarks || Number(assessment.totalMarks || 0);
    const percentage = maxMarks ? Math.round(score / maxMarks * 100) : 0;
    const submissionId = randomUUID();
    const gradingStatus = 'auto_graded';
    const resultReleased = assessment.resultReleasePolicy === 'immediate'
      ? 1
      : assessment.resultReleasePolicy === 'after_due' && assessment.dueAt
        && now >= new Date(assessment.dueAt).getTime() ? 1 : 0;
    await connection.execute(
      `INSERT INTO Submissions
       (id, workspaceId, assessmentId, studentId, score, totalMarks, percentage, timeSpentSeconds,
        answersJson, codingResultsJson, codingAnswersJson, passed, assessmentVersion, attemptNumber,
        gradingStatus, resultReleased, clientRequestId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [submissionId, auth.workspaceId, assessment.id, auth.userId, score, maxMarks, percentage, timeSpentSeconds,
        JSON.stringify(normalizedAnswers), JSON.stringify(codingResults), JSON.stringify(normalizedCodingAnswers),
        percentage >= Number(assessment.passPercent ?? ASSESSMENT_PASS_PERCENT) ? 1 : 0,
        Number(assessment.currentVersion || 1), attemptNumber, gradingStatus, resultReleased, requestId],
    );
    await connection.execute(
      'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, targetUserId, detailsJson) VALUES (?, ?, ?, ?, ?, ?)',
      [randomUUID(), auth.workspaceId, auth.userId, 'assessment.attempt_submitted', auth.userId,
        JSON.stringify({ assessmentId: assessment.id, attemptNumber, version: Number(assessment.currentVersion || 1), gradingStatus })],
    );
    await connection.commit();
    transactionStarted = false;
    res.status(201).json({ id: submissionId, score, totalMarks: maxMarks, percentage,
      passed: percentage >= Number(assessment.passPercent ?? ASSESSMENT_PASS_PERCENT), timeSpentSeconds,
      attemptNumber, gradingStatus, resultReleased: Boolean(resultReleased) });
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    console.error('Assessment submission failed:', error);
    const judgeFailure = error instanceof Error && /Judge0|code execution|coding judge|Bundled .* cases/i.test(error.message);
    res.status(judgeFailure ? 503 : 500).json({ error: judgeFailure
      ? 'The coding judge could not evaluate this attempt. No attempt was saved; retry when the judge is available.'
      : 'Could not save this assessment attempt.' });
  } finally {
    connection.release();
  }
});

app.get('/api/assessments/submissions/mine', requireWorkspacePermission('assessment.read_own'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [rows]: any = await pool.execute(
      `SELECT s.id, s.assessmentId, a.title AS assessmentTitle, s.score, s.totalMarks, s.percentage,
              s.timeSpentSeconds, s.submittedAt, s.answersJson, s.codingResultsJson, s.codingAnswersJson,
              s.feedbackJson, s.passed, s.attemptNumber, s.assessmentVersion, s.gradingStatus,
              s.resultReleased, a.resultReleasePolicy, a.dueAt
       FROM Submissions s JOIN Assessments a ON a.id = s.assessmentId AND a.workspaceId = s.workspaceId
       WHERE s.workspaceId = ? AND s.studentId = ? ORDER BY s.submittedAt DESC LIMIT 100`,
      [auth.workspaceId, auth.userId],
    );
    res.json(rows.map((row: any) => {
      const released = Boolean(row.resultReleased)
        || (row.gradingStatus !== 'pending_review' && row.resultReleasePolicy === 'after_due'
          && row.dueAt && Date.now() >= new Date(row.dueAt).getTime());
      const { answersJson, codingResultsJson, codingAnswersJson, feedbackJson, ...safeRow } = row;
      const rawCodingResults = parseStoredJson<Record<string, any>>(codingResultsJson || '{}', {});
      const safeCodingResults = released ? Object.fromEntries(Object.entries(rawCodingResults).map(([key, value]) =>
        [key, typeof value === 'number' ? value : Number(value?.score || 0)])) : null;
      return { ...safeRow, score: released ? Number(row.score) : null, percentage: released ? Number(row.percentage) : null,
        answers: released ? JSON.parse(answersJson || '{}') : null,
        codingResults: safeCodingResults,
        codingAnswers: released ? JSON.parse(codingAnswersJson || '{}') : null,
        feedback: released ? JSON.parse(feedbackJson || 'null') : null,
        passed: released ? Boolean(row.passed) : null, resultReleased: released };
    }));
  } catch (error) {
    console.error('Assessment history query failed:', error);
    res.status(500).json({ error: 'Could not load your assessment history.' });
  }
});

app.get('/api/assessments/:id/versions', requireWorkspacePermission('assessment.read_assigned', 'assessment.read_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [assessmentRows]: any = await pool.execute(
      `SELECT a.batchId FROM Assessments a WHERE a.workspaceId = ? AND a.id = ? AND a.isArchived = 0
       AND (? = 'college_admin' OR (? = 'trainer' AND a.batchId IS NOT NULL AND EXISTS (
         SELECT 1 FROM WorkspaceBatchAssignments ba WHERE ba.workspaceId = a.workspaceId
           AND ba.batchId = a.batchId AND ba.trainerUserId = ?))) LIMIT 1`,
      [auth.workspaceId, req.params.id, auth.role, auth.role, auth.userId],
    );
    if (!assessmentRows.length) return res.status(404).json({ error: 'Assessment not found in your workspace or assigned scope.' });
    const [rows]: any = await pool.execute(
      `SELECT v.versionNumber, v.snapshotJson, v.changeSummary, v.createdAt, u.name AS createdBy
       FROM AssessmentVersions v LEFT JOIN Users u ON u.id = v.createdByUserId
       WHERE v.workspaceId = ? AND v.assessmentId = ? ORDER BY v.versionNumber DESC`,
      [auth.workspaceId, req.params.id],
    );
    res.json(rows.map((row: any) => ({ ...row, snapshot: JSON.parse(row.snapshotJson) })));
  } catch (error) {
    console.error('Assessment version history query failed:', error);
    res.status(500).json({ error: 'Could not load assessment version history.' });
  }
});

app.patch('/api/assessments/submissions/:submissionId/review', requireWorkspacePermission('assessment.manage_assigned', 'assessment.manage_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { score, feedback = '', releaseResults = false } = req.body || {};
  if (!Number.isFinite(score) || score < 0 || typeof feedback !== 'string' || feedback.length > 5000
    || typeof releaseResults !== 'boolean') return res.status(400).json({ error: 'Provide a valid final score, feedback, and result release setting.' });
  try {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows]: any = await connection.execute(
        `SELECT s.id, s.studentId, s.assessmentId, s.totalMarks, s.assessmentVersion, s.gradingStatus, s.resultReleased, a.title, a.resultReleasePolicy, a.dueAt, a.batchId, a.passPercent,
                v.snapshotJson
         FROM Submissions s JOIN Assessments a ON a.id = s.assessmentId AND a.workspaceId = s.workspaceId
         LEFT JOIN AssessmentVersions v ON v.workspaceId = s.workspaceId AND v.assessmentId = s.assessmentId AND v.versionNumber = s.assessmentVersion
         WHERE s.workspaceId = ? AND s.id = ? LIMIT 1 FOR UPDATE`,
        [auth.workspaceId, req.params.submissionId],
      );
      const submission = rows[0];
      if (!submission) { await connection.rollback(); return res.status(404).json({ error: 'Submission not found.' }); }
      if (score > Number(submission.totalMarks)) { await connection.rollback(); return res.status(400).json({ error: 'Score cannot exceed the assessment total.' }); }
      if (auth.role === 'trainer') {
        const [assigned]: any = await connection.execute(
          `SELECT 1 FROM WorkspaceStudentProfiles sp JOIN WorkspaceBatchAssignments ba
             ON ba.workspaceId = sp.workspaceId AND ba.batchId = sp.batchId
           WHERE sp.workspaceId = ? AND sp.userId = ? AND ba.trainerUserId = ? LIMIT 1`,
          [auth.workspaceId, submission.studentId, auth.userId],
        );
        if (!assigned.length) { await connection.rollback(); return res.status(403).json({ error: 'You are not assigned to this student.' }); }
      }
      const percentage = Number(submission.totalMarks) ? Math.round(score / Number(submission.totalMarks) * 100) : 0;
      const attemptSnapshot = submission.snapshotJson ? JSON.parse(submission.snapshotJson) : {};
      const passPercent = Number(attemptSnapshot.passPercent ?? submission.passPercent ?? ASSESSMENT_PASS_PERCENT);
      const release = releaseResults || Boolean(submission.resultReleased) || submission.resultReleasePolicy === 'immediate'
        || (submission.resultReleasePolicy === 'after_due' && submission.dueAt
          && Date.now() >= new Date(submission.dueAt).getTime());
      await connection.execute(
        `UPDATE Submissions SET score = ?, percentage = ?, passed = ?, gradingStatus = 'reviewed',
         feedbackJson = ?, gradedByUserId = ?, gradedAt = CURRENT_TIMESTAMP,
         resultReleased = IF(?, 1, resultReleased) WHERE workspaceId = ? AND id = ?`,
        [score, percentage, percentage >= passPercent ? 1 : 0,
          JSON.stringify({ text: feedback.trim() }), auth.userId, release ? 1 : 0, auth.workspaceId, submission.id],
      );
      await connection.execute(
        'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, targetUserId, detailsJson) VALUES (?, ?, ?, ?, ?, ?)',
        [randomUUID(), auth.workspaceId, auth.userId, 'assessment.submission_reviewed', submission.studentId,
          JSON.stringify({ assessmentId: submission.assessmentId, submissionId: submission.id, percentage, released: release })],
      );
      await connection.commit();
      res.json({ success: true, score, percentage, passed: percentage >= passPercent, resultReleased: release });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Assessment review failed:', error);
    res.status(500).json({ error: 'Could not save this assessment review.' });
  }
});

app.get('/api/assessments/:id/submissions', requireWorkspacePermission('assessment.read_assigned', 'assessment.read_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [rows]: any = await pool.execute(
      `SELECT s.id, s.assessmentId, a.title AS assessmentTitle, s.studentId, u.name AS studentName,
              s.score, s.totalMarks, s.percentage, s.timeSpentSeconds, s.submittedAt, s.passed,
              s.attemptNumber, s.assessmentVersion, s.gradingStatus, s.resultReleased,
              s.answersJson, s.codingAnswersJson, s.codingResultsJson, s.feedbackJson, s.gradedAt
       FROM Submissions s JOIN Assessments a ON a.id = s.assessmentId AND a.workspaceId = s.workspaceId
       JOIN Users u ON u.id = s.studentId
       WHERE s.workspaceId = ? AND s.assessmentId = ? AND (
         ? = 'college_admin' OR EXISTS (
           SELECT 1 FROM WorkspaceStudentProfiles sp JOIN WorkspaceBatchAssignments ba ON ba.workspaceId = sp.workspaceId AND ba.batchId = sp.batchId
           WHERE sp.workspaceId = s.workspaceId AND sp.userId = s.studentId AND ba.trainerUserId = ?
         )
       ) ORDER BY s.submittedAt DESC`,
      [auth.workspaceId, req.params.id, auth.role, auth.userId],
    );
    res.json(rows.map((row: any) => ({ ...row, answers: JSON.parse(row.answersJson || '{}'),
      codingAnswers: JSON.parse(row.codingAnswersJson || '{}'), codingResults: JSON.parse(row.codingResultsJson || '{}'),
      feedback: JSON.parse(row.feedbackJson || 'null'),
      passed: Boolean(row.passed), resultReleased: Boolean(row.resultReleased) })));
  } catch (error) {
    console.error('Assessment submissions query failed:', error);
    res.status(500).json({ error: 'Could not load assessment submissions.' });
  }
});

app.get('/api/leaderboard', requireWorkspacePermission('leaderboard.read_assigned', 'analytics.read_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [rows]: any = await pool.execute(
      `SELECT u.id AS studentId, u.name AS studentName, sp.rollNo,
              COALESCE(b.name, '') AS batch, u.avatar,
              sp.placementReadinessScore AS score, sp.coding AS codingScore,
              sp.aptitude AS aptitudeScore, sp.communication AS communicationScore
       FROM WorkspaceStudentProfiles sp
       JOIN Users u ON u.id = sp.userId
       JOIN WorkspaceMemberships wm ON wm.userId = u.id AND wm.workspaceId = sp.workspaceId AND wm.status = 'active' AND wm.role = 'student'
       LEFT JOIN Batches b ON b.id = sp.batchId AND b.workspaceId = wm.workspaceId
       WHERE sp.workspaceId = ? AND ((? = 'college_admin')
          OR (? = 'trainer' AND EXISTS (
            SELECT 1 FROM WorkspaceBatchAssignments ba WHERE ba.workspaceId = wm.workspaceId
              AND ba.batchId = sp.batchId AND ba.trainerUserId = ?
          ))
          OR (? = 'student' AND sp.batchId = (SELECT own.batchId FROM WorkspaceStudentProfiles own WHERE own.workspaceId = wm.workspaceId AND own.userId = ?))
       )
       ORDER BY sp.placementReadinessScore DESC, u.name ASC`,
      [auth.workspaceId, auth.role, auth.role, auth.userId, auth.role, auth.userId],
    );
    res.json(rows.map((row: any) => ({ ...row, avatar: row.avatar || '', badges: [] })));
  } catch (error) {
    console.error('Leaderboard query failed:', error);
    res.status(500).json({ error: 'Could not load workspace leaderboard.' });
  }
});

// Fetch all notifications from MySQL
app.get('/api/notifications', requireWorkspacePermission('notifications.read_own'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [broadcastRows]: any = await pool.execute(
      `SELECT id, title, \`desc\`, time, unread, createdAt, 'workspace' AS notificationType, NULL AS relatedEntityId
       FROM Notifications WHERE workspaceId = ? ORDER BY createdAt DESC LIMIT 100`, [auth.workspaceId]);
    const [personalRows]: any = await pool.execute(
      `SELECT id, title, description AS \`desc\`, DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s') AS time,
              (readAt IS NULL) AS unread, createdAt, notificationType, relatedEntityId
       FROM WorkspaceUserNotifications WHERE workspaceId = ? AND userId = ? ORDER BY createdAt DESC LIMIT 100`,
      [auth.workspaceId, auth.userId]);
    res.json([...broadcastRows, ...personalRows].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 100)
      .map((n: any) => ({ ...n, unread: Boolean(n.unread) })));
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Database query failed' });
  }
});

app.patch('/api/notifications/:id/read', requireWorkspacePermission('notifications.update_own'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [result]: any = await pool.execute(
      `UPDATE WorkspaceUserNotifications SET readAt = UTC_TIMESTAMP()
       WHERE id = ? AND workspaceId = ? AND userId = ? AND readAt IS NULL`,
      [req.params.id, auth.workspaceId, auth.userId],
    );
    if (result.affectedRows === 0) {
      const [rows]: any = await pool.execute('SELECT id FROM WorkspaceUserNotifications WHERE id = ? AND workspaceId = ? AND userId = ? LIMIT 1', [req.params.id, auth.workspaceId, auth.userId]);
      if (!rows.length) return res.status(404).json({ error: 'Notification not found.' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Notification read update failed:', error);
    res.status(500).json({ error: 'Could not update notification.' });
  }
});

// Save remarks and update interview scores
app.post('/api/students/:id/remarks', requireWorkspacePermission('interview.evaluate_assigned', 'interview.evaluate_workspace'), async (req, res) => {
  try {
    const auth = (req as AuthenticatedRequest).auth!;
    const { id } = req.params;
    const { remark, score, type, ratings, recommendation } = req.body;

    const [students]: any = await pool.execute(
      `SELECT sp.recentRemarksJson, sp.coding, sp.aptitude, sp.reasoning, sp.sqlScore,
              sp.csFundamentals, sp.communication, sp.techInterview, sp.hrInterview
       FROM WorkspaceStudentProfiles sp
       JOIN WorkspaceMemberships wm ON wm.userId = sp.userId AND wm.workspaceId = sp.workspaceId AND wm.status = 'active'
       WHERE sp.workspaceId = ? AND sp.userId = ? AND wm.role = 'student'
         AND (? = 'college_admin' OR EXISTS (
           SELECT 1 FROM WorkspaceBatchAssignments ba
           WHERE ba.workspaceId = wm.workspaceId AND ba.batchId = sp.batchId AND ba.trainerUserId = ?
         ))`,
      [auth.workspaceId, id, auth.role, auth.userId],
    );
    if (students.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const student = students[0];
    if (!['tech', 'hr'].includes(type) || typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100 || !remark || typeof remark !== 'object' || remark.type !== type || typeof remark.comment !== 'string' || remark.comment.length > 5000 || !ratings || typeof ratings !== 'object' || Array.isArray(ratings) || Object.keys(ratings).length < 1 || Object.keys(ratings).length > 20) {
      return res.status(400).json({ error: 'A valid interview type, score, and remark are required.' });
    }
    for (const value of Object.values(ratings) as any[]) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10) return res.status(400).json({ error: 'Interview rubric scores must be between 0 and 10.' });
    }
    const computedScore = Math.round(Object.values(ratings as Record<string, number>).reduce((sum, value) => sum + value, 0) / Object.keys(ratings).length * 10);
    const recentRemarks = JSON.parse(student.recentRemarksJson || '[]');
    recentRemarks.unshift({ ...remark, score: computedScore, type });
    const scoreCol = type === 'tech' ? 'techInterview' : 'hrInterview';
    const coding = student.coding;
    const aptitude = student.aptitude;
    const reasoning = student.reasoning;
    const sqlScore = student.sqlScore;
    const csFundamentals = student.csFundamentals;
    const communication = student.communication;
    
    const techInterview = type === 'tech' ? computedScore : student.techInterview;
    const hrInterview = type === 'hr' ? computedScore : student.hrInterview;

    const overallReadiness = explainReadiness({ coding, aptitude, reasoning, sql: sqlScore, csFundamentals,
      communication, techInterview, hrInterview }).score;

    await pool.query(
      `UPDATE WorkspaceStudentProfiles
       SET recentRemarksJson = ?, ${scoreCol} = ?, overallReadiness = ?, placementReadinessScore = ?
       WHERE workspaceId = ? AND userId = ?`,
      [JSON.stringify(recentRemarks), computedScore, overallReadiness, overallReadiness, auth.workspaceId, id]
    );

    const normalizedRecommendation = recommendation === 'hire'
      ? 'Hire'
      : recommendation === 'remedial'
      ? 'Need Improvement'
      : 'Borderline';
    await pool.execute(
      `INSERT INTO InterviewRecords (id, workspaceId, studentId, type, date, panel, status, ratingsJson, remarks, recommendation, score, createdByUserId)
       VALUES (?, ?, ?, ?, ?, ?, 'Completed', ?, ?, ?, ?, ?)`,
      [randomUUID(), auth.workspaceId, id, type, String(remark.date || new Date().toISOString().slice(0, 10)), auth.name, JSON.stringify(ratings), remark.comment, normalizedRecommendation, computedScore, auth.userId],
    );
    await pool.execute(
      'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, targetUserId, detailsJson) VALUES (?, ?, ?, ?, ?, ?)',
      [randomUUID(), auth.workspaceId, auth.userId, 'interview.evaluation_saved', id, JSON.stringify({ type, score: computedScore })],
    );

    res.json({ success: true, interviewScore: computedScore, updatedReadiness: overallReadiness });
  } catch (error) {
    console.error('Error updating remarks:', error);
    res.status(500).json({ error: 'Database update failed' });
  }
});

app.get('/api/students/:id/interviews', requireWorkspacePermission('interview.read_own', 'interview.history.read_assigned', 'interview.read_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const studentId = req.params.id;
  try {
    const [membership]: any = await pool.execute(
      `SELECT wm.role, sp.batchId FROM WorkspaceMemberships wm
       LEFT JOIN WorkspaceStudentProfiles sp ON sp.workspaceId = wm.workspaceId AND sp.userId = wm.userId
       WHERE wm.workspaceId = ? AND wm.userId = ? AND wm.status = 'active' LIMIT 1`,
      [auth.workspaceId, studentId],
    );
    if (!membership.length || membership[0].role !== 'student') return res.status(404).json({ error: 'Student not found in this workspace.' });
    if (auth.role === 'student' && auth.userId !== studentId) return res.status(403).json({ error: 'You can only view your own interview history.' });
    if (auth.role === 'trainer') {
      const [assignments]: any = await pool.execute(
        'SELECT 1 FROM WorkspaceBatchAssignments WHERE workspaceId = ? AND batchId = ? AND trainerUserId = ? LIMIT 1',
        [auth.workspaceId, membership[0].batchId, auth.userId],
      );
      if (!assignments.length) return res.status(403).json({ error: 'You are not assigned to this student’s batch.' });
    }
    const [records]: any = await pool.execute(
      'SELECT id, studentId, type, date, panel, status, ratingsJson, remarks, recommendation, score FROM InterviewRecords WHERE workspaceId = ? AND studentId = ? ORDER BY date DESC, id DESC',
      [auth.workspaceId, studentId],
    );
    res.json(records.map((record: any) => ({ ...record, ratings: JSON.parse(record.ratingsJson || '{}') })));
  } catch (error) {
    console.error('Interview history query failed:', error);
    res.status(500).json({ error: 'Could not load interview history.' });
  }
});

app.get('/api/analytics/dashboard', requireWorkspacePermission('analytics.read_assigned', 'analytics.read_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const studentId = auth.role === 'student' ? auth.userId : String(req.query.studentId || '');
  if (!await canAccessStudent(auth, studentId)) return res.status(404).json({ error: 'Student not found in your authorized scope.' });
  try {
    const [profileRows]: any = await pool.execute(
      `SELECT sp.* , u.name AS studentName
       FROM WorkspaceStudentProfiles sp
       JOIN Users u ON u.id = sp.userId
       JOIN WorkspaceMemberships wm ON wm.workspaceId = sp.workspaceId AND wm.userId = sp.userId
       WHERE sp.workspaceId = ? AND sp.userId = ? AND wm.role = 'student' AND wm.status = 'active' LIMIT 1`,
      [auth.workspaceId, studentId],
    );
    if (!profileRows.length) return res.status(404).json({ error: 'Student profile is not available in this workspace.' });
    const profile = profileRows[0];

    const [attemptRows]: any = await pool.execute(
      `SELECT s.assessmentId, s.percentage, s.codingResultsJson, s.submittedAt, a.coverageJson
       FROM Submissions s
       JOIN Assessments a ON a.id = s.assessmentId AND a.workspaceId = s.workspaceId
       WHERE s.workspaceId = ? AND s.studentId = ?
       ORDER BY s.submittedAt DESC, s.id DESC LIMIT 40`,
      [auth.workspaceId, studentId],
    );
    const attempts = attemptRows.reverse();
    const assessmentIds = [...new Set(attempts.map((row: any) => String(row.assessmentId)))];
    const benchmarkByAssessment = new Map<string, number>();
    if (profile.batchId && assessmentIds.length) {
      const placeholders = assessmentIds.map(() => '?').join(',');
      const [benchmarkRows]: any = await pool.execute(
        `SELECT s.assessmentId, AVG(s.percentage) AS averageScore
         FROM Submissions s
         JOIN WorkspaceStudentProfiles peer ON peer.workspaceId = s.workspaceId AND peer.userId = s.studentId
         JOIN WorkspaceMemberships wm ON wm.workspaceId = peer.workspaceId AND wm.userId = peer.userId AND wm.role = 'student' AND wm.status = 'active'
         WHERE s.workspaceId = ? AND peer.batchId = ? AND s.assessmentId IN (${placeholders})
         GROUP BY s.assessmentId`,
        [auth.workspaceId, profile.batchId, ...assessmentIds],
      );
      for (const row of benchmarkRows) benchmarkByAssessment.set(String(row.assessmentId), Number(row.averageScore) || 0);
    }
    const trend = attempts.map((row: any, index: number) => {
      const codingValues = Object.values(parseStoredJson<Record<string, any>>(row.codingResultsJson, {}))
        .map((value: any) => Number(typeof value === 'object' && value !== null ? value.score : value))
        .filter((value) => Number.isFinite(value));
      const batchAverage = benchmarkByAssessment.get(String(row.assessmentId));
      return {
        day: `Attempt ${index + 1}`,
        studentScore: Number(row.percentage) || 0,
        codingScore: codingValues.length ? Math.round(codingValues.reduce((sum, value) => sum + value, 0) / codingValues.length) : null,
        benchmark: batchAverage === undefined ? Number(row.percentage) || 0 : batchAverage,
      };
    });

    const topicScores = new Map<string, number[]>();
    for (const row of attempts) {
      const topics = parseStoredJson<unknown[]>(row.coverageJson, []);
      for (const topic of topics) {
        if (typeof topic !== 'string' || !topic.trim()) continue;
        const key = topic.trim();
        topicScores.set(key, [...(topicScores.get(key) || []), Number(row.percentage) || 0]);
      }
    }
    const topics = [...topicScores.entries()].map(([topic, scores]) => ({
      topic,
      score: Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length),
      target: ASSESSMENT_PASS_PERCENT,
    })).sort((a, b) => a.topic.localeCompare(b.topic)).slice(0, 12);

    const [settingsRows]: any = await pool.execute('SELECT settingsJson FROM WorkspaceSettings WHERE workspaceId = ? LIMIT 1', [auth.workspaceId]);
    const settings = settingsRows[0] ? parseStoredJson<any>(settingsRows[0].settingsJson, {}) : {};
    const atRiskBelow = Number.isInteger(settings.atRiskBelow) ? settings.atRiskBelow : 65;
    const tierOneAtOrAbove = Number.isInteger(settings.tierOneAtOrAbove) ? settings.tierOneAtOrAbove : 80;
    const [distributionRows]: any = profile.batchId
      ? await pool.execute(
        `SELECT COUNT(*) AS total,
           SUM(sp.placementReadinessScore >= ?) AS tierOne,
           SUM(sp.placementReadinessScore >= ? AND sp.placementReadinessScore < ?) AS tierTwo,
           SUM(sp.placementReadinessScore < ?) AS atRisk
         FROM WorkspaceStudentProfiles sp
         JOIN WorkspaceMemberships wm ON wm.workspaceId = sp.workspaceId AND wm.userId = sp.userId AND wm.role = 'student' AND wm.status = 'active'
         WHERE sp.workspaceId = ? AND sp.batchId = ?`,
        [tierOneAtOrAbove, atRiskBelow, tierOneAtOrAbove, atRiskBelow, auth.workspaceId, profile.batchId],
      )
      : await pool.execute(
        `SELECT COUNT(*) AS total,
           SUM(sp.placementReadinessScore >= ?) AS tierOne,
           SUM(sp.placementReadinessScore >= ? AND sp.placementReadinessScore < ?) AS tierTwo,
           SUM(sp.placementReadinessScore < ?) AS atRisk
         FROM WorkspaceStudentProfiles sp
         JOIN WorkspaceMemberships wm ON wm.workspaceId = sp.workspaceId AND wm.userId = sp.userId AND wm.role = 'student' AND wm.status = 'active'
         WHERE sp.workspaceId = ? AND sp.userId = ?`,
        [tierOneAtOrAbove, atRiskBelow, tierOneAtOrAbove, atRiskBelow, auth.workspaceId, studentId],
      );
    const distribution = [
      { name: `Tier 1 Ready (≥${tierOneAtOrAbove}%)`, value: Number(distributionRows[0]?.tierOne) || 0, color: '#10B981' },
      { name: `Tier 2 Ready (${atRiskBelow}–${tierOneAtOrAbove - 1}%)`, value: Number(distributionRows[0]?.tierTwo) || 0, color: '#3B82F6' },
      { name: `At Risk (<${atRiskBelow}%)`, value: Number(distributionRows[0]?.atRisk) || 0, color: '#F43F5E' },
    ];
    res.json({
      studentName: profile.studentName,
      readinessScore: Number(profile.placementReadinessScore) || 0,
      metrics: {
        coding: Number(profile.coding) || 0,
        aptitude: Number(profile.aptitude) || 0,
        reasoning: Number(profile.reasoning) || 0,
        sql: Number(profile.sqlScore) || 0,
        csFundamentals: Number(profile.csFundamentals) || 0,
        communication: Number(profile.communication) || 0,
        techInterview: Number(profile.techInterview) || 0,
        hrInterview: Number(profile.hrInterview) || 0,
      },
      trend,
      topics,
      distribution,
      batchStudentCount: Number(distributionRows[0]?.total) || 0,
    });
  } catch (error) {
    console.error('Analytics dashboard query failed:', error);
    res.status(500).json({ error: 'Could not load workspace analytics.' });
  }
});

// AI: Personalized Recommendations
app.post('/api/ai/recommendations', requireWorkspacePermission('ai.recommendation.own', 'ai.recommendation.assigned', 'ai.recommendation.workspace'), async (req, res) => {
  try {
    const auth = (req as AuthenticatedRequest).auth!;
    const { studentId } = req.body || {};
    if (!await canAccessStudent(auth, studentId)) return res.status(404).json({ error: 'Student not found in your authorized scope.' });
    const [[profile]]: any = await pool.execute(
      `SELECT coding, aptitude, reasoning, sqlScore, csFundamentals, communication, techInterview, hrInterview, weakAreasJson
       FROM WorkspaceStudentProfiles WHERE workspaceId = ? AND userId = ? LIMIT 1`, [auth.workspaceId, studentId],
    );
    if (!profile) return res.status(404).json({ error: 'Student profile not found.' });
    let weakAreas: string[] = [];
    try { weakAreas = JSON.parse(profile.weakAreasJson || '[]').filter((topic: any) => typeof topic === 'string').slice(0, 8); } catch { weakAreas = []; }
    const targetCompanies = Array.isArray(req.body?.targetCompanies)
      ? req.body.targetCompanies.filter((company: any) => typeof company === 'string').slice(0, 6) : [];
    const scores = { coding: Number(profile.coding), aptitude: Number(profile.aptitude), reasoning: Number(profile.reasoning),
      sql: Number(profile.sqlScore), csFundamentals: Number(profile.csFundamentals), communication: Number(profile.communication),
      techInterview: Number(profile.techInterview), hrInterview: Number(profile.hrInterview) };
    const ai = getGeminiClient();

    if (ai) {
      const prompt = `Create a training recommendation from these competency indicators. Do not infer selection odds or make hiring decisions.
Scores: Coding: ${scores.coding}%, Aptitude: ${scores.aptitude}%, Reasoning: ${scores.reasoning}%, SQL: ${scores.sql}%, CS fundamentals: ${scores.csFundamentals}%, Communication: ${scores.communication}%, Technical interview: ${scores.techInterview}%, HR interview: ${scores.hrInterview}%
Weak Areas: ${weakAreas.join(', ') || 'Not recorded'}
Target Companies: ${targetCompanies.join(', ') || 'Not specified'}

Provide a structured, encouraging 3-step practice plan. Do not include names or identify the person. Do not claim that any action guarantees employment. Keep it concise and specific.`;

      const generated = await generateWithWorkspaceAi(auth.workspaceId, () => ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: prompt,
      }));
      if (!generated.allowed) return res.status(429).json({ code: 'PLAN_LIMIT_REACHED', limitKey: 'ai_credits_per_period', error: generated.message });
      const response = generated.response;

      return res.json({
        recommendation: response.text,
        generatedByAI: true,
      });
    }

    // High quality rule-based fallback
    return res.json({
      recommendation: `### Personalized Placement Strategy
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
app.post('/api/ai/predict-readiness', requireWorkspacePermission('ai.readiness.own', 'ai.readiness.assigned', 'ai.readiness.workspace'), async (req, res) => {
  try {
    const auth = (req as AuthenticatedRequest).auth!;
    const { studentId, targetCompany } = req.body || {};
    if (!await canAccessStudent(auth, studentId)) return res.status(404).json({ error: 'Student not found in your authorized scope.' });
    if (targetCompany !== undefined && (typeof targetCompany !== 'string' || targetCompany.length > 120)) {
      return res.status(400).json({ error: 'Target company must be a short label.' });
    }
    const [[profile]]: any = await pool.execute(
      `SELECT coding, aptitude, reasoning, sqlScore, csFundamentals, communication, techInterview, hrInterview
       FROM WorkspaceStudentProfiles WHERE workspaceId = ? AND userId = ? LIMIT 1`, [auth.workspaceId, studentId],
    );
    if (!profile) return res.status(404).json({ error: 'Student profile not found.' });
    const explanation = explainReadiness({ coding: profile.coding, aptitude: profile.aptitude, reasoning: profile.reasoning,
      sql: profile.sqlScore, csFundamentals: profile.csFundamentals, communication: profile.communication,
      techInterview: profile.techInterview, hrInterview: profile.hrInterview });
    const [[settingsRow]]: any = await pool.execute('SELECT settingsJson FROM WorkspaceSettings WHERE workspaceId = ? LIMIT 1', [auth.workspaceId]);
    const settings = settingsRow ? parseStoredJson<any>(settingsRow.settingsJson, {}) : {};
    const atRiskBelow = Number.isInteger(settings.atRiskBelow) ? settings.atRiskBelow : 65;
    const tierOneAtOrAbove = Number.isInteger(settings.tierOneAtOrAbove) ? settings.tierOneAtOrAbove : 80;
    const score = explanation.score;
    const predictedTier = score >= tierOneAtOrAbove ? 'high' : score >= atRiskBelow ? 'moderate' : 'needs_attention';
    const strengths = explanation.factors.filter((factor) => factor.score !== null && factor.score >= 75).sort((a, b) => b.score! - a.score!).slice(0, 3).map((factor) => factor.label);
    const gaps = explanation.factors.filter((factor) => factor.score !== null && factor.score < 65).sort((a, b) => a.score! - b.score!).slice(0, 3).map((factor) => factor.label);
    const id = randomUUID();
    await pool.execute(
      `INSERT INTO ReadinessPredictionEvents
       (id, workspaceId, studentId, modelVersion, readinessScore, predictedTier, predictedReady, targetCompany, evidenceJson)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, auth.workspaceId, studentId, READINESS_MODEL_VERSION, score, predictedTier, score >= tierOneAtOrAbove ? 1 : 0,
        targetCompany || null, JSON.stringify({ factors: explanation.factors, availableWeight: explanation.availableWeight,
          atRiskBelow, tierOneAtOrAbove, interpretation: explanation.interpretation })],
    );
    res.json({ eventId: id, modelVersion: READINESS_MODEL_VERSION, readinessIndex: score, readinessTier: predictedTier,
      predictedReady: score >= tierOneAtOrAbove, targetCompany: targetCompany || null, topStrengths: strengths,
      criticalGaps: gaps, summary: `${explanation.interpretation} ${explanation.missingFactors.length
        ? `Missing data: ${explanation.missingFactors.join(', ')}.` : `Based on ${explanation.availableWeight}% of weighted indicators.`}`,
      generatedByAI: false, generatedBy: 'weighted_score' });
  } catch (error) {
    console.error('AI prediction error:', error);
    res.status(500).json({ error: 'Failed to predict readiness' });
  }
});

app.patch('/api/ai/predictions/:id/outcome', requireWorkspacePermission('students.update_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { outcome } = req.body || {};
  if (!['placed', 'not_placed'].includes(outcome)) return res.status(400).json({ error: 'Outcome must be placed or not placed.' });
  try {
    const [result]: any = await pool.execute(
      `UPDATE ReadinessPredictionEvents SET actualOutcome = ?, outcomeRecordedAt = CURRENT_TIMESTAMP, outcomeRecordedBy = ?
       WHERE id = ? AND workspaceId = ?`, [outcome, auth.userId, req.params.id, auth.workspaceId],
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Prediction event not found.' });
    await pool.execute(
      `INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, targetUserId, detailsJson)
       SELECT ?, workspaceId, ?, 'readiness.prediction_outcome_recorded', studentId, JSON_OBJECT('eventId', id, 'outcome', ?)
       FROM ReadinessPredictionEvents WHERE id = ? AND workspaceId = ?`,
      [randomUUID(), auth.userId, outcome, req.params.id, auth.workspaceId],
    );
    res.json({ success: true, outcome });
  } catch (error) {
    console.error('Readiness outcome update failed:', error);
    res.status(500).json({ error: 'Could not record the placement outcome.' });
  }
});

app.get('/api/ai/predictions/pending', requireWorkspacePermission('students.update_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [rows]: any = await pool.execute(
      `SELECT p.id AS eventId, p.studentId, u.name AS studentName, p.readinessScore, p.predictedTier,
              p.targetCompany, p.modelVersion, p.createdAt
       FROM ReadinessPredictionEvents p JOIN Users u ON u.id = p.studentId AND u.workspaceId = p.workspaceId
       WHERE p.workspaceId = ? AND p.actualOutcome IS NULL ORDER BY p.createdAt DESC LIMIT 100`, [auth.workspaceId],
    );
    res.json(rows);
  } catch (error) {
    console.error('Pending readiness outcomes query failed:', error);
    res.status(500).json({ error: 'Could not load pending placement outcome labels.' });
  }
});

app.get('/api/ai/prediction-evaluation', requireWorkspacePermission('report.read_workspace'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [rows]: any = await pool.execute(
      `SELECT predictedReady, actualOutcome FROM ReadinessPredictionEvents
       WHERE workspaceId = ? AND modelVersion = ? AND actualOutcome IS NOT NULL`, [auth.workspaceId, READINESS_MODEL_VERSION],
    );
    let truePositive = 0, falsePositive = 0, trueNegative = 0, falseNegative = 0;
    for (const row of rows) {
      const predicted = Boolean(row.predictedReady);
      const placed = row.actualOutcome === 'placed';
      if (predicted && placed) truePositive += 1;
      else if (predicted) falsePositive += 1;
      else if (placed) falseNegative += 1;
      else trueNegative += 1;
    }
    const precision = truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : null;
    const recall = truePositive + falseNegative ? truePositive / (truePositive + falseNegative) : null;
    res.json({ modelVersion: READINESS_MODEL_VERSION, labeledExamples: rows.length,
      thresholdDefinition: 'Predicted ready means readiness score at or above the workspace Tier 1 threshold saved at prediction time.',
      confusion: { truePositive, falsePositive, trueNegative, falseNegative }, precision, recall,
      validationStatus: rows.length < 30 ? 'insufficient_data' : 'descriptive_only',
      note: 'These observed rates are not calibrated probabilities and should not be used for employment decisions.' });
  } catch (error) {
    console.error('Readiness prediction evaluation failed:', error);
    res.status(500).json({ error: 'Could not load readiness evaluation metrics.' });
  }
});

// AI: Trainer Intervention Summary
app.post('/api/ai/trainer-summary', requireWorkspacePermission('ai.trainer_summary', 'ai.trainer_summary.workspace'), async (req, res) => {
  try {
    const auth = (req as AuthenticatedRequest).auth!;
    const { batchId } = req.body || {};
    if (typeof batchId !== 'string' || !batchId) return res.status(400).json({ error: 'Choose a batch in your authorized scope.' });
    const [batchRows]: any = await pool.execute(
      `SELECT 1 FROM Batches b WHERE b.id = ? AND b.workspaceId = ? AND b.isArchived = 0
       AND (? = 'college_admin' OR EXISTS (
         SELECT 1 FROM WorkspaceBatchAssignments ba
         WHERE ba.workspaceId = b.workspaceId AND ba.batchId = b.id AND ba.trainerUserId = ?
       )) LIMIT 1`,
      [batchId, auth.workspaceId, auth.role, auth.userId],
    );
    if (!batchRows.length) return res.status(404).json({ error: 'Batch not found in your authorized scope.' });
    const [workspaceSettingRows]: any = await pool.execute('SELECT settingsJson FROM WorkspaceSettings WHERE workspaceId = ? LIMIT 1', [auth.workspaceId]);
    const workspaceSettings = workspaceSettingRows[0] ? parseStoredJson<any>(workspaceSettingRows[0].settingsJson, {}) : {};
    const atRiskThreshold = Number.isInteger(workspaceSettings.atRiskBelow) ? workspaceSettings.atRiskBelow : 65;
    const [[metrics]]: any = await pool.execute(
      `SELECT COUNT(*) AS studentsCount, AVG(sp.placementReadinessScore) AS averageScore,
         SUM(sp.placementReadinessScore < ?) AS atRiskCount, AVG(sp.coding) AS coding,
         AVG(sp.aptitude) AS aptitude, AVG(sp.reasoning) AS reasoning, AVG(sp.sqlScore) AS sqlScore,
         AVG(sp.csFundamentals) AS csFundamentals, AVG(sp.communication) AS communication
       FROM WorkspaceStudentProfiles sp JOIN WorkspaceMemberships wm ON wm.workspaceId = sp.workspaceId AND wm.userId = sp.userId
       WHERE sp.workspaceId = ? AND sp.batchId = ? AND wm.role = 'student' AND wm.status = 'active'`,
      [atRiskThreshold, auth.workspaceId, batchId],
    );
    const topicMetrics = [
      ['Coding & DSA', metrics.coding], ['Aptitude', metrics.aptitude], ['Reasoning', metrics.reasoning],
      ['SQL & database', metrics.sqlScore], ['CS fundamentals', metrics.csFundamentals], ['Communication', metrics.communication],
    ].filter(([, value]) => value !== null && value !== undefined).sort((a: any, b: any) => Number(a[1]) - Number(b[1]));
    const atRiskCount = Number(metrics.atRiskCount || 0);
    const averageScore = Math.round(Number(metrics.averageScore) || 0);
    const lowScoringTopics = topicMetrics.slice(0, 3).map(([topic]) => topic);
    if (Number(metrics.studentsCount || 0) < 5) {
      return res.json({
        summary: 'Use a general 30-minute daily doubt-clearing session and provide the standard practice worksheet set. Aggregate AI suggestions are withheld for groups smaller than five to reduce re-identification risk.',
        generatedByAI: false,
      });
    }
    const ai = getGeminiClient();

    if (ai) {
      const prompt = `Create an intervention briefing from these anonymous aggregate training metrics. Do not identify or infer facts about individual students.
Metrics:
- Active students: ${Number(metrics.studentsCount || 0)}
- Students below the readiness threshold: ${atRiskCount}
- Average readiness: ${averageScore}%
- Lowest skill indicators: ${lowScoringTopics.join(', ') || 'Not enough scored indicators'}

Provide three trainer actions for this week, including a 30-minute daily doubt-clearing structure and worksheet topics. Present the figures as descriptive cohort aggregates, not a causal conclusion.`;

      const generated = await generateWithWorkspaceAi(auth.workspaceId, () => ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: prompt,
      }));
      if (!generated.allowed) return res.status(429).json({ code: 'PLAN_LIMIT_REACHED', limitKey: 'ai_credits_per_period', error: generated.message });
      const response = generated.response;

      return res.json({ summary: response.text, generatedByAI: true });
    }

    return res.json({
      summary: `### Trainer Intervention Directive
1. **Daily 30-Min Micro-Workshops**: Schedule focused practice on ${lowScoringTopics.slice(0, 2).join(' & ') || 'the lowest-scoring skill areas'}.
2. **Small-Group Support**: Offer voluntary review groups for the ${atRiskCount} students below the current threshold; avoid treating the score as a placement decision.
3. **Targeted Practice**: Assign short practice worksheets for the identified low-scoring indicators and review progress next week.`,
      generatedByAI: false,
    });
  } catch (error) {
    console.error('Trainer summary error:', error);
    res.status(500).json({ error: 'Failed to generate trainer summary' });
  }
});

// Execute untrusted source only through the separately hosted Judge0 sandbox.
app.post('/api/code/run', requireWorkspacePermission('code.execute'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { code, language, assessmentId, questionIndex, problemId, input } = req.body || {};
  if (typeof code !== 'string' || code.length < 1 || code.length > 100000
    || typeof language !== 'string' || language.length > 32
    || (input !== undefined && (typeof input !== 'string' || input.length > 20000))) {
    return res.status(400).json({ error: 'Provide valid source code, language, and input.' });
  }
  try {
    let question: any;
    if (typeof assessmentId === 'string' && Number.isInteger(questionIndex)) {
      const [[assessment]]: any = await pool.execute(
        `SELECT id, batchId, sectionsJson, status, availableAt, dueAt, allowLateSubmission
         FROM Assessments WHERE workspaceId = ? AND id = ?`, [auth.workspaceId, assessmentId],
      );
      if (!assessment) return res.status(404).json({ error: 'Assessment not found.' });
      if (auth.role === 'student') {
        if (assessment.status !== 'live' || (assessment.availableAt && Date.now() < new Date(assessment.availableAt).getTime())
          || (assessment.dueAt && Date.now() > new Date(assessment.dueAt).getTime() && !Number(assessment.allowLateSubmission))) {
          return res.status(403).json({ error: 'This assessment is not currently available.' });
        }
        const [memberships]: any = await pool.execute(
          `SELECT 1 FROM Users u LEFT JOIN Batches b ON b.workspaceId = u.workspaceId AND b.id = ?
           WHERE u.id = ? AND u.workspaceId = ? AND u.role = 'student' AND u.status = 'active'
             AND ((? IS NULL AND u.batchId IS NOT NULL) OR (? IS NOT NULL AND u.batchId = b.id)) LIMIT 1`,
          [assessment.batchId, auth.userId, auth.workspaceId, assessment.batchId, assessment.batchId],
        );
        if (!memberships.length) return res.status(403).json({ error: 'You are not assigned to this assessment.' });
      }
      const questions = JSON.parse(assessment.sectionsJson || '[]').flatMap((section: any) => section.questions || []);
      question = questions[questionIndex];
      if (question?.type !== 'coding') return res.status(400).json({ error: 'Selected question is not a coding question.' });
    } else {
      question = Object.values(SAMPLE_CODING_PROBLEMS).find((item: any) => item.id === problemId)
        || (typeof problemId === 'string' ? SAMPLE_CODING_PROBLEMS[problemId] : null);
      if (!question) return res.status(400).json({ error: 'A valid coding problem is required.' });
      question = { data: question };
    }
    const testCases = input !== undefined
      ? [{ input, expected: undefined }]
      : question.data.testCases;
    if (!Array.isArray(testCases) || !testCases.length) return res.status(400).json({ error: 'This coding question has no test cases configured.' });
    const safeCases = input !== undefined ? testCases : testCases.filter((testCase: any) => !testCase.hidden);
    const execution = await executeOnJudge0(code, language, safeCases, question.data);
    if (input !== undefined && execution.results[0]) execution.results[0].passed = true;
    return res.json(execution);
  } catch (error) {
    console.error('Judge0 execution error:', error);
    return res.status(503).json({ error: error instanceof Error ? error.message : 'Code execution service is unavailable.' });
  }
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

  app.listen(PORT, HOST, () => {
    console.log(`[Campus Placement Portal] Server running on http://${HOST}:${PORT}`);
  });
}

startServer();
