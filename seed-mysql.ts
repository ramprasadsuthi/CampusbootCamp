import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { createHash } from 'node:crypto';
import { SAMPLE_STUDENTS, INITIAL_USERS, DEMO_BATCHES } from './src/data/mockData';

dotenv.config();

function stableId(workspaceId: string, sourceId: string) {
  const scope = createHash('sha256').update(workspaceId).digest('hex').slice(0, 12);
  return `demo-${scope}-${sourceId}`;
}

function demoEmail(workspaceId: string, sourceEmail: string) {
  const scope = createHash('sha256').update(workspaceId).digest('hex').slice(0, 12);
  const localPart = sourceEmail.split('@')[0].toLowerCase().replace(/[^a-z0-9.-]/g, '-');
  return `demo+${scope}-${localPart}@example.com`;
}

async function seed() {
  const host = process.env.DB_HOST || 'localhost';
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME || 'talentedge';
  const requestedWorkspace = process.env.DEMO_WORKSPACE_ID
    || process.argv.slice(2).find((arg) => arg.startsWith('--workspace='))?.slice('--workspace='.length);

  console.log(`Connecting to MySQL database '${database}' on '${host}'...`);
  const connection = await mysql.createConnection({ host, user, password, database });
  try {
    const [workspaceRows]: any = await connection.query(
      'SELECT id, name FROM Workspaces ORDER BY createdAt, id',
    );
    if (!workspaceRows.length) throw new Error('No workspace found. Run npm run db:migrate-auth first.');

    let workspace = requestedWorkspace
      ? workspaceRows.find((row: { id: string }) => row.id === requestedWorkspace)
      : workspaceRows.length === 1 ? workspaceRows[0] : undefined;
    if (!workspace) {
      if (requestedWorkspace) throw new Error(`Workspace '${requestedWorkspace}' was not found.`);
      const choices = workspaceRows.map((row: { id: string; name: string }) => `${row.name} (${row.id})`).join('\n');
      throw new Error(`Multiple workspaces exist. Choose the demo tenant explicitly with DEMO_WORKSPACE_ID or --workspace=<id>:\n${choices}`);
    }

    const workspaceId = String(workspace.id);
    const workspaceName = String(workspace.name);
    const batchIds = new Map(DEMO_BATCHES.map((batch) => [batch.id, stableId(workspaceId, batch.id)]));
    const lockName = `talentedge:seed:${createHash('sha256').update(workspaceId).digest('hex').slice(0, 32)}`;
    const [[lockRow]]: any = await connection.execute('SELECT GET_LOCK(?, 30) AS acquired', [lockName]);
    if (Number(lockRow.acquired) !== 1) throw new Error('Could not acquire the demo seed lock within 30 seconds.');

    try {
      await connection.beginTransaction();

      const expectedBatches = [...batchIds.values()];
      const [existingBatches]: any = await connection.execute(
        `SELECT id, workspaceId FROM Batches WHERE id IN (${expectedBatches.map(() => '?').join(',')})`,
        expectedBatches,
      );
      if (existingBatches.some((row: { workspaceId: string }) => row.workspaceId !== workspaceId)) {
        throw new Error('A demo batch identifier is already owned by another workspace. No demo data was written.');
      }

      const expectedAccounts = [
        ...INITIAL_USERS.filter((entry) => entry.role !== 'student').map((person) => ({
          id: stableId(workspaceId, person.id), email: demoEmail(workspaceId, person.email), rollNo: null,
          role: person.role === 'admin' ? 'admin' : person.role,
        })),
        ...SAMPLE_STUDENTS.map((student) => ({
          id: stableId(workspaceId, student.id), email: demoEmail(workspaceId, student.email),
          rollNo: `${student.rollNo}-${createHash('sha256').update(workspaceId).digest('hex').slice(0, 6)}`,
          role: 'student',
        })),
      ];
      const [existingAccounts]: any = await connection.execute(
        `SELECT id, email, rollNo, role FROM Users
         WHERE id IN (${expectedAccounts.map(() => '?').join(',')})
            OR email IN (${expectedAccounts.map(() => '?').join(',')})
            OR rollNo IN (${expectedAccounts.filter((account) => account.rollNo).map(() => '?').join(',')})`,
        [
          ...expectedAccounts.map((account) => account.id),
          ...expectedAccounts.map((account) => account.email),
          ...expectedAccounts.flatMap((account) => account.rollNo ? [account.rollNo] : []),
        ],
      );
      for (const existing of existingAccounts) {
        const intended = expectedAccounts.find((account) => account.id === existing.id);
        if (!intended || intended.email !== existing.email || intended.rollNo !== (existing.rollNo || null)
          || intended.role !== existing.role) {
          throw new Error('A demo account identifier, email, or roll number is already in use. No demo data was written.');
        }
      }

      for (const batch of DEMO_BATCHES) {
        await connection.execute(
          `INSERT IGNORE INTO Batches
           (id, name, college, trainer, totalStudents, readyCount, atRiskCount, averageScore, currentDay, startDate, completionDate, attendanceRate, workspaceId)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [batchIds.get(batch.id), batch.name, workspaceName, batch.trainer, batch.totalStudents, batch.readyCount,
            batch.atRiskCount, batch.averageScore, batch.currentDay, batch.startDate, batch.completionDate,
            batch.attendanceRate, workspaceId],
        );
      }

      const demoUsers = INITIAL_USERS.filter((entry) => entry.role !== 'student');
      for (const person of demoUsers) {
        const id = stableId(workspaceId, person.id);
        const email = demoEmail(workspaceId, person.email);
        await connection.execute(
          `INSERT IGNORE INTO Users
           (id, name, email, role, avatar, phone, rollNo, college, department, branch, batchId, trainerName)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, person.name, email, person.role, person.avatar, person.phone || null, null, workspaceName,
            person.department || null, null, person.batchId ? batchIds.get(person.batchId) || null : null,
            person.trainerName || null],
        );
        await connection.execute(
          `INSERT IGNORE INTO WorkspaceMemberships (id, workspaceId, userId, role)
           VALUES (?, ?, ?, ?)`,
          [stableId(workspaceId, `membership-${person.id}`), workspaceId, id,
            person.role === 'admin' ? 'college_admin' : person.role],
        );
      }

      for (const student of SAMPLE_STUDENTS) {
        const id = stableId(workspaceId, student.id);
        const email = demoEmail(workspaceId, student.email);
        const rollNo = `${student.rollNo}-${createHash('sha256').update(workspaceId).digest('hex').slice(0, 6)}`;
        const batchId = DEMO_BATCHES.find((batch) => batch.name === student.batch)
          ? batchIds.get(DEMO_BATCHES.find((batch) => batch.name === student.batch)!.id) || null
          : null;

        await connection.execute(
          `INSERT IGNORE INTO Users
           (id, name, email, role, avatar, phone, rollNo, college, department, branch, batchId, trainerName)
           VALUES (?, ?, ?, 'student', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, student.name, email, student.photo, student.phone, rollNo, workspaceName,
            student.department, student.branch, batchId, student.trainer],
        );
        await connection.execute(
          `INSERT IGNORE INTO WorkspaceMemberships (id, workspaceId, userId, role)
           VALUES (?, ?, ?, 'student')`,
          [stableId(workspaceId, `membership-${student.id}`), workspaceId, id],
        );
        await connection.execute(
          `INSERT IGNORE INTO StudentProfiles
           (id, attendancePercent, currentDay, overallProgressPercent, placementReadinessScore,
            coding, aptitude, reasoning, sqlScore, csFundamentals, communication, techInterview, hrInterview,
            overallReadiness, eligibilityJson, weakAreasJson, strengthsJson, recentRemarksJson, batchId)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, student.attendancePercent, student.currentDay, student.overallProgressPercent,
            student.placementReadinessScore, student.metrics.coding, student.metrics.aptitude,
            student.metrics.reasoning, student.metrics.sql, student.metrics.csFundamentals,
            student.metrics.communication, student.metrics.techInterview, student.metrics.hrInterview,
            student.metrics.overallReadiness, JSON.stringify(student.eligibility), JSON.stringify(student.weakAreas),
            JSON.stringify(student.strengths), JSON.stringify(student.recentRemarks), batchId],
        );
        await connection.execute(
          `INSERT IGNORE INTO WorkspaceStudentProfiles
           (workspaceId, userId, rollNo, phone, college, department, branch, trainerName,
            attendancePercent, currentDay, overallProgressPercent, placementReadinessScore,
            coding, aptitude, reasoning, sqlScore, csFundamentals, communication, techInterview, hrInterview,
            overallReadiness, eligibilityJson, weakAreasJson, strengthsJson, recentRemarksJson, batchId)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [workspaceId, id, rollNo, student.phone, workspaceName, student.department, student.branch,
            student.trainer, student.attendancePercent, student.currentDay, student.overallProgressPercent,
            student.placementReadinessScore, student.metrics.coding, student.metrics.aptitude,
            student.metrics.reasoning, student.metrics.sql, student.metrics.csFundamentals,
            student.metrics.communication, student.metrics.techInterview, student.metrics.hrInterview,
            student.metrics.overallReadiness, JSON.stringify(student.eligibility), JSON.stringify(student.weakAreas),
            JSON.stringify(student.strengths), JSON.stringify(student.recentRemarks), batchId],
        );
      }

      const trainerId = stableId(workspaceId, 'user-trainer-1');
      const trainerBatchId = batchIds.get('batch-1');
      if (trainerBatchId) {
        await connection.execute(
          `INSERT IGNORE INTO WorkspaceBatchAssignments (workspaceId, batchId, trainerUserId)
           SELECT ?, ?, ? FROM WorkspaceMemberships
           WHERE workspaceId = ? AND userId = ? AND role = 'trainer'`,
          [workspaceId, trainerBatchId, trainerId, workspaceId, trainerId],
        );
      }

      const notifications = [
        ['n1', 'Day 40 Final Placement Simulation Live', '10 minutes ago', '3-Hour capstone test is now active for all batches.', 1],
        ['n2', 'TCS NQT Drive Benchmark Updated', '1 hour ago', 'Your coding score (92%) qualifies for TCS Digital shortlist.', 1],
        ['n3', 'Technical Mock Interview Scheduled', 'Yesterday', 'Panel session completed with Prof. Rajesh Sharma. Score: 88%.', 0],
      ];
      for (const [id, title, time, description, unread] of notifications) {
        await connection.execute(
          `INSERT IGNORE INTO Notifications (id, title, time, \`desc\`, unread, workspaceId)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [stableId(workspaceId, `notification-${id}`), title, time, description, unread, workspaceId],
        );
      }

      await connection.commit();
      console.log(`Demo records are ready in workspace '${workspaceName}' (${workspaceId}). Existing data was preserved.`);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      await connection.execute('SELECT RELEASE_LOCK(?)', [lockName]);
    }
  } finally {
    await connection.end();
  }
}

seed().catch((error) => {
  console.error('Error seeding database:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
