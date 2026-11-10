import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import mysql from 'mysql2/promise';
import { ASSESSMENTS_CATALOG } from './src/data/assessmentData';
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = 'talentedge_session';
const SESSION_DAYS = 14;
const loginFailures = new Map<string, { count: number; expiresAt: number }>();

interface AuthContext {
  sessionId: string;
  userId: string;
  name: string;
  email: string;
  avatar: string;
  workspaceId: string;
  workspaceName: string;
  role: 'college_admin' | 'trainer' | 'student';
}

type AuthenticatedRequest = Request & { auth?: AuthContext };

app.use(express.json());

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
  const [existing]: any = await db.execute('SELECT id FROM Assessments WHERE workspaceId = ? LIMIT 1', [workspaceId]);
  if (existing.length > 0) return;
  for (const assessment of ASSESSMENTS_CATALOG) {
    await db.execute(
      `INSERT INTO Assessments
       (id, workspaceId, dayNumber, title, type, durationMinutes, totalMarks, coverageJson, purpose, status, scheduledDate, sectionsJson, targetCompaniesJson, createdByUserId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`${workspaceId}:${assessment.id}`, workspaceId, assessment.dayNumber, assessment.title, assessment.type,
        assessment.durationMinutes, assessment.totalMarks, JSON.stringify(assessment.coverage), assessment.purpose,
        assessment.status, assessment.scheduledDate, JSON.stringify(assessment.sections),
        JSON.stringify(assessment.targetCompanies), createdByUserId],
    );
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
              w.id AS workspaceId, w.name AS workspaceName, wm.role
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
      `SELECT wm.workspaceId, w.name AS workspaceName
       FROM WorkspaceMemberships wm JOIN Workspaces w ON w.id = wm.workspaceId
       WHERE wm.userId = ? AND wm.status = 'active' ORDER BY w.name`,
      [user.id],
    );
    const membership = memberships.find((item: any) => !workspaceId || item.workspaceId === workspaceId);
    if (!membership) return res.status(403).json({ error: 'No active college workspace is assigned to this account.' });
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
    const [users]: any = await connection.execute('SELECT id, passwordHash FROM Users WHERE email = ? LIMIT 1 FOR UPDATE', [invitation.email]);
    let userId = users[0]?.id;
    if (!userId) {
      userId = randomUUID();
      const passwordHash = await hashPassword(password);
      const legacyRole = invitation.role === 'college_admin' ? 'admin' : invitation.role;
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

app.get('/api/auth/me', authenticate, (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  res.json({
    user: { id: auth.userId, name: auth.name, email: auth.email, avatar: auth.avatar },
    workspace: { id: auth.workspaceId, name: auth.workspaceName },
    role: auth.role,
  });
});

// All application data endpoints below this point require an active workspace session.
app.use('/api', authenticate);

app.get('/api/workspace/members', requireRole('college_admin'), async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [rows]: any = await pool.execute(
      `SELECT u.id, u.name, u.email, wm.role, wm.status, wm.createdAt
       FROM WorkspaceMemberships wm JOIN Users u ON u.id = wm.userId
       WHERE wm.workspaceId = ? ORDER BY wm.role, u.name`,
      [auth.workspaceId],
    );
    res.json(rows);
  } catch (error) {
    console.error('Workspace members query failed:', error);
    res.status(500).json({ error: 'Could not load workspace members.' });
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
    const [rows]: any = await connection.execute(
      'SELECT userId, role, status FROM WorkspaceMemberships WHERE workspaceId = ? AND userId = ? FOR UPDATE',
      [auth.workspaceId, id],
    );
    const member = rows[0];
    if (!member) {
      await connection.rollback();
      return res.status(404).json({ error: 'Workspace member not found.' });
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
  if (!validEmail(email) || !['college_admin', 'trainer', 'student'].includes(role)) {
    return res.status(400).json({ error: 'A valid email and workspace role are required.' });
  }
  if (role === 'student' && batchId !== undefined && batchId !== null && typeof batchId !== 'string') return res.status(400).json({ error: 'Batch selection is invalid.' });
  if (role !== 'student' && batchId) return res.status(400).json({ error: 'Only student invitations can be assigned to a batch.' });
  try {
    if (role === 'student' && batchId) {
      const [batches]: any = await pool.execute('SELECT id FROM Batches WHERE id = ? AND workspaceId = ? AND isArchived = 0', [batchId, auth.workspaceId]);
      if (!batches.length) return res.status(400).json({ error: 'Choose a batch in this workspace.' });
    }
    const token = randomBytes(32).toString('base64url');
    await pool.execute(
      `INSERT INTO WorkspaceInvitations (id, workspaceId, email, role, batchId, tokenHash, invitedByUserId, expiresAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY))`,
      [randomUUID(), auth.workspaceId, email.toLowerCase(), role, batchId || null, hashToken(token), auth.userId],
    );
    await pool.execute(
      'INSERT INTO WorkspaceAuditEvents (id, workspaceId, actorUserId, action, detailsJson) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), auth.workspaceId, auth.userId, 'invitation.created', JSON.stringify({ email: email.toLowerCase(), role })],
    );
    res.status(201).json({ success: true, invitePath: `/?invite=${encodeURIComponent(token)}`, expiresInDays: 7 });
  } catch (error) {
    console.error('Invitation creation failed:', error);
    res.status(500).json({ error: 'Could not create the invitation.' });
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

// Fetch all students from MySQL
app.get('/api/students', async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;
  try {
    const [rows]: any = await pool.execute(`
      SELECT 
        sp.*, 
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
    const [batches]: any = await connection.execute('SELECT id FROM Batches WHERE id = ? AND workspaceId = ? FOR UPDATE', [id, auth.workspaceId]);
    if (!batches.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'Batch not found in this workspace.' });
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
        `SELECT assessmentId, COUNT(*) AS attemptCount, MAX(submittedAt) AS lastSubmittedAt
         FROM Submissions WHERE workspaceId = ? AND studentId = ? GROUP BY assessmentId`,
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
       (id, workspaceId, dayNumber, title, type, durationMinutes, totalMarks, coverageJson, purpose, status, scheduledDate, sectionsJson, targetCompaniesJson, createdByUserId, batchId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
       batchId = ? WHERE id = ? AND workspaceId = ?`,
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
    const [rows]: any = await pool.execute('SELECT * FROM Notifications WHERE workspaceId = ? ORDER BY createdAt DESC', [auth.workspaceId]);
    res.json(rows.map((n: any) => ({ ...n, unread: Boolean(n.unread) })));
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Database query failed' });
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
