import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { ASSESSMENTS_CATALOG } from './src/data/assessmentData';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'talentedge',
  waitForConnections: true,
  connectionLimit: 4,
});

async function hasColumn(table: string, column: string) {
  const [rows]: any = await pool.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column],
  );
  return rows.length > 0;
}

async function addColumn(table: string, column: string, definition: string) {
  if (!(await hasColumn(table, column))) {
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    console.log(`Added ${table}.${column}`);
  }
}

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS Workspaces (
      id VARCHAR(191) PRIMARY KEY,
      name VARCHAR(191) NOT NULL,
      slug VARCHAR(191) NOT NULL UNIQUE,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS WorkspaceMemberships (
      id VARCHAR(191) PRIMARY KEY,
      workspaceId VARCHAR(191) NOT NULL,
      userId VARCHAR(191) NOT NULL,
      role ENUM('college_admin', 'trainer', 'student') NOT NULL,
      status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_membership_workspace_user (workspaceId, userId),
      KEY idx_membership_user (userId),
      CONSTRAINT fk_membership_workspace FOREIGN KEY (workspaceId) REFERENCES Workspaces(id) ON DELETE CASCADE,
      CONSTRAINT fk_membership_user FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS WorkspaceStudentProfiles (
      workspaceId VARCHAR(191) NOT NULL,
      userId VARCHAR(191) NOT NULL,
      rollNo VARCHAR(191) NULL,
      phone VARCHAR(50) NULL,
      college VARCHAR(191) NULL,
      department VARCHAR(191) NULL,
      branch VARCHAR(191) NULL,
      trainerName VARCHAR(191) NULL,
      attendancePercent DOUBLE NOT NULL DEFAULT 0,
      currentDay INT NOT NULL DEFAULT 1,
      overallProgressPercent DOUBLE NOT NULL DEFAULT 0,
      placementReadinessScore DOUBLE NOT NULL DEFAULT 0,
      coding DOUBLE NOT NULL DEFAULT 0,
      aptitude DOUBLE NOT NULL DEFAULT 0,
      reasoning DOUBLE NOT NULL DEFAULT 0,
      sqlScore DOUBLE NOT NULL DEFAULT 0,
      csFundamentals DOUBLE NOT NULL DEFAULT 0,
      communication DOUBLE NOT NULL DEFAULT 0,
      techInterview DOUBLE NOT NULL DEFAULT 0,
      hrInterview DOUBLE NOT NULL DEFAULT 0,
      overallReadiness DOUBLE NOT NULL DEFAULT 0,
      eligibilityJson TEXT NOT NULL,
      weakAreasJson TEXT NOT NULL,
      strengthsJson TEXT NOT NULL,
      recentRemarksJson TEXT NOT NULL,
      batchId VARCHAR(191) NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (workspaceId, userId),
      UNIQUE KEY uq_workspace_rollno (workspaceId, rollNo),
      KEY idx_workspace_student_batch (workspaceId, batchId),
      CONSTRAINT fk_workspace_student_membership FOREIGN KEY (workspaceId, userId) REFERENCES WorkspaceMemberships(workspaceId, userId) ON DELETE CASCADE,
      CONSTRAINT fk_workspace_student_batch FOREIGN KEY (batchId) REFERENCES Batches(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS WorkspaceBatchAssignments (
      workspaceId VARCHAR(191) NOT NULL,
      batchId VARCHAR(191) NOT NULL,
      trainerUserId VARCHAR(191) NOT NULL,
      assignedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (workspaceId, batchId, trainerUserId),
      CONSTRAINT fk_batch_assignment_workspace FOREIGN KEY (workspaceId) REFERENCES Workspaces(id) ON DELETE CASCADE,
      CONSTRAINT fk_batch_assignment_batch FOREIGN KEY (batchId) REFERENCES Batches(id) ON DELETE CASCADE,
      CONSTRAINT fk_batch_assignment_member FOREIGN KEY (workspaceId, trainerUserId) REFERENCES WorkspaceMemberships(workspaceId, userId) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS AuthSessions (
      id VARCHAR(191) PRIMARY KEY,
      userId VARCHAR(191) NOT NULL,
      workspaceId VARCHAR(191) NOT NULL,
      tokenHash CHAR(64) NOT NULL UNIQUE,
      expiresAt DATETIME NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_session_user (userId),
      KEY idx_session_expiry (expiresAt),
      CONSTRAINT fk_session_user FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE CASCADE,
      CONSTRAINT fk_session_workspace FOREIGN KEY (workspaceId) REFERENCES Workspaces(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS WorkspaceInvitations (
      id VARCHAR(191) PRIMARY KEY,
      workspaceId VARCHAR(191) NOT NULL,
      email VARCHAR(191) NOT NULL,
      role ENUM('college_admin', 'trainer', 'student') NOT NULL,
      tokenHash CHAR(64) NOT NULL UNIQUE,
      invitedByUserId VARCHAR(191) NOT NULL,
      expiresAt DATETIME NOT NULL,
      acceptedAt DATETIME NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_invitation_workspace_email (workspaceId, email),
      CONSTRAINT fk_invitation_workspace FOREIGN KEY (workspaceId) REFERENCES Workspaces(id) ON DELETE CASCADE,
      CONSTRAINT fk_invitation_inviter FOREIGN KEY (invitedByUserId) REFERENCES Users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS WorkspaceAuditEvents (
      id VARCHAR(191) PRIMARY KEY,
      workspaceId VARCHAR(191) NOT NULL,
      actorUserId VARCHAR(191) NULL,
      action VARCHAR(100) NOT NULL,
      targetUserId VARCHAR(191) NULL,
      detailsJson TEXT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_audit_workspace_time (workspaceId, createdAt),
      CONSTRAINT fk_audit_workspace FOREIGN KEY (workspaceId) REFERENCES Workspaces(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS WorkspacePasswordResets (
      id VARCHAR(191) PRIMARY KEY,
      workspaceId VARCHAR(191) NOT NULL,
      userId VARCHAR(191) NOT NULL,
      tokenHash CHAR(64) NOT NULL UNIQUE,
      expiresAt DATETIME NOT NULL,
      usedAt DATETIME NULL,
      createdByUserId VARCHAR(191) NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_password_reset_expiry (expiresAt),
      CONSTRAINT fk_password_reset_workspace FOREIGN KEY (workspaceId) REFERENCES Workspaces(id) ON DELETE CASCADE,
      CONSTRAINT fk_password_reset_user FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE CASCADE,
      CONSTRAINT fk_password_reset_creator FOREIGN KEY (createdByUserId) REFERENCES Users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await addColumn('Users', 'passwordHash', 'VARCHAR(255) NULL');
  await addColumn('Users', 'isActive', 'TINYINT(1) NOT NULL DEFAULT 1');
  await addColumn('Batches', 'workspaceId', 'VARCHAR(191) NULL');
  await addColumn('Batches', 'isArchived', 'TINYINT(1) NOT NULL DEFAULT 0');
  await addColumn('Notifications', 'workspaceId', 'VARCHAR(191) NULL');
  await addColumn('Notifications', 'createdAt', 'DATETIME NULL DEFAULT CURRENT_TIMESTAMP');
  await addColumn('WorkspaceInvitations', 'batchId', 'VARCHAR(191) NULL');
  await addColumn('Assessments', 'workspaceId', 'VARCHAR(191) NULL');
  await addColumn('Assessments', 'createdByUserId', 'VARCHAR(191) NULL');
  await addColumn('Assessments', 'batchId', 'VARCHAR(191) NULL');
  await addColumn('Assessments', 'isArchived', 'TINYINT(1) NOT NULL DEFAULT 0');
  await addColumn('Assessments', 'updatedAt', 'DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
  await addColumn('Submissions', 'workspaceId', 'VARCHAR(191) NULL');
  await addColumn('InterviewRecords', 'workspaceId', 'VARCHAR(191) NULL');
  await addColumn('InterviewRecords', 'createdByUserId', 'VARCHAR(191) NULL');
  await addColumn('InterviewRecords', 'score', 'DOUBLE NULL');

  const [workspaceRows]: any = await pool.query('SELECT id FROM Workspaces ORDER BY createdAt LIMIT 1');
  let workspaceId: string;
  if (workspaceRows.length === 0) {
    workspaceId = randomUUID();
    await pool.execute(
      'INSERT INTO Workspaces (id, name, slug) VALUES (?, ?, ?)',
      [workspaceId, 'TalentEdge Demo College', `demo-${workspaceId.slice(0, 8)}`],
    );
  } else {
    workspaceId = workspaceRows[0].id;
  }

  await pool.execute('UPDATE Batches SET workspaceId = ? WHERE workspaceId IS NULL', [workspaceId]);
  await pool.execute('UPDATE Notifications SET workspaceId = ? WHERE workspaceId IS NULL', [workspaceId]);

  const [users]: any = await pool.query('SELECT id, role FROM Users');
  for (const user of users) {
    const role = user.role === 'admin' ? 'college_admin' : user.role;
    await pool.execute(
      `INSERT IGNORE INTO WorkspaceMemberships (id, workspaceId, userId, role)
       VALUES (?, ?, ?, ?)`,
      [randomUUID(), workspaceId, user.id, role],
    );
  }

  await pool.query(
    `INSERT IGNORE INTO WorkspaceStudentProfiles
     (workspaceId, userId, rollNo, phone, college, department, branch, trainerName,
      attendancePercent, currentDay, overallProgressPercent, placementReadinessScore,
      coding, aptitude, reasoning, sqlScore, csFundamentals, communication, techInterview, hrInterview, overallReadiness,
      eligibilityJson, weakAreasJson, strengthsJson, recentRemarksJson, batchId)
     SELECT wm.workspaceId, u.id, u.rollNo, u.phone, u.college, u.department, u.branch, u.trainerName,
      sp.attendancePercent, sp.currentDay, sp.overallProgressPercent, sp.placementReadinessScore,
      sp.coding, sp.aptitude, sp.reasoning, sp.sqlScore, sp.csFundamentals, sp.communication, sp.techInterview, sp.hrInterview, sp.overallReadiness,
      sp.eligibilityJson, sp.weakAreasJson, sp.strengthsJson, sp.recentRemarksJson, sp.batchId
     FROM StudentProfiles sp
     JOIN WorkspaceMemberships wm ON wm.userId = sp.id AND wm.role = 'student'
     JOIN Users u ON u.id = sp.id`,
  );

  await pool.query(
    `INSERT IGNORE INTO WorkspaceBatchAssignments (workspaceId, batchId, trainerUserId)
     SELECT b.workspaceId, b.id, u.id
     FROM Batches b
     JOIN Users u ON LOWER(TRIM(u.name)) = LOWER(TRIM(b.trainer))
     JOIN WorkspaceMemberships wm ON wm.workspaceId = b.workspaceId AND wm.userId = u.id AND wm.role = 'trainer'
     WHERE b.workspaceId IS NOT NULL`,
  );

  const [allWorkspaces]: any = await pool.query('SELECT id FROM Workspaces');
  for (const workspace of allWorkspaces) {
    const [assessmentRows]: any = await pool.execute('SELECT id FROM Assessments WHERE workspaceId = ? LIMIT 1', [workspace.id]);
    if (assessmentRows.length > 0) continue;
    for (const assessment of ASSESSMENTS_CATALOG) {
      await pool.execute(
        `INSERT INTO Assessments
         (id, workspaceId, dayNumber, title, type, durationMinutes, totalMarks, coverageJson, purpose, status, scheduledDate, sectionsJson, targetCompaniesJson)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `${workspace.id}:${assessment.id}`,
          workspace.id,
          assessment.dayNumber,
          assessment.title,
          assessment.type,
          assessment.durationMinutes,
          assessment.totalMarks,
          JSON.stringify(assessment.coverage),
          assessment.purpose,
          assessment.status,
          assessment.scheduledDate,
          JSON.stringify(assessment.sections),
          JSON.stringify(assessment.targetCompanies),
        ],
      );
    }
  }

  console.log(`Authentication and workspace schema is ready. Default workspace: ${workspaceId}`);
}

migrate()
  .catch((error) => {
    console.error('Authentication migration failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => pool.end());

