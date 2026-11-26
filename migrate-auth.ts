import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ASSESSMENTS_CATALOG } from './src/data/assessmentData';
import { SUBSCRIPTION_PLANS } from './src/types/subscriptions';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'talentedge',
  waitForConnections: true,
  connectionLimit: 4,
});

const MIGRATION_VERSION = '20261126_readiness_ai_governance_v1';
const MIGRATION_NAME = 'Readiness model evaluation and AI governance';

async function prepareMigrationLedger() {
  const migrationChecksum = createHash('sha256')
    .update(await readFile(fileURLToPath(import.meta.url)))
    .digest('hex');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS SchemaMigrations (
      version VARCHAR(64) PRIMARY KEY,
      name VARCHAR(191) NOT NULL,
      checksum CHAR(64) NOT NULL,
      appliedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const [rows]: any = await pool.execute(
    'SELECT checksum FROM SchemaMigrations WHERE version = ?',
    [MIGRATION_VERSION],
  );
  if (rows.length && rows[0].checksum !== migrationChecksum) {
    throw new Error(`Migration ${MIGRATION_VERSION} was already applied with a different checksum. Create a new migration version instead of editing an applied migration.`);
  }

  const [workspaceTable]: any = await pool.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Workspaces' LIMIT 1`,
  );
  if (!workspaceTable.length) return migrationChecksum;
  const [[workspaceCount]]: any = await pool.query('SELECT COUNT(*) AS count FROM Workspaces');
  if (Number(workspaceCount.count) < 2) return migrationChecksum;
  for (const table of ['Batches', 'Notifications', 'Assessments', 'Submissions', 'InterviewRecords']) {
    const [exists]: any = await pool.execute(
      `SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
      [table],
    );
    if (!exists.length) continue;
    const [hasScopeColumn]: any = await pool.execute(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'workspaceId' LIMIT 1`,
      [table],
    );
    const [[unscoped]]: any = hasScopeColumn.length
      ? await pool.query(`SELECT COUNT(*) AS count FROM \`${table}\` WHERE workspaceId IS NULL`)
      : await pool.query(`SELECT COUNT(*) AS count FROM \`${table}\``);
    if (Number(unscoped.count) > 0) {
      throw new Error(`Migration stopped before altering application tables: ${table} contains ${unscoped.count} rows without a workspace, and this database has multiple workspaces. Assign those rows to the correct workspace before retrying.`);
    }
  }
  return migrationChecksum;
}

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
  const migrationChecksum = await prepareMigrationLedger();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS Workspaces (
      id VARCHAR(191) PRIMARY KEY,
      name VARCHAR(191) NOT NULL,
      slug VARCHAR(191) NOT NULL UNIQUE,
      lifecycleStatus ENUM('onboarding', 'active', 'suspended', 'archived') NOT NULL DEFAULT 'active',
      statusReason VARCHAR(1000) NOT NULL DEFAULT '',
      lifecycleUpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addColumn('Workspaces', 'lifecycleStatus', "ENUM('onboarding', 'active', 'suspended', 'archived') NOT NULL DEFAULT 'active'");
  await addColumn('Workspaces', 'statusReason', "VARCHAR(1000) NOT NULL DEFAULT ''");
  await addColumn('Workspaces', 'lifecycleUpdatedAt', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS PlatformAdminAccounts (
      id VARCHAR(191) PRIMARY KEY,
      name VARCHAR(191) NOT NULL,
      email VARCHAR(191) NOT NULL UNIQUE,
      passwordHash VARCHAR(255) NOT NULL,
      totpSecretEncrypted VARCHAR(512) NOT NULL,
      isActive TINYINT(1) NOT NULL DEFAULT 1,
      createdByPlatformAdminId VARCHAR(191) NULL,
      lastLoginAt DATETIME NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_platform_admin_active (isActive, email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS PlatformAdminSessions (
      id VARCHAR(191) PRIMARY KEY,
      platformAdminId VARCHAR(191) NOT NULL,
      tokenHash CHAR(64) NOT NULL UNIQUE,
      expiresAt DATETIME NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_platform_session_expiry (expiresAt),
      CONSTRAINT fk_platform_session_admin FOREIGN KEY (platformAdminId) REFERENCES PlatformAdminAccounts(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS PlatformAdminInvitations (
      id VARCHAR(191) PRIMARY KEY,
      email VARCHAR(191) NOT NULL,
      tokenHash CHAR(64) NOT NULL UNIQUE,
      invitedByPlatformAdminId VARCHAR(191) NOT NULL,
      expiresAt DATETIME NOT NULL,
      acceptedAt DATETIME NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_platform_invite_email (email, acceptedAt),
      CONSTRAINT fk_platform_invitation_admin FOREIGN KEY (invitedByPlatformAdminId) REFERENCES PlatformAdminAccounts(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS PlatformAdminMfaResets (
      id VARCHAR(191) PRIMARY KEY,
      platformAdminId VARCHAR(191) NOT NULL,
      tokenHash CHAR(64) NOT NULL UNIQUE,
      requestedByPlatformAdminId VARCHAR(191) NOT NULL,
      reason VARCHAR(1000) NOT NULL,
      expiresAt DATETIME NOT NULL,
      usedAt DATETIME NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_platform_mfa_reset (platformAdminId, usedAt),
      CONSTRAINT fk_platform_mfa_reset_target FOREIGN KEY (platformAdminId) REFERENCES PlatformAdminAccounts(id) ON DELETE CASCADE,
      CONSTRAINT fk_platform_mfa_reset_requester FOREIGN KEY (requestedByPlatformAdminId) REFERENCES PlatformAdminAccounts(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS PlatformWorkspaceAdminInvitations (
      id VARCHAR(191) PRIMARY KEY,
      workspaceId VARCHAR(191) NOT NULL,
      email VARCHAR(191) NOT NULL,
      tokenHash CHAR(64) NOT NULL UNIQUE,
      invitedByPlatformAdminId VARCHAR(191) NOT NULL,
      expiresAt DATETIME NOT NULL,
      acceptedAt DATETIME NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_platform_workspace_invite (workspaceId, email, acceptedAt),
      CONSTRAINT fk_platform_workspace_invitation_workspace FOREIGN KEY (workspaceId) REFERENCES Workspaces(id) ON DELETE CASCADE,
      CONSTRAINT fk_platform_workspace_invitation_admin FOREIGN KEY (invitedByPlatformAdminId) REFERENCES PlatformAdminAccounts(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addColumn('PlatformWorkspaceAdminInvitations', 'revokedAt', 'DATETIME NULL');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS PlatformAuditEvents (
      id VARCHAR(191) PRIMARY KEY,
      platformAdminId VARCHAR(191) NULL,
      action VARCHAR(100) NOT NULL,
      targetType VARCHAR(50) NOT NULL,
      targetId VARCHAR(191) NULL,
      reason VARCHAR(1000) NOT NULL DEFAULT '',
      beforeJson JSON NULL,
      afterJson JSON NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_platform_audit_time (createdAt),
      KEY idx_platform_audit_target (targetType, targetId, createdAt),
      CONSTRAINT fk_platform_audit_admin FOREIGN KEY (platformAdminId) REFERENCES PlatformAdminAccounts(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS PlatformSharedContentVersions (
      id VARCHAR(191) PRIMARY KEY,
      versionNumber INT UNSIGNED NOT NULL UNIQUE,
      title VARCHAR(191) NOT NULL,
      status ENUM('draft', 'published') NOT NULL DEFAULT 'draft',
      contentJson MEDIUMTEXT NOT NULL,
      createdByPlatformAdminId VARCHAR(191) NULL,
      publishedByPlatformAdminId VARCHAR(191) NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      publishedAt DATETIME NULL,
      KEY idx_shared_content_status (status, versionNumber),
      CONSTRAINT fk_shared_content_creator FOREIGN KEY (createdByPlatformAdminId) REFERENCES PlatformAdminAccounts(id) ON DELETE SET NULL,
      CONSTRAINT fk_shared_content_publisher FOREIGN KEY (publishedByPlatformAdminId) REFERENCES PlatformAdminAccounts(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS PlatformSharedContentApplications (
      id VARCHAR(191) PRIMARY KEY,
      workspaceId VARCHAR(191) NOT NULL,
      versionId VARCHAR(191) NOT NULL,
      appliedByPlatformAdminId VARCHAR(191) NOT NULL,
      reason VARCHAR(1000) NOT NULL DEFAULT '',
      resultJson JSON NULL,
      appliedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      KEY idx_shared_content_apply_workspace (workspaceId, appliedAt),
      KEY idx_shared_content_apply_time (appliedAt),
      CONSTRAINT fk_shared_content_apply_workspace FOREIGN KEY (workspaceId) REFERENCES Workspaces(id) ON DELETE CASCADE,
      CONSTRAINT fk_shared_content_apply_version FOREIGN KEY (versionId) REFERENCES PlatformSharedContentVersions(id) ON DELETE CASCADE,
      CONSTRAINT fk_shared_content_apply_admin FOREIGN KEY (appliedByPlatformAdminId) REFERENCES PlatformAdminAccounts(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query('ALTER TABLE PlatformSharedContentApplications MODIFY COLUMN appliedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)');
  await addColumn('PlatformSharedContentApplications', 'reason', "VARCHAR(1000) NOT NULL DEFAULT ''");
  const [historyIndexes]: any = await pool.query(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PlatformSharedContentApplications'
       AND INDEX_NAME = 'idx_shared_content_apply_workspace' LIMIT 1`,
  );
  if (!historyIndexes.length) await pool.query('ALTER TABLE PlatformSharedContentApplications ADD KEY idx_shared_content_apply_workspace (workspaceId, appliedAt)');
  const [applicationIndexes]: any = await pool.query(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PlatformSharedContentApplications'
       AND INDEX_NAME = 'uq_shared_content_workspace_version' LIMIT 1`,
  );
  if (applicationIndexes.length) await pool.query('ALTER TABLE PlatformSharedContentApplications DROP INDEX uq_shared_content_workspace_version');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS WorkspaceMemberships (
      id VARCHAR(191) PRIMARY KEY,
      workspaceId VARCHAR(191) NOT NULL,
      userId VARCHAR(191) NOT NULL,
      role ENUM('college_admin', 'trainer', 'student', 'panelist') NOT NULL,
      status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_membership_workspace_user (workspaceId, userId),
      KEY idx_membership_user (userId),
      CONSTRAINT fk_membership_workspace FOREIGN KEY (workspaceId) REFERENCES Workspaces(id) ON DELETE CASCADE,
      CONSTRAINT fk_membership_user FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS WorkspaceCurriculumProgress (
      workspaceId VARCHAR(191) NOT NULL,
      studentUserId VARCHAR(191) NOT NULL,
      dayNumber TINYINT UNSIGNED NOT NULL,
      completedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (workspaceId, studentUserId, dayNumber),
      CONSTRAINT fk_curriculum_progress_membership
        FOREIGN KEY (workspaceId, studentUserId) REFERENCES WorkspaceMemberships(workspaceId, userId) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS WorkspaceCurriculumMaterials (
      id VARCHAR(191) PRIMARY KEY,
      workspaceId VARCHAR(191) NOT NULL,
      dayNumber TINYINT UNSIGNED NOT NULL,
      title VARCHAR(191) NOT NULL,
      materialType ENUM('video', 'text', 'pdf') NOT NULL,
      contentUrl TEXT NULL,
      contentText MEDIUMTEXT NULL,
      contentFormat ENUM('markdown', 'html') NOT NULL DEFAULT 'markdown',
      position INT UNSIGNED NOT NULL DEFAULT 0,
      isRequired TINYINT(1) NOT NULL DEFAULT 1,
      isArchived TINYINT(1) NOT NULL DEFAULT 0,
      createdByUserId VARCHAR(191) NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_curriculum_material_workspace_id (workspaceId, id),
      KEY idx_curriculum_material_day (workspaceId, dayNumber, position),
      CONSTRAINT fk_curriculum_material_workspace FOREIGN KEY (workspaceId) REFERENCES Workspaces(id) ON DELETE CASCADE,
      CONSTRAINT fk_curriculum_material_creator FOREIGN KEY (createdByUserId) REFERENCES Users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS WorkspaceCurriculumMaterialProgress (
      workspaceId VARCHAR(191) NOT NULL,
      studentUserId VARCHAR(191) NOT NULL,
      materialId VARCHAR(191) NOT NULL,
      status ENUM('not_started', 'in_progress', 'completed') NOT NULL DEFAULT 'not_started',
      videoPositionSeconds INT UNSIGNED NOT NULL DEFAULT 0,
      completedAt DATETIME NULL,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (workspaceId, studentUserId, materialId),
      KEY idx_curriculum_material_progress_material (workspaceId, materialId),
      CONSTRAINT fk_curriculum_material_progress_member FOREIGN KEY (workspaceId, studentUserId) REFERENCES WorkspaceMemberships(workspaceId, userId) ON DELETE CASCADE,
      CONSTRAINT fk_curriculum_material_progress_material FOREIGN KEY (workspaceId, materialId) REFERENCES WorkspaceCurriculumMaterials(workspaceId, id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS WorkspaceCurriculumLearningChecks (
      workspaceId VARCHAR(191) NOT NULL,
      dayNumber TINYINT UNSIGNED NOT NULL,
      title VARCHAR(191) NOT NULL,
      passingScore TINYINT UNSIGNED NOT NULL DEFAULT 70,
      questionsJson MEDIUMTEXT NOT NULL,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (workspaceId, dayNumber),
      CONSTRAINT fk_curriculum_check_workspace FOREIGN KEY (workspaceId) REFERENCES Workspaces(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS WorkspaceCurriculumLearningCheckAttempts (
      id VARCHAR(191) PRIMARY KEY,
      workspaceId VARCHAR(191) NOT NULL,
      studentUserId VARCHAR(191) NOT NULL,
      dayNumber TINYINT UNSIGNED NOT NULL,
      score TINYINT UNSIGNED NOT NULL,
      questionCount TINYINT UNSIGNED NOT NULL,
      passed TINYINT(1) NOT NULL,
      answersJson TEXT NOT NULL,
      submittedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_curriculum_check_attempts_student (workspaceId, studentUserId, dayNumber, submittedAt),
      CONSTRAINT fk_curriculum_check_attempt_member FOREIGN KEY (workspaceId, studentUserId) REFERENCES WorkspaceMemberships(workspaceId, userId) ON DELETE CASCADE
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
      role ENUM('college_admin', 'trainer', 'student', 'panelist') NOT NULL,
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
    CREATE TABLE IF NOT EXISTS WorkspaceSettings (
      workspaceId VARCHAR(191) PRIMARY KEY,
      settingsJson MEDIUMTEXT NOT NULL,
      updatedByUserId VARCHAR(191) NULL,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_workspace_settings_workspace FOREIGN KEY (workspaceId) REFERENCES Workspaces(id) ON DELETE CASCADE,
      CONSTRAINT fk_workspace_settings_updater FOREIGN KEY (updatedByUserId) REFERENCES Users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS PlatformSubscriptionPlans (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      description VARCHAR(1000) NOT NULL DEFAULT '',
      limitsJson JSON NOT NULL,
      featuresJson JSON NOT NULL,
      isActive TINYINT(1) NOT NULL DEFAULT 1,
      updatedByPlatformAdminId VARCHAR(191) NULL,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_subscription_plan_updater FOREIGN KEY (updatedByPlatformAdminId) REFERENCES PlatformAdminAccounts(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS WorkspaceSubscriptions (
      workspaceId VARCHAR(191) PRIMARY KEY,
      planId VARCHAR(64) NOT NULL DEFAULT 'pilot',
      status ENUM('not_configured', 'trialing', 'active', 'past_due', 'canceled', 'suspended') NOT NULL DEFAULT 'not_configured',
      billingInterval ENUM('monthly', 'annual') NOT NULL DEFAULT 'monthly',
      currency CHAR(3) NOT NULL DEFAULT 'INR',
      currentPeriodStart DATETIME NULL,
      currentPeriodEnd DATETIME NULL,
      trialEndsAt DATETIME NULL,
      cancelAtPeriodEnd TINYINT(1) NOT NULL DEFAULT 0,
      internalNote TEXT NULL,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_workspace_subscription_workspace FOREIGN KEY (workspaceId) REFERENCES Workspaces(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query("ALTER TABLE WorkspaceSubscriptions MODIFY COLUMN planId VARCHAR(64) NOT NULL DEFAULT 'pilot'");
  await addColumn('WorkspaceSubscriptions', 'internalNote', 'TEXT NULL');
  for (const plan of SUBSCRIPTION_PLANS) {
    await pool.execute(
      `INSERT IGNORE INTO PlatformSubscriptionPlans (id, name, description, limitsJson, featuresJson, isActive)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [plan.id, plan.name, plan.description, JSON.stringify(plan.limits), JSON.stringify(plan.features)],
    );
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS WorkspaceAiUsage (
      workspaceId VARCHAR(191) NOT NULL,
      periodStart DATE NOT NULL,
      creditsUsed INT UNSIGNED NOT NULL DEFAULT 0,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (workspaceId, periodStart),
      CONSTRAINT fk_workspace_ai_usage_workspace FOREIGN KEY (workspaceId) REFERENCES Workspaces(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS WorkspaceInterviewPanelists (
      id VARCHAR(191) PRIMARY KEY,
      workspaceId VARCHAR(191) NOT NULL,
      name VARCHAR(191) NOT NULL,
      email VARCHAR(191) NULL,
      userId VARCHAR(191) NULL,
      designation VARCHAR(191) NOT NULL DEFAULT '',
      specialties VARCHAR(500) NOT NULL DEFAULT '',
      isActive TINYINT(1) NOT NULL DEFAULT 1,
      createdByUserId VARCHAR(191) NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_panelist_workspace_name (workspaceId, name),
      UNIQUE KEY uq_panelist_workspace_user (workspaceId, userId),
      KEY idx_panelist_workspace_active (workspaceId, isActive, name),
      CONSTRAINT fk_panelist_workspace FOREIGN KEY (workspaceId) REFERENCES Workspaces(id) ON DELETE CASCADE,
      CONSTRAINT fk_panelist_creator FOREIGN KEY (createdByUserId) REFERENCES Users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS WorkspaceUserNotifications (
      id VARCHAR(191) PRIMARY KEY,
      workspaceId VARCHAR(191) NOT NULL,
      userId VARCHAR(191) NOT NULL,
      notificationType VARCHAR(50) NOT NULL,
      title VARCHAR(191) NOT NULL,
      description TEXT NOT NULL,
      relatedEntityId VARCHAR(191) NULL,
      readAt DATETIME NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_user_notification_inbox (workspaceId, userId, readAt, createdAt),
      CONSTRAINT fk_user_notification_membership FOREIGN KEY (workspaceId, userId) REFERENCES WorkspaceMemberships(workspaceId, userId) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS WorkspaceInterviewSchedules (
      id VARCHAR(191) PRIMARY KEY,
      workspaceId VARCHAR(191) NOT NULL,
      studentUserId VARCHAR(191) NOT NULL,
      interviewType ENUM('tech', 'hr') NOT NULL,
      scheduledAt DATETIME NOT NULL,
      durationMinutes SMALLINT UNSIGNED NOT NULL DEFAULT 30,
      panelist VARCHAR(191) NOT NULL,
      panelistId VARCHAR(191) NULL,
      location VARCHAR(500) NOT NULL DEFAULT '',
      notes TEXT NULL,
      status ENUM('scheduled', 'completed', 'cancelled') NOT NULL DEFAULT 'scheduled',
      createdByUserId VARCHAR(191) NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_interview_schedule_workspace_time (workspaceId, status, scheduledAt),
      KEY idx_interview_schedule_student (workspaceId, studentUserId, scheduledAt),
      CONSTRAINT fk_interview_schedule_workspace FOREIGN KEY (workspaceId) REFERENCES Workspaces(id) ON DELETE CASCADE,
      CONSTRAINT fk_interview_schedule_student FOREIGN KEY (workspaceId, studentUserId) REFERENCES WorkspaceMemberships(workspaceId, userId) ON DELETE CASCADE,
      CONSTRAINT fk_interview_schedule_creator FOREIGN KEY (createdByUserId) REFERENCES Users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addColumn('WorkspaceInterviewSchedules', 'panelistId', 'VARCHAR(191) NULL');
  await addColumn('WorkspaceInterviewPanelists', 'userId', 'VARCHAR(191) NULL');
  await addColumn('InterviewRecords', 'scheduleId', 'VARCHAR(191) NULL');
  await pool.query("ALTER TABLE WorkspaceInterviewSchedules MODIFY COLUMN status ENUM('scheduled', 'completed', 'cancelled') NOT NULL DEFAULT 'scheduled'");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS WorkspaceInterviewFollowUps (
      id VARCHAR(191) PRIMARY KEY,
      workspaceId VARCHAR(191) NOT NULL,
      scheduleId VARCHAR(191) NOT NULL,
      outcome ENUM('needs_another_interview', 'referred_for_placement', 'offer_confirmed', 'no_further_action') NOT NULL,
      notes TEXT NULL,
      studentNotes TEXT NULL,
      updatedByUserId VARCHAR(191) NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_interview_followup_schedule (workspaceId, scheduleId),
      KEY idx_interview_followup_outcome (workspaceId, outcome),
      CONSTRAINT fk_interview_followup_workspace FOREIGN KEY (workspaceId) REFERENCES Workspaces(id) ON DELETE CASCADE,
      CONSTRAINT fk_interview_followup_schedule FOREIGN KEY (scheduleId) REFERENCES WorkspaceInterviewSchedules(id) ON DELETE CASCADE,
      CONSTRAINT fk_interview_followup_editor FOREIGN KEY (updatedByUserId) REFERENCES Users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addColumn('WorkspaceInterviewFollowUps', 'studentNotes', 'TEXT NULL');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS WorkspaceInterviewFollowUpHistory (
      id VARCHAR(191) PRIMARY KEY,
      workspaceId VARCHAR(191) NOT NULL,
      scheduleId VARCHAR(191) NOT NULL,
      outcome ENUM('needs_another_interview', 'referred_for_placement', 'offer_confirmed', 'no_further_action') NOT NULL,
      notes TEXT NULL,
      studentNotes TEXT NULL,
      updatedByUserId VARCHAR(191) NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_interview_followup_history (workspaceId, scheduleId, createdAt),
      CONSTRAINT fk_interview_followup_history_workspace FOREIGN KEY (workspaceId) REFERENCES Workspaces(id) ON DELETE CASCADE,
      CONSTRAINT fk_interview_followup_history_schedule FOREIGN KEY (scheduleId) REFERENCES WorkspaceInterviewSchedules(id) ON DELETE CASCADE,
      CONSTRAINT fk_interview_followup_history_editor FOREIGN KEY (updatedByUserId) REFERENCES Users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    INSERT INTO WorkspaceInterviewFollowUpHistory (id, workspaceId, scheduleId, outcome, notes, studentNotes, updatedByUserId, createdAt)
    SELECT UUID(), f.workspaceId, f.scheduleId, f.outcome, f.notes, f.studentNotes, f.updatedByUserId, f.updatedAt
    FROM WorkspaceInterviewFollowUps f
    WHERE NOT EXISTS (
      SELECT 1 FROM WorkspaceInterviewFollowUpHistory h
      WHERE h.workspaceId = f.workspaceId AND h.scheduleId = f.scheduleId
    )
  `);
  await pool.query("ALTER TABLE WorkspaceMemberships MODIFY COLUMN role ENUM('college_admin', 'trainer', 'student', 'panelist') NOT NULL");
  await pool.query("ALTER TABLE WorkspaceInvitations MODIFY COLUMN role ENUM('college_admin', 'trainer', 'student', 'panelist') NOT NULL");
  const [panelistAccountIndex]: any = await pool.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'WorkspaceInterviewPanelists' AND INDEX_NAME = 'uq_panelist_workspace_user' LIMIT 1`,
  );
  if (!panelistAccountIndex.length) await pool.query('ALTER TABLE WorkspaceInterviewPanelists ADD UNIQUE KEY uq_panelist_workspace_user (workspaceId, userId)');
  const [scheduleEvaluationIndex]: any = await pool.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'InterviewRecords' AND INDEX_NAME = 'uq_interview_record_schedule' LIMIT 1`,
  );
  if (!scheduleEvaluationIndex.length) await pool.query('ALTER TABLE InterviewRecords ADD UNIQUE KEY uq_interview_record_schedule (workspaceId, scheduleId)');
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
  // Profile pictures are stored as small, resized data URLs so local deployments need no file service.
  await pool.query('ALTER TABLE Users MODIFY COLUMN avatar MEDIUMTEXT NULL');
  await addColumn('Batches', 'workspaceId', 'VARCHAR(191) NULL');
  await addColumn('Batches', 'isArchived', 'TINYINT(1) NOT NULL DEFAULT 0');
  await addColumn('Notifications', 'workspaceId', 'VARCHAR(191) NULL');
  await addColumn('Notifications', 'createdAt', 'DATETIME NULL DEFAULT CURRENT_TIMESTAMP');
  await addColumn('WorkspaceInvitations', 'batchId', 'VARCHAR(191) NULL');
  await addColumn('WorkspaceCurriculumMaterials', 'contentFormat', "ENUM('markdown', 'html') NOT NULL DEFAULT 'markdown'");
  await addColumn('WorkspaceCurriculumMaterials', 'sourceContentId', 'VARCHAR(191) NULL');
  await addColumn('WorkspaceCurriculumMaterials', 'sourceVersionId', 'VARCHAR(191) NULL');
  await addColumn('WorkspaceCurriculumMaterials', 'isCustomized', 'TINYINT(1) NOT NULL DEFAULT 0');
  await addColumn('WorkspaceCurriculumMaterials', 'isArchived', 'TINYINT(1) NOT NULL DEFAULT 0');
  await addColumn('Assessments', 'workspaceId', 'VARCHAR(191) NULL');
  await addColumn('Assessments', 'createdByUserId', 'VARCHAR(191) NULL');
  await addColumn('Assessments', 'batchId', 'VARCHAR(191) NULL');
  await addColumn('Assessments', 'isArchived', 'TINYINT(1) NOT NULL DEFAULT 0');
  await addColumn('Assessments', 'updatedAt', 'DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
  await addColumn('Assessments', 'sourceContentId', 'VARCHAR(191) NULL');
  await addColumn('Assessments', 'sourceVersionId', 'VARCHAR(191) NULL');
  await addColumn('Assessments', 'isCustomized', 'TINYINT(1) NOT NULL DEFAULT 0');
  await addColumn('Assessments', 'currentVersion', 'INT UNSIGNED NOT NULL DEFAULT 1');
  await addColumn('Assessments', 'passPercent', 'TINYINT UNSIGNED NOT NULL DEFAULT 70');
  await addColumn('Assessments', 'maxAttempts', 'INT UNSIGNED NOT NULL DEFAULT 0');
  await addColumn('Assessments', 'availableAt', 'DATETIME NULL');
  await addColumn('Assessments', 'dueAt', 'DATETIME NULL');
  await addColumn('Assessments', 'allowLateSubmission', 'TINYINT(1) NOT NULL DEFAULT 0');
  await addColumn('Assessments', 'resultReleasePolicy', "ENUM('immediate', 'after_due', 'manual') NOT NULL DEFAULT 'immediate'");
  for (const [table, indexName] of [['WorkspaceCurriculumMaterials', 'uq_curriculum_shared_source'], ['Assessments', 'uq_assessment_shared_source']] as const) {
    const [indexes]: any = await pool.query(`SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`, [table, indexName]);
    if (!indexes.length) await pool.query(`ALTER TABLE \`${table}\` ADD UNIQUE KEY \`${indexName}\` (workspaceId, sourceContentId)`);
  }

  const initialSharedContent = JSON.stringify({
    schemaVersion: 1,
    materials: [],
    assessmentTemplates: ASSESSMENTS_CATALOG,
    enabledAssessmentIds: ASSESSMENTS_CATALOG.map((assessment) => assessment.id),
  });
  await pool.execute(
    `INSERT IGNORE INTO PlatformSharedContentVersions (id, versionNumber, title, status, contentJson)
     VALUES ('platform-content-v1', 1, 'Initial shared sample assessment library', 'draft', ?)`,
    [initialSharedContent],
  );
  await addColumn('Submissions', 'workspaceId', 'VARCHAR(191) NULL');
  await addColumn('Submissions', 'assessmentVersion', 'INT UNSIGNED NOT NULL DEFAULT 1');
  await addColumn('Submissions', 'attemptNumber', 'INT UNSIGNED NOT NULL DEFAULT 1');
  await addColumn('Submissions', 'gradingStatus', "ENUM('auto_graded', 'pending_review', 'reviewed') NOT NULL DEFAULT 'auto_graded'");
  await addColumn('Submissions', 'resultReleased', 'TINYINT(1) NOT NULL DEFAULT 1');
  await addColumn('Submissions', 'feedbackJson', 'MEDIUMTEXT NULL');
  await addColumn('Submissions', 'codingAnswersJson', 'MEDIUMTEXT NULL');
  await addColumn('Submissions', 'gradedByUserId', 'VARCHAR(191) NULL');
  await addColumn('Submissions', 'gradedAt', 'DATETIME NULL');
  await addColumn('Submissions', 'clientRequestId', 'VARCHAR(64) NULL');
  const [submissionIdempotencyIndex]: any = await pool.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'Submissions' AND INDEX_NAME = 'uq_submission_request' LIMIT 1`,
  );
  if (!submissionIdempotencyIndex.length) {
    await pool.query('ALTER TABLE Submissions ADD UNIQUE KEY uq_submission_request (workspaceId, studentId, clientRequestId)');
  }
  await addColumn('InterviewRecords', 'workspaceId', 'VARCHAR(191) NULL');
  await addColumn('InterviewRecords', 'createdByUserId', 'VARCHAR(191) NULL');
  await addColumn('InterviewRecords', 'score', 'DOUBLE NULL');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS AssessmentVersions (
      id VARCHAR(191) PRIMARY KEY,
      workspaceId VARCHAR(191) NOT NULL,
      assessmentId VARCHAR(191) NOT NULL,
      versionNumber INT UNSIGNED NOT NULL,
      snapshotJson MEDIUMTEXT NOT NULL,
      changeSummary VARCHAR(500) NOT NULL DEFAULT '',
      createdByUserId VARCHAR(191) NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_assessment_version (workspaceId, assessmentId, versionNumber),
      KEY idx_assessment_versions_created (workspaceId, assessmentId, createdAt),
      CONSTRAINT fk_assessment_version_workspace FOREIGN KEY (workspaceId) REFERENCES Workspaces(id) ON DELETE CASCADE,
      CONSTRAINT fk_assessment_version_assessment FOREIGN KEY (assessmentId) REFERENCES Assessments(id) ON DELETE CASCADE,
      CONSTRAINT fk_assessment_version_creator FOREIGN KEY (createdByUserId) REFERENCES Users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS AssessmentAssignmentRules (
      assessmentId VARCHAR(191) PRIMARY KEY,
      workspaceId VARCHAR(191) NOT NULL,
      batchId VARCHAR(191) NULL,
      maxAttempts INT UNSIGNED NOT NULL DEFAULT 0,
      availableAt DATETIME NULL,
      dueAt DATETIME NULL,
      allowLateSubmission TINYINT(1) NOT NULL DEFAULT 0,
      resultReleasePolicy ENUM('immediate', 'after_due', 'manual') NOT NULL DEFAULT 'immediate',
      updatedByUserId VARCHAR(191) NULL,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_assessment_assignment_scope (workspaceId, batchId),
      CONSTRAINT fk_assessment_assignment_workspace FOREIGN KEY (workspaceId) REFERENCES Workspaces(id) ON DELETE CASCADE,
      CONSTRAINT fk_assessment_assignment_assessment FOREIGN KEY (assessmentId) REFERENCES Assessments(id) ON DELETE CASCADE,
      CONSTRAINT fk_assessment_assignment_batch FOREIGN KEY (batchId) REFERENCES Batches(id) ON DELETE SET NULL,
      CONSTRAINT fk_assessment_assignment_editor FOREIGN KEY (updatedByUserId) REFERENCES Users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ReadinessPredictionEvents (
      id VARCHAR(191) PRIMARY KEY,
      workspaceId VARCHAR(191) NOT NULL,
      studentId VARCHAR(191) NOT NULL,
      modelVersion VARCHAR(64) NOT NULL,
      readinessScore TINYINT UNSIGNED NOT NULL,
      predictedTier ENUM('high', 'moderate', 'needs_attention') NOT NULL,
      predictedReady TINYINT(1) NOT NULL,
      targetCompany VARCHAR(120) NULL,
      evidenceJson MEDIUMTEXT NOT NULL,
      actualOutcome ENUM('placed', 'not_placed') NULL,
      outcomeRecordedAt DATETIME NULL,
      outcomeRecordedBy VARCHAR(191) NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_readiness_prediction_eval (workspaceId, modelVersion, actualOutcome, createdAt),
      KEY idx_readiness_prediction_student (workspaceId, studentId, createdAt),
      CONSTRAINT fk_readiness_prediction_workspace FOREIGN KEY (workspaceId) REFERENCES Workspaces(id) ON DELETE CASCADE,
      CONSTRAINT fk_readiness_prediction_student FOREIGN KEY (studentId) REFERENCES Users(id) ON DELETE CASCADE,
      CONSTRAINT fk_readiness_prediction_outcome_actor FOREIGN KEY (outcomeRecordedBy) REFERENCES Users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

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
  await pool.execute('UPDATE Assessments SET workspaceId = ? WHERE workspaceId IS NULL', [workspaceId]);
  await pool.execute('UPDATE Submissions SET workspaceId = ? WHERE workspaceId IS NULL', [workspaceId]);
  await pool.execute('UPDATE InterviewRecords SET workspaceId = ? WHERE workspaceId IS NULL', [workspaceId]);

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
    await pool.execute('INSERT IGNORE INTO WorkspaceSubscriptions (workspaceId) VALUES (?)', [workspace.id]);
    await pool.execute(
      `INSERT IGNORE INTO WorkspaceInterviewPanelists (id, workspaceId, name)
       SELECT UUID(), workspaceId, MAX(TRIM(panelist)) FROM WorkspaceInterviewSchedules
       WHERE workspaceId = ? AND TRIM(panelist) <> ''
       GROUP BY workspaceId, LOWER(TRIM(panelist))`,
      [workspace.id],
    );
    await pool.execute(
      `UPDATE WorkspaceInterviewSchedules s
       JOIN WorkspaceInterviewPanelists p ON p.workspaceId = s.workspaceId
         AND LOWER(TRIM(p.name)) = LOWER(TRIM(s.panelist))
       SET s.panelistId = p.id WHERE s.workspaceId = ? AND s.panelistId IS NULL`,
      [workspace.id],
    );
    for (const assessment of ASSESSMENTS_CATALOG) {
      const canonicalAssessmentId = `${workspace.id}:${assessment.id}`;
      await pool.execute(
        `UPDATE Assessments SET sourceContentId = ?, isCustomized = 1
         WHERE id = ? AND workspaceId = ? AND sourceContentId IS NULL`,
        [assessment.id, canonicalAssessmentId, workspace.id],
      );
    }
    const [workspaceAssessments]: any = await pool.execute('SELECT id FROM Assessments WHERE workspaceId = ?', [workspace.id]);
    const existingAssessmentIds = new Set(workspaceAssessments.map((assessment: { id: string }) => assessment.id));
    for (const assessment of ASSESSMENTS_CATALOG) {
      const assessmentId = `${workspace.id}:${assessment.id}`;
      if (existingAssessmentIds.has(assessmentId)) continue;
      await pool.execute(
        `INSERT IGNORE INTO Assessments
         (id, workspaceId, dayNumber, title, type, durationMinutes, totalMarks, coverageJson, purpose, status, scheduledDate, sectionsJson, targetCompaniesJson, sourceContentId, isCustomized)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          assessmentId,
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
          assessment.id,
        ],
      );
    }
    await pool.execute(
      `INSERT IGNORE INTO AssessmentAssignmentRules
       (assessmentId, workspaceId, batchId, maxAttempts, availableAt, dueAt, allowLateSubmission, resultReleasePolicy)
       SELECT id, workspaceId, batchId, maxAttempts, availableAt, dueAt, allowLateSubmission, resultReleasePolicy
       FROM Assessments WHERE workspaceId = ?`,
      [workspace.id],
    );
    await pool.execute(
      `INSERT IGNORE INTO AssessmentVersions
       (id, workspaceId, assessmentId, versionNumber, snapshotJson, changeSummary, createdByUserId)
       SELECT UUID(), workspaceId, id, currentVersion,
         JSON_OBJECT('title', title, 'dayNumber', dayNumber, 'type', type, 'durationMinutes', durationMinutes,
           'totalMarks', totalMarks, 'passPercent', passPercent, 'coverageJson', coverageJson, 'purpose', purpose, 'status', status,
           'scheduledDate', scheduledDate, 'sections', CASE WHEN JSON_VALID(sectionsJson) THEN JSON_EXTRACT(sectionsJson, '$') ELSE JSON_ARRAY() END, 'targetCompaniesJson', targetCompaniesJson,
           'batchId', batchId, 'currentVersion', currentVersion, 'maxAttempts', maxAttempts,
           'availableAt', availableAt, 'dueAt', dueAt, 'allowLateSubmission', allowLateSubmission,
           'resultReleasePolicy', resultReleasePolicy),
         'Baseline snapshot', createdByUserId
       FROM Assessments WHERE workspaceId = ?`,
      [workspace.id],
    );
  }

  console.log(`Authentication and workspace schema is ready. Default workspace: ${workspaceId}`);
  await pool.execute(
    'INSERT IGNORE INTO SchemaMigrations (version, name, checksum) VALUES (?, ?, ?)',
    [MIGRATION_VERSION, MIGRATION_NAME, migrationChecksum],
  );
}

async function runMigration() {
  const lockName = `talentedge:migrate:${process.env.DB_NAME || 'talentedge'}`;
  const [lockRows]: any = await pool.execute('SELECT GET_LOCK(?, 30) AS acquired', [lockName]);
  if (Number(lockRows?.[0]?.acquired) !== 1) {
    throw new Error('Could not acquire the database migration lock within 30 seconds.');
  }
  try {
    await migrate();
  } finally {
    await pool.execute('SELECT RELEASE_LOCK(?)', [lockName]);
  }
}

runMigration()
  .catch((error) => {
    console.error('Authentication migration failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => pool.end());

