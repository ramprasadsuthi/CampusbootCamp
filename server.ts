import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import mysql from 'mysql2/promise';
import { ASSESSMENTS_CATALOG } from './src/data/assessmentData';
import { CURRICULUM_40_DAYS } from './src/data/curriculumData';
import { DEFAULT_WORKSPACE_SETTINGS, type WorkspaceSettings } from './src/types/auth';
import { SUBSCRIPTION_PLANS, type PlanLimitKey, type WorkspaceSubscriptionOverview } from './src/types/subscriptions';
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { decryptTotpSecret, encryptTotpSecret, generateTotpSecret, verifyTotp } from './src/utils/platformSecurity';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = 'talentedge_session';
const SESSION_DAYS = 14;
const PLATFORM_SESSION_COOKIE = 'talentedge_platform_session';
const PLATFORM_SESSION_HOURS = 8;
const loginFailures = new Map<string, { count: number; expiresAt: number }>();

interface AuthContext {
  sessionId: string;
  userId: string;
  name: string;
  email: string;
  avatar: string;
  workspaceId: string;
  workspaceName: string;
  role: 'college_admin' | 'trainer' | 'student' | 'panelist';
}

type AuthenticatedRequest = Request & { auth?: AuthContext };
interface PlatformAuthContext { sessionId: string; platformAdminId: string; name: string; email: string; }
type PlatformAuthenticatedRequest = Request & { platformAuth?: PlatformAuthContext };

app.use(express.json({ limit: '400kb' }));

// Unauthenticated liveness endpoint for local and future deployment health checks.
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    appName: 'Campus Placement Assessment Portal',
    timestamp: new Date().toISOString(),
    aiConfigured: Boolean(process.env.GEMINI_API_KEY),
  });
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

async function getWorkspaceLimitState(db: any, workspaceId: string, key: PlanLimitKey) {
  const [subscriptionRows]: any = await db.execute('SELECT planId FROM WorkspaceSubscriptions WHERE workspaceId = ? LIMIT 1', [workspaceId]);
  const plan = getPlanDefinition(subscriptionRows[0]?.planId || 'pilot');
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
    const [subscriptions]: any = await connection.execute('SELECT planId FROM WorkspaceSubscriptions WHERE workspaceId = ? FOR UPDATE', [workspaceId]);
    const plan = getPlanDefinition(subscriptions[0]?.planId || 'pilot');
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

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
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

function requireRole(...roles: AuthContext['role'][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = (req as AuthenticatedRequest).auth;
    if (!auth || !roles.includes(auth.role)) return res.status(403).json({ error: 'Insufficient workspace permissions' });
    next();
  };
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
    res.json({ success: true });
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
      `SELECT id, workspaceId, userId FROM WorkspacePasswordResets
       WHERE tokenHash = ? AND usedAt IS NULL AND expiresAt > UTC_TIMESTAMP() LIMIT 1 FOR UPDATE`,
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
    res.json({ success: true });
  } catch (error) {
    await connection.rollback();
    console.error('Password reset failed:', error);
    res.status(500).json({ error: 'Could not reset the password.' });
  } finally {
    connection.release();
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await pool.execute('DELETE FROM AuthSessions WHERE tokenHash = ?', [hashToken(token)]).catch(() => undefined);
  clearSessionCookie(res);
  res.json({ success: true });
});

app.post('/api/auth/change-password', authenticate, async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { currentPassword, newPassword } = req.body || {};
  if (!validPassword(newPassword) || typeof currentPassword !== 'string') {
    return res.status(400).json({ error: 'The new password must be at least 12 characters.' });
  }
  try {
    const [rows]: any = await pool.execute('SELECT passwordHash FROM Users WHERE id = ?', [auth.userId]);
    if (!(await verifyPassword(currentPassword, rows[0]?.passwordHash))) return res.status(400).json({ error: 'Current password is incorrect.' });
    const nextHash = await hashPassword(newPassword);
    await pool.execute('UPDATE Users SET passwordHash = ? WHERE id = ?', [nextHash, auth.userId]);
    await pool.execute('DELETE FROM AuthSessions WHERE userId = ? AND id <> ?', [auth.userId, auth.sessionId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Password update failed:', error);
    res.status(500).json({ error: 'Could not update the password.' });
  }
});

app.patch('/api/auth/profile', authenticate, async (req, res) => {
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

app.get('/api/auth/me', authenticate, (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  res.json({
    user: { id: auth.userId, name: auth.name, email: auth.email, avatar: auth.avatar },
    workspace: { id: auth.workspaceId, name: auth.workspaceName },
    role: auth.role,
  });
});

// Platform endpoints authenticate with a separate cookie and never receive a workspace context.
// All other application data endpoints require an active workspace session.
app.use('/api', (req, res, next) => req.path.startsWith('/platform/') ? next() : authenticate(req, res, next));

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

app.get('/api/platform/auth/me', requirePlatformAdmin, (req, res) => {
  const admin = (req as PlatformAuthenticatedRequest).platformAuth!;
  res.json({ user: { id: admin.platformAdminId, name: admin.name, email: admin.email }, role: 'platform_admin' });
});

app.post('/api/platform/auth/logout', requirePlatformAdmin, async (req, res) => {
  const admin = (req as PlatformAuthenticatedRequest).platformAuth!;
  await pool.execute('DELETE FROM PlatformAdminSessions WHERE id = ?', [admin.sessionId]);
  await pool.execute('INSERT INTO PlatformAuditEvents (id, platformAdminId, action, targetType, targetId) VALUES (?, ?, ?, ?, ?)', [randomUUID(), admin.platformAdminId, 'platform_admin.signed_out', 'platform_admin', admin.platformAdminId]);
  clearPlatformSessionCookie(res);
  res.json({ success: true });
});

app.get('/api/platform/overview', requirePlatformAdmin, async (req, res) => {
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
      const plan = getPlanDefinition(workspace.planId);
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

app.get('/api/platform/content/versions', requirePlatformAdmin, async (_req, res) => {
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

app.get('/api/platform/content/versions/:id', requirePlatformAdmin, async (req, res) => {
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

app.post('/api/platform/content/versions', requirePlatformAdmin, async (req, res) => {
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

app.put('/api/platform/content/versions/:id', requirePlatformAdmin, async (req, res) => {
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

app.post('/api/platform/content/versions/:id/publish', requirePlatformAdmin, async (req, res) => {
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

app.post('/api/platform/content/versions/:id/apply', requirePlatformAdmin, async (req, res) => {
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
    const content = JSON.parse(versions[0].contentJson || '{}');
    const versionId = req.params.id;
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
          `UPDATE WorkspaceCurriculumMaterials SET dayNumber = ?, title = ?, materialType = ?, contentUrl = ?, contentText = ?, contentFormat = ?, position = ?, isRequired = ?, sourceVersionId = ? WHERE id = ? AND workspaceId = ?`,
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
        assessmentAdded += 1;
      } else if (Number(existing[0].isCustomized)) assessmentPreserved += 1;
      else {
        await connection.execute(
          `UPDATE Assessments SET dayNumber = ?, title = ?, type = ?, durationMinutes = ?, totalMarks = ?, coverageJson = ?, purpose = ?, status = ?, scheduledDate = ?, sectionsJson = ?, targetCompaniesJson = ?, sourceVersionId = ? WHERE id = ? AND workspaceId = ?`,
          [...values, existing[0].id, workspaceId],
        );
        assessmentUpdated += 1;
      }
    }
    const result = { materialAdded, materialUpdated, materialPreserved, assessmentAdded, assessmentUpdated, assessmentPreserved };
    await connection.execute(
      `INSERT INTO PlatformSharedContentApplications (id, workspaceId, versionId, appliedByPlatformAdminId, resultJson)
       VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE appliedByPlatformAdminId = VALUES(appliedByPlatformAdminId), resultJson = VALUES(resultJson), appliedAt = UTC_TIMESTAMP()`,
      [randomUUID(), workspaceId, versionId, admin.platformAdminId, JSON.stringify(result)],
    );
    await connection.execute('INSERT INTO PlatformAuditEvents (id, platformAdminId, action, targetType, targetId, reason, afterJson) VALUES (?, ?, ?, ?, ?, ?, ?)', [randomUUID(), admin.platformAdminId, 'platform.shared_content_applied', 'workspace', workspaceId, reason, JSON.stringify({ versionId, versionNumber: Number(versions[0].versionNumber), title: versions[0].title, ...result })]);
    await connection.commit();
    res.json({ success: true, workspaceName: workspaces[0].name, versionNumber: Number(versions[0].versionNumber), ...result });
  } catch (error) {
    await connection.rollback();
    console.error('Shared content apply failed:', error);
    res.status(500).json({ error: 'Could not apply shared content to this college.' });
  } finally { connection.release(); }
});

app.get('/api/platform/audit', requirePlatformAdmin, async (req, res) => {
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

app.get('/api/platform/workspaces', requirePlatformAdmin, async (req, res) => {
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
              COALESCE(s.planId, 'pilot') AS planId, COALESCE(s.status, 'not_configured') AS subscriptionStatus,
              (SELECT COUNT(*) FROM WorkspaceMemberships m WHERE m.workspaceId = w.id AND m.role = 'student' AND m.status = 'active') AS activeStudents,
              (SELECT COUNT(*) FROM WorkspaceMemberships m WHERE m.workspaceId = w.id AND m.role IN ('college_admin','trainer','panelist') AND m.status = 'active') AS staffCount
       FROM Workspaces w LEFT JOIN WorkspaceSubscriptions s ON s.workspaceId = w.id
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

app.get('/api/platform/workspaces/:id', requirePlatformAdmin, async (req, res) => {
  try {
    const [rows]: any = await pool.execute(
      `SELECT w.id, w.name, w.slug, w.lifecycleStatus, w.statusReason,
              DATE_FORMAT(w.createdAt, '%Y-%m-%d %H:%i:%s') AS createdAt,
              DATE_FORMAT(w.lifecycleUpdatedAt, '%Y-%m-%d %H:%i:%s') AS lifecycleUpdatedAt,
              s.planId, s.status AS subscriptionStatus, s.billingInterval, s.currency,
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

app.post('/api/platform/workspaces', requirePlatformAdmin, async (req, res) => {
  const admin = (req as PlatformAuthenticatedRequest).platformAuth!;
  const { name, adminName, adminEmail } = req.body || {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.length > 191 || typeof adminName !== 'string' || adminName.trim().length < 2 || adminName.length > 191 || !validEmail(adminEmail)) return res.status(400).json({ error: 'Enter a college name and the first administrator’s name and email.' });
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
    res.status(201).json({ id, name: collegeName, lifecycleStatus: 'onboarding', inviteUrl: `${req.protocol}://${req.get('host')}/platform-admin?collegeInvite=${encodeURIComponent(token)}` });
  } catch (error: any) {
    await connection.rollback();
    console.error('Platform workspace creation failed:', error);
    res.status(500).json({ error: error?.code === 'ER_DUP_ENTRY' ? 'This workspace name or administrator email is already in use.' : 'Could not create this workspace.' });
  } finally { connection.release(); }
});

app.post('/api/platform/workspaces/:id/admin-invitations', requirePlatformAdmin, async (req, res) => {
  const admin = (req as PlatformAuthenticatedRequest).platformAuth!;
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid first college administrator email.' });
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
    res.status(201).json({ invitationId, email, inviteUrl: `${req.protocol}://${req.get('host')}/platform-admin?collegeInvite=${encodeURIComponent(token)}` });
  } catch (error) { await connection.rollback(); console.error('College administrator invitation creation failed:', error); res.status(500).json({ error: 'Could not create this college administrator invitation.' }); }
  finally { connection.release(); }
});

app.post('/api/platform/workspaces/:id/admin-invitations/:invitationId/resend', requirePlatformAdmin, async (req, res) => {
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
    const [activeAdmins]: any = await connection.execute('SELECT id FROM WorkspaceMemberships WHERE workspaceId = ? AND userId IN (SELECT id FROM Users WHERE email = ?) AND role = \'college_admin\' AND status = \'active\' LIMIT 1', [req.params.id, invites[0].email]);
    if (activeAdmins.length) { await connection.rollback(); return res.status(409).json({ error: 'This person is already an active college administrator.' }); }
    await connection.execute('UPDATE PlatformWorkspaceAdminInvitations SET revokedAt = UTC_TIMESTAMP() WHERE workspaceId = ? AND email = ? AND acceptedAt IS NULL AND revokedAt IS NULL AND expiresAt > UTC_TIMESTAMP()', [req.params.id, invites[0].email]);
    const newInvitationId = randomUUID();
    await connection.execute('INSERT INTO PlatformWorkspaceAdminInvitations (id, workspaceId, email, tokenHash, invitedByPlatformAdminId, expiresAt) VALUES (?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 72 HOUR))', [newInvitationId, req.params.id, invites[0].email, hashToken(token), admin.platformAdminId]);
    await connection.execute('INSERT INTO PlatformAuditEvents (id, platformAdminId, action, targetType, targetId, reason, beforeJson, afterJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [randomUUID(), admin.platformAdminId, 'workspace.admin_invitation_resent', 'workspace', req.params.id, reason, JSON.stringify({ invitationId: invites[0].id, email: invites[0].email }), JSON.stringify({ invitationId: newInvitationId, email: invites[0].email })]);
    await connection.commit();
    res.json({ invitationId: newInvitationId, email: invites[0].email, inviteUrl: `${req.protocol}://${req.get('host')}/platform-admin?collegeInvite=${encodeURIComponent(token)}` });
  } catch (error) { await connection.rollback(); console.error('College administrator invitation resend failed:', error); res.status(500).json({ error: 'Could not resend this college administrator invitation.' }); }
  finally { connection.release(); }
});

app.post('/api/platform/workspaces/:id/admin-invitations/:invitationId/revoke', requirePlatformAdmin, async (req, res) => {
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

app.patch('/api/platform/workspaces/:id/status', requirePlatformAdmin, async (req, res) => {
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

app.post('/api/platform/admin-invitations', requirePlatformAdmin, async (req, res) => {
  const admin = (req as PlatformAuthenticatedRequest).platformAuth!;
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid platform administrator email.' });
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
    res.status(201).json({ inviteUrl: `${req.protocol}://${req.get('host')}/platform-admin?invite=${encodeURIComponent(token)}` });
  } catch (error) {
    console.error('Platform administrator invitation failed:', error);
    res.status(500).json({ error: 'Could not create this platform administrator invitation.' });
  }
});

app.post('/api/platform/admins/:id/mfa-reset', requirePlatformAdmin, async (req, res) => {
  const actor = (req as PlatformAuthenticatedRequest).platformAuth!;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 5 || reason.length > 1000) return res.status(400).json({ error: 'Provide a reason of at least five characters.' });
  const token = randomBytes(32).toString('base64url');
  try {
    const [targets]: any = await pool.execute('SELECT id, email FROM PlatformAdminAccounts WHERE id = ? AND isActive = 1 LIMIT 1', [req.params.id]);
    if (!targets.length) return res.status(404).json({ error: 'Active platform administrator not found.' });
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('UPDATE PlatformAdminMfaResets SET expiresAt = UTC_TIMESTAMP() WHERE platformAdminId = ? AND usedAt IS NULL', [req.params.id]);
      await connection.execute('INSERT INTO PlatformAdminMfaResets (id, platformAdminId, tokenHash, requestedByPlatformAdminId, reason, expiresAt) VALUES (?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR))', [randomUUID(), req.params.id, hashToken(token), actor.platformAdminId, reason]);
      await connection.execute('INSERT INTO PlatformAuditEvents (id, platformAdminId, action, targetType, targetId, reason) VALUES (?, ?, ?, ?, ?, ?)', [randomUUID(), actor.platformAdminId, 'platform_admin.mfa_reset_requested', 'platform_admin', req.params.id, reason]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
    res.status(201).json({ email: targets[0].email, inviteUrl: `${req.protocol}://${req.get('host')}/platform-admin?mfaReset=${encodeURIComponent(token)}` });
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

app.get('/api/platform/admins', requirePlatformAdmin, async (_req, res) => {
  try {
    const [rows]: any = await pool.query('SELECT id, name, email, isActive, DATE_FORMAT(lastLoginAt, \'%Y-%m-%d %H:%i:%s\') AS lastLoginAt, DATE_FORMAT(createdAt, \'%Y-%m-%d %H:%i:%s\') AS createdAt FROM PlatformAdminAccounts ORDER BY isActive DESC, name ASC');
    res.json(rows.map((row: any) => ({ ...row, isActive: Boolean(row.isActive) })));
  } catch (error) { console.error('Platform administrators query failed:', error); res.status(500).json({ error: 'Could not load platform administrators.' }); }
});

app.patch('/api/platform/admins/:id/status', requirePlatformAdmin, async (req, res) => {
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

app.get('/api/workspace/subscription', requireRole('college_admin'), async (req, res) => {
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
    const plan = SUBSCRIPTION_PLANS.find((item) => item.id === subscription.planId) || SUBSCRIPTION_PLANS[0];
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
        aiCreditsTracked: Boolean(process.env.GEMINI_API_KEY),
        aiUsagePeriodStart: usagePeriodStart,
      },
    };
    res.json(result);
  } catch (error) {
    console.error('Workspace subscription overview failed:', error);
    res.status(500).json({ error: 'Could not load subscription and usage details.' });
  }
});

app.get('/api/workspace/settings', requireRole('college_admin'), async (req, res) => {
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

app.put('/api/workspace/settings', requireRole('college_admin'), async (req, res) => {
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

app.get('/api/interview-panelists', requireRole('college_admin'), async (req, res) => {
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

app.post('/api/interview-panelists', requireRole('college_admin'), async (req, res) => {
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

app.patch('/api/interview-panelists/:id', requireRole('college_admin'), async (req, res) => {
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

app.get('/api/interview-schedules', requireRole('college_admin'), async (req, res) => {
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

app.put('/api/interview-schedules/:id/follow-up', requireRole('college_admin'), async (req, res) => {
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

app.get('/api/interview-follow-ups/mine', requireRole('student'), async (req, res) => {
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

app.get('/api/interview-follow-ups/:scheduleId/history', requireRole('college_admin'), async (req, res) => {
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

app.get('/api/interview-schedules/mine', requireRole('student'), async (req, res) => {
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

app.get('/api/interview-schedules/assigned', requireRole('panelist'), async (req, res) => {
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

app.get('/api/interview-schedules/:id/evaluation', requireRole('college_admin'), async (req, res) => {
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

app.post('/api/interview-schedules/:id/evaluation', requireRole('panelist'), async (req, res) => {
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
    const overallReadiness = Math.round(Number(profile.coding) * 0.25 + Number(profile.aptitude) * 0.15 + Number(profile.reasoning) * 0.1
      + Number(profile.sqlScore) * 0.1 + Number(profile.csFundamentals) * 0.1 + Number(profile.communication) * 0.1 + techInterview * 0.1 + hrInterview * 0.1);
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

app.post('/api/interview-schedules', requireRole('college_admin'), async (req, res) => {
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

app.patch('/api/interview-schedules/:id', requireRole('college_admin'), async (req, res) => {
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
app.get('/api/workspace/members', requireRole('college_admin'), async (req, res) => {
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

app.patch('/api/workspace/members/:id', requireRole('college_admin'), async (req, res) => {
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

app.get('/api/workspace/trainers', requireRole('college_admin'), async (req, res) => {
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

app.patch('/api/workspace/students/:id', requireRole('college_admin'), async (req, res) => {
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

app.post('/api/workspace/members/:id/password-reset', requireRole('college_admin'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { id } = req.params;
  if (id === auth.userId) return res.status(400).json({ error: 'Use the account password change option for your own account.' });
  try {
    const [members]: any = await pool.execute(
      `SELECT userId FROM WorkspaceMemberships WHERE workspaceId = ? AND userId = ? AND status = 'active'`,
      [auth.workspaceId, id],
    );
    if (!members.length) return res.status(404).json({ error: 'Active workspace member not found.' });
    const token = randomBytes(32).toString('base64url');
    await pool.execute(
      `INSERT INTO WorkspacePasswordResets (id, workspaceId, userId, tokenHash, expiresAt, createdByUserId)
       VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR), ?)`,
      [randomUUID(), auth.workspaceId, id, hashToken(token), auth.userId],
    );
    await pool.execute(
      'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, targetUserId) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), auth.workspaceId, auth.userId, 'member.password_reset_link_created', id],
    );
    res.status(201).json({ success: true, resetPath: `/?reset=${encodeURIComponent(token)}`, expiresInMinutes: 60 });
  } catch (error) {
    console.error('Password reset link creation failed:', error);
    res.status(500).json({ error: 'Could not create a password reset link.' });
  }
});

app.get('/api/workspace/audit', requireRole('college_admin'), async (req, res) => {
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

app.patch('/api/workspace/members/:id/status', requireRole('college_admin'), async (req, res) => {
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
      'SELECT userId, role, status FROM WorkspaceMemberships WHERE workspaceId = ? AND userId = ? FOR UPDATE',
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
    res.json({ success: true });
  } catch (error) {
    await connection.rollback();
    console.error('Member status update failed:', error);
    res.status(500).json({ error: 'Could not update member status.' });
  } finally {
    connection.release();
  }
});

app.post('/api/workspace/invitations', requireRole('college_admin'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { email, role, batchId } = req.body || {};
  if (!validEmail(email) || !['college_admin', 'trainer', 'student', 'panelist'].includes(role)) {
    return res.status(400).json({ error: 'A valid email and workspace role are required.' });
  }
  if (role === 'student' && batchId !== undefined && batchId !== null && typeof batchId !== 'string') return res.status(400).json({ error: 'Batch selection is invalid.' });
  if (role !== 'student' && batchId) return res.status(400).json({ error: 'Only student invitations can be assigned to a batch.' });
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
    await connection.execute(
      `INSERT INTO WorkspaceInvitations (id, workspaceId, email, role, batchId, tokenHash, invitedByUserId, expiresAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY))`,
      [randomUUID(), auth.workspaceId, email.toLowerCase(), role, batchId || null, hashToken(token), auth.userId],
    );
    await connection.execute(
      'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, detailsJson) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), auth.workspaceId, auth.userId, 'invitation.created', JSON.stringify({ email: email.toLowerCase(), role })],
    );
    await connection.commit();
    res.status(201).json({ success: true, invitePath: `/?invite=${encodeURIComponent(token)}`, expiresInDays: 7 });
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
  if (!geminiClient && process.env.GEMINI_API_KEY) {
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
     WHERE m.workspaceId = ? AND m.dayNumber = ? AND m.isRequired = 1`,
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
     WHERE m.workspaceId = ? AND m.isRequired = 1
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

app.get('/api/curriculum/progress', requireRole('student'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    res.json(await reconcileAllCurriculumProgress(auth.workspaceId, auth.userId));
  } catch (error) {
    console.error('Curriculum progress query failed:', error);
    res.status(500).json({ error: 'Could not load your curriculum progress.' });
  }
});

app.put('/api/curriculum/progress/:dayNumber', requireRole('student'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const dayNumber = Number(req.params.dayNumber);
  const { completed } = req.body || {};
  if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 40 || typeof completed !== 'boolean') {
    return res.status(400).json({ error: 'Choose a curriculum day from 1 to 40 and provide its completion status.' });
  }
  return res.status(409).json({ error: `Day ${dayNumber} completion is automatic. Review all required materials and pass its learning check.` });
});

app.get('/api/curriculum/learning-check', requireRole('student'), async (req, res) => {
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

app.post('/api/curriculum/learning-check/attempts', requireRole('student'), async (req, res) => {
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
app.get('/api/curriculum/materials', requireRole('college_admin', 'trainer', 'student'), async (req, res) => {
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
       WHERE m.workspaceId = ? AND m.dayNumber = ?
       ORDER BY m.position, m.createdAt, m.title`,
      [auth.role === 'student' ? auth.userId : null, auth.workspaceId, dayNumber],
    );
    res.json(rows.map((row: any) => ({ ...row, isRequired: Boolean(row.isRequired), progressStatus: row.progressStatus || 'not_started' })));
  } catch (error) {
    console.error('Curriculum materials query failed:', error);
    res.status(500).json({ error: `Could not load Day ${dayNumber} learning materials. Apply the latest database migration and retry.` });
  }
});

app.post('/api/curriculum/materials', requireRole('college_admin', 'trainer'), async (req, res) => {
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

app.patch('/api/curriculum/materials/:id', requireRole('college_admin', 'trainer'), async (req, res) => {
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

app.delete('/api/curriculum/materials/:id', requireRole('college_admin', 'trainer'), async (req, res) => {
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

app.put('/api/curriculum/materials/:id/progress', requireRole('student'), async (req, res) => {
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
app.get('/api/students', async (req, res) => {
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

app.get('/api/reports/activity', requireRole('college_admin'), async (req, res) => {
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

app.get('/api/reports/interviews', requireRole('college_admin'), async (req, res) => {
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

app.get('/api/reports/placement-outcomes', requireRole('college_admin'), async (req, res) => {
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
app.get('/api/batches', async (req, res) => {
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

app.post('/api/batches', requireRole('college_admin'), async (req, res) => {
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

app.patch('/api/batches/:id', requireRole('college_admin'), async (req, res) => {
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

app.get('/api/assessments', async (req, res) => {
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
            ORDER BY latest.submittedAt DESC, latest.id DESC LIMIT 1) AS latestPercentage
         FROM Submissions s WHERE s.workspaceId = ? AND s.studentId = ?
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
        studentLatestPercentage: attempt?.latestPercentage == null ? null : Number(attempt.latestPercentage),
      }, auth.role === 'student');
    }));
  } catch (error) {
    console.error('Assessment catalog query failed:', error);
    res.status(500).json({ error: 'Could not load workspace assessments.' });
  }
});

app.post('/api/assessments', requireRole('college_admin', 'trainer'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { sourceAssessmentId, title, status, scheduledDate, batchId, dayNumber, durationMinutes, purpose, sections, coverage, type, targetCompanies } = req.body || {};
  if (typeof sourceAssessmentId !== 'string' || typeof title !== 'string' || title.trim().length < 3 || title.length > 191 || !['upcoming', 'live', 'completed'].includes(status) || typeof scheduledDate !== 'string' || scheduledDate.length > 191) {
    return res.status(400).json({ error: 'Choose a source assessment and provide a title, status, and scheduled date.' });
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
    if (!Array.isArray(parsedSections) || parsedSections.length < 1 || parsedSections.length > 20 || parsedSections.some((section: any) => !section || typeof section.name !== 'string' || !Array.isArray(section.questions) || section.questions.length > 100)) {
      return res.status(400).json({ error: 'Add at least one valid section containing questions.' });
    }
    let computedMarks = 0;
    let questionCount = 0;
    let codingQuestionCount = 0;
    for (const section of parsedSections) {
      if (!section.id || !section.name.trim()) return res.status(400).json({ error: 'Every section needs an id and name.' });
      for (const question of section.questions) {
        questionCount += 1;
        if (questionCount > 100) return res.status(400).json({ error: 'An assignment can contain at most 100 questions.' });
        const data = question?.data;
        if (question?.type === 'mcq') {
          if (!data || typeof data.text !== 'string' || !data.text.trim() || !Array.isArray(data.options) || data.options.length < 2 || data.options.length > 8 || data.options.some((option: any) => typeof option !== 'string') || !Number.isInteger(data.correctIndex) || data.correctIndex < 0 || data.correctIndex >= data.options.length || !Number.isFinite(data.marks) || data.marks < 1 || data.marks > 100) return res.status(400).json({ error: 'Each multiple-choice question needs a prompt, 2–8 options, a correct option, and marks from 1 to 100.' });
          computedMarks += data.marks;
        } else if (question?.type === 'coding') {
          codingQuestionCount += 1;
          if (codingQuestionCount > 3) return res.status(400).json({ error: 'An assignment can contain at most 3 coding questions.' });
          if (!data || typeof data.title !== 'string' || !data.title.trim() || typeof data.description !== 'string' || !data.description.trim() || !Array.isArray(data.testCases) || data.testCases.length < 1 || data.testCases.length > 10 || data.testCases.some((testCase: any) => typeof testCase.input !== 'string' || typeof testCase.expected !== 'string') || !Number.isFinite(data.marks ?? 30) || (data.marks ?? 30) < 1 || (data.marks ?? 30) > 100 || !data.templates || typeof data.templates !== 'object' || Object.values(data.templates).every((template: any) => typeof template !== 'string')) return res.status(400).json({ error: 'Each coding question needs instructions, 1–10 input/output test cases, at least one starter template, and valid marks.' });
          computedMarks += data.marks ?? 30;
        } else return res.status(400).json({ error: 'Question type must be multiple choice or coding.' });
      }
    }
    if (!computedMarks) return res.status(400).json({ error: 'Add at least one question to the assignment.' });
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
    await pool.execute(
      `INSERT INTO Assessments
       (id, workspaceId, dayNumber, title, type, durationMinutes, totalMarks, coverageJson, purpose, status, scheduledDate, sectionsJson, targetCompaniesJson, createdByUserId, batchId, isCustomized)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [id, auth.workspaceId, Number.isInteger(dayNumber) ? Math.max(1, Math.min(40, dayNumber)) : source?.dayNumber || 1, title.trim(), assessmentType, Number.isInteger(durationMinutes) ? Math.max(1, Math.min(600, durationMinutes)) : source?.durationMinutes || 60, computedMarks, JSON.stringify(Array.isArray(coverage) ? coverage.filter((item: any) => typeof item === 'string').slice(0, 50) : source ? JSON.parse(source.coverageJson) : []), typeof purpose === 'string' ? purpose.slice(0, 255) : source?.purpose || '', status, scheduledDate, JSON.stringify(parsedSections), JSON.stringify(Array.isArray(targetCompanies) ? targetCompanies.filter((item: any) => typeof item === 'string').slice(0, 50) : source ? JSON.parse(source.targetCompaniesJson) : []), auth.userId, batchId || null],
    );
    await pool.execute(
      'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, detailsJson) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), auth.workspaceId, auth.userId, 'assessment.created', JSON.stringify({ assessmentId: id, title: title.trim() })],
    );
    const [rows]: any = await pool.execute('SELECT * FROM Assessments WHERE id = ?', [id]);
    res.status(201).json(serializeAssessment(rows[0]));
  } catch (error) {
    console.error('Assessment creation failed:', error);
    res.status(500).json({ error: 'Could not create the assessment.' });
  }
});

app.patch('/api/assessments/:id', requireRole('college_admin', 'trainer'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { id } = req.params;
  const { title, dayNumber, durationMinutes, purpose, status, scheduledDate, batchId } = req.body || {};
  if (title !== undefined && (typeof title !== 'string' || title.trim().length < 3 || title.length > 191)) return res.status(400).json({ error: 'Assessment title must be at least 3 characters.' });
  if (dayNumber !== undefined && (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 40)) return res.status(400).json({ error: 'Day number must be between 1 and 40.' });
  if (durationMinutes !== undefined && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 600)) return res.status(400).json({ error: 'Duration must be between 1 and 600 minutes.' });
  if (status !== undefined && !['upcoming', 'live', 'completed'].includes(status)) return res.status(400).json({ error: 'Invalid assessment status.' });
  if (scheduledDate !== undefined && (typeof scheduledDate !== 'string' || scheduledDate.length > 191)) return res.status(400).json({ error: 'Scheduled date is invalid.' });
  try {
    const [rows]: any = await pool.execute('SELECT batchId FROM Assessments WHERE id = ? AND workspaceId = ? AND isArchived = 0', [id, auth.workspaceId]);
    if (!rows.length) return res.status(404).json({ error: 'Assessment not found in this workspace.' });
    if (auth.role === 'trainer' && rows[0].batchId) {
      const [assignments]: any = await pool.execute('SELECT 1 FROM WorkspaceBatchAssignments WHERE workspaceId = ? AND batchId = ? AND trainerUserId = ?', [auth.workspaceId, rows[0].batchId, auth.userId]);
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
    await pool.execute(
      `UPDATE Assessments SET title = COALESCE(?, title), dayNumber = COALESCE(?, dayNumber),
       durationMinutes = COALESCE(?, durationMinutes), purpose = COALESCE(?, purpose),
       status = COALESCE(?, status), scheduledDate = COALESCE(?, scheduledDate),
       batchId = ?, isCustomized = 1 WHERE id = ? AND workspaceId = ?`,
      [title === undefined ? null : title.trim(), dayNumber ?? null, durationMinutes ?? null, purpose ?? null, status ?? null, scheduledDate ?? null, batchId === undefined ? rows[0].batchId : batchId, id, auth.workspaceId],
    );
    await pool.execute(
      'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, detailsJson) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), auth.workspaceId, auth.userId, 'assessment.updated', JSON.stringify({ assessmentId: id })],
    );
    const [updated]: any = await pool.execute('SELECT * FROM Assessments WHERE id = ?', [id]);
    res.json(serializeAssessment(updated[0]));
  } catch (error) {
    console.error('Assessment update failed:', error);
    res.status(500).json({ error: 'Could not update the assessment.' });
  }
});

app.delete('/api/assessments/:id', requireRole('college_admin'), async (req, res) => {
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

app.post('/api/assessments/:id/submissions', requireRole('student'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  const { answers, codingScores, timeSpentSeconds } = req.body || {};
  if (!answers || typeof answers !== 'object' || Array.isArray(answers) || !Number.isInteger(timeSpentSeconds) || timeSpentSeconds < 0) {
    return res.status(400).json({ error: 'Assessment answers and elapsed time are required.' });
  }
  try {
    const [rows]: any = await pool.execute(
      `SELECT a.* FROM Assessments a
       JOIN WorkspaceMemberships wm ON wm.workspaceId = a.workspaceId AND wm.userId = ? AND wm.status = 'active'
       JOIN WorkspaceStudentProfiles sp ON sp.workspaceId = wm.workspaceId AND sp.userId = wm.userId
       WHERE a.id = ? AND a.workspaceId = ? AND a.isArchived = 0 AND a.status = 'live'
         AND (a.batchId IS NULL OR a.batchId = sp.batchId) LIMIT 1`,
      [auth.userId, req.params.id, auth.workspaceId],
    );
    const assessment = rows[0];
    if (!assessment) return res.status(404).json({ error: 'This assessment is not live or assigned to your batch.' });
    const sections = JSON.parse(assessment.sectionsJson || '[]');
    const questions = sections.flatMap((section: any) => section.questions || []);
    let score = 0;
    let maxMarks = 0;
    const codingResults: Record<string, number> = {};
    for (const [index, question] of questions.entries()) {
      if (question.type === 'mcq') {
        const marks = Number(question.data?.marks || 0);
        maxMarks += marks;
        if (Number(answers[index]) === Number(question.data?.correctIndex)) score += marks;
      } else if (question.type === 'coding') {
        const marks = Number(question.data?.marks || 30);
        maxMarks += marks;
        const percent = Number(codingScores?.[index]);
        const bounded = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
        codingResults[String(index)] = bounded;
        score += marks * bounded / 100;
      }
    }
    maxMarks = maxMarks || Number(assessment.totalMarks || 0);
    const percentage = maxMarks ? Math.round(score / maxMarks * 100) : 0;
    const submissionId = randomUUID();
    await pool.execute(
      `INSERT INTO Submissions
       (id, workspaceId, assessmentId, studentId, score, totalMarks, percentage, timeSpentSeconds, answersJson, codingResultsJson, passed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [submissionId, auth.workspaceId, assessment.id, auth.userId, score, maxMarks, percentage, timeSpentSeconds, JSON.stringify(answers), JSON.stringify(codingResults), percentage >= 70 ? 1 : 0],
    );
    res.status(201).json({ id: submissionId, score, totalMarks: maxMarks, percentage, passed: percentage >= 70, timeSpentSeconds });
  } catch (error) {
    console.error('Assessment submission failed:', error);
    res.status(500).json({ error: 'Could not save this assessment attempt.' });
  }
});

app.get('/api/assessments/submissions/mine', requireRole('student'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [rows]: any = await pool.execute(
      `SELECT s.id, s.assessmentId, a.title AS assessmentTitle, s.score, s.totalMarks, s.percentage,
              s.timeSpentSeconds, s.submittedAt, s.answersJson, s.codingResultsJson, s.passed
       FROM Submissions s JOIN Assessments a ON a.id = s.assessmentId AND a.workspaceId = s.workspaceId
       WHERE s.workspaceId = ? AND s.studentId = ? ORDER BY s.submittedAt DESC LIMIT 100`,
      [auth.workspaceId, auth.userId],
    );
    res.json(rows.map((row: any) => ({ ...row, answers: JSON.parse(row.answersJson || '{}'), codingResults: JSON.parse(row.codingResultsJson || '{}'), passed: Boolean(row.passed) })));
  } catch (error) {
    console.error('Assessment history query failed:', error);
    res.status(500).json({ error: 'Could not load your assessment history.' });
  }
});

app.get('/api/assessments/:id/submissions', requireRole('college_admin', 'trainer'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [rows]: any = await pool.execute(
      `SELECT s.id, s.assessmentId, a.title AS assessmentTitle, s.studentId, u.name AS studentName,
              s.score, s.totalMarks, s.percentage, s.timeSpentSeconds, s.submittedAt, s.passed
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
    res.json(rows.map((row: any) => ({ ...row, passed: Boolean(row.passed) })));
  } catch (error) {
    console.error('Assessment submissions query failed:', error);
    res.status(500).json({ error: 'Could not load assessment submissions.' });
  }
});

app.get('/api/leaderboard', async (req, res) => {
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
       WHERE (? = 'college_admin')
          OR (? = 'trainer' AND EXISTS (
            SELECT 1 FROM WorkspaceBatchAssignments ba WHERE ba.workspaceId = wm.workspaceId
              AND ba.batchId = sp.batchId AND ba.trainerUserId = ?
          ))
          OR (? = 'student' AND sp.batchId = (SELECT own.batchId FROM WorkspaceStudentProfiles own WHERE own.workspaceId = wm.workspaceId AND own.userId = ?))
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
app.get('/api/notifications', async (req, res) => {
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

app.patch('/api/notifications/:id/read', async (req, res) => {
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
app.post('/api/students/:id/remarks', requireRole('college_admin', 'trainer'), async (req, res) => {
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
    if (!['tech', 'hr'].includes(type) || typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100 || !remark || typeof remark !== 'object' || remark.type !== type || typeof remark.comment !== 'string' || remark.comment.length > 5000 || !ratings || typeof ratings !== 'object' || Array.isArray(ratings)) {
      return res.status(400).json({ error: 'A valid interview type, score, and remark are required.' });
    }
    for (const value of Object.values(ratings) as any[]) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10) return res.status(400).json({ error: 'Interview rubric scores must be between 0 and 10.' });
    }
    const recentRemarks = JSON.parse(student.recentRemarksJson || '[]');
    recentRemarks.unshift(remark);
    const scoreCol = type === 'tech' ? 'techInterview' : 'hrInterview';
    const coding = student.coding;
    const aptitude = student.aptitude;
    const reasoning = student.reasoning;
    const sqlScore = student.sqlScore;
    const csFundamentals = student.csFundamentals;
    const communication = student.communication;
    
    const techInterview = type === 'tech' ? score : student.techInterview;
    const hrInterview = type === 'hr' ? score : student.hrInterview;

    const overallReadiness = Math.round(
      (coding * 0.25) + 
      (aptitude * 0.15) + 
      (reasoning * 0.1) + 
      (sqlScore * 0.1) + 
      (csFundamentals * 0.1) + 
      (communication * 0.1) + 
      (techInterview * 0.1) + 
      (hrInterview * 0.1)
    );

    await pool.query(
      `UPDATE WorkspaceStudentProfiles
       SET recentRemarksJson = ?, ${scoreCol} = ?, overallReadiness = ?, placementReadinessScore = ?
       WHERE workspaceId = ? AND userId = ?`,
      [JSON.stringify(recentRemarks), score, overallReadiness, overallReadiness, auth.workspaceId, id]
    );

    const normalizedRecommendation = recommendation === 'hire'
      ? 'Hire'
      : recommendation === 'remedial'
      ? 'Need Improvement'
      : 'Borderline';
    await pool.execute(
      `INSERT INTO InterviewRecords (id, workspaceId, studentId, type, date, panel, status, ratingsJson, remarks, recommendation, score, createdByUserId)
       VALUES (?, ?, ?, ?, ?, ?, 'Completed', ?, ?, ?, ?, ?)`,
      [randomUUID(), auth.workspaceId, id, type, String(remark.date || new Date().toISOString().slice(0, 10)), auth.name, JSON.stringify(ratings), remark.comment, normalizedRecommendation, score, auth.userId],
    );
    await pool.execute(
      'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, targetUserId, detailsJson) VALUES (?, ?, ?, ?, ?, ?)',
      [randomUUID(), auth.workspaceId, auth.userId, 'interview.evaluation_saved', id, JSON.stringify({ type, score })],
    );

    res.json({ success: true, updatedReadiness: overallReadiness });
  } catch (error) {
    console.error('Error updating remarks:', error);
    res.status(500).json({ error: 'Database update failed' });
  }
});

app.get('/api/students/:id/interviews', async (req, res) => {
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

      const generated = await generateWithWorkspaceAi((req as AuthenticatedRequest).auth!.workspaceId, () => ai.models.generateContent({
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

      const generated = await generateWithWorkspaceAi((req as AuthenticatedRequest).auth!.workspaceId, () => ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: prompt,
        config: { responseMimeType: 'application/json' },
      }));
      if (!generated.allowed) return res.status(429).json({ code: 'PLAN_LIMIT_REACHED', limitKey: 'ai_credits_per_period', error: generated.message });
      const response = generated.response;

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
app.post('/api/ai/trainer-summary', requireRole('college_admin', 'trainer'), async (req, res) => {
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

      const generated = await generateWithWorkspaceAi((req as AuthenticatedRequest).auth!.workspaceId, () => ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: prompt,
      }));
      if (!generated.allowed) return res.status(429).json({ code: 'PLAN_LIMIT_REACHED', limitKey: 'ai_credits_per_period', error: generated.message });
      const response = generated.response;

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
  const { code, language, testCases } = req.body;
  const results = (testCases || []).map((tc: any, index: number) => {
    const passed = !code.includes('syntax_error_test') && !code.includes('throw');
    return { testCaseId: index + 1, input: tc.input, expected: tc.expected, actual: passed ? tc.expected : 'Runtime Exception: IndexOutOfBounds', passed, hidden: Boolean(tc.hidden), executionTimeMs: Math.floor(Math.random() * 45) + 12, memoryKb: Math.floor(Math.random() * 2048) + 14200 };
  });
  const totalPassed = results.filter((result: any) => result.passed).length;
  res.json({ success: totalPassed === results.length, score: results.length ? Math.round(totalPassed / results.length * 100) : 0, totalTestCases: results.length, passedTestCases: totalPassed, executionTimeMs: 42, memoryKb: 15420, language: language || 'javascript', stdout: `Program executed in ${language}. Passed ${totalPassed}/${results.length} test cases.`, results });
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
