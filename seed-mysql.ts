import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { SAMPLE_STUDENTS, INITIAL_USERS, DEMO_BATCHES } from './src/data/mockData';

dotenv.config();

async function seed() {
  const host = process.env.DB_HOST || 'localhost';
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME || 'talentedge';

  console.log(`Connecting to MySQL database '${database}' on '${host}'...`);
  
  const connection = await mysql.createConnection({
    host,
    user,
    password,
    database
  });

  try {
    const [workspaceRows]: any = await connection.query('SELECT id FROM Workspaces ORDER BY createdAt LIMIT 1');
    if (!workspaceRows.length) throw new Error('No workspace found. Run npm run db:migrate-auth first.');
    const workspaceId = workspaceRows[0].id;
    console.log('Cleaning existing tables...');
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    await connection.query('TRUNCATE TABLE WorkspaceInvitations');
    await connection.query('TRUNCATE TABLE WorkspacePasswordResets');
    await connection.query('TRUNCATE TABLE AuthSessions');
    await connection.query('TRUNCATE TABLE WorkspaceAuditEvents');
    await connection.query('TRUNCATE TABLE WorkspaceBatchAssignments');
    await connection.query('TRUNCATE TABLE WorkspaceStudentProfiles');
    await connection.query('TRUNCATE TABLE WorkspaceMemberships');
    await connection.query('TRUNCATE TABLE StudentProfiles');
    await connection.query('TRUNCATE TABLE Users');
    await connection.query('TRUNCATE TABLE Batches');
    await connection.query('TRUNCATE TABLE Notifications');
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');

    console.log('Seeding batches...');
    for (const batch of DEMO_BATCHES) {
      await connection.execute(
        `INSERT INTO Batches (id, name, college, trainer, totalStudents, readyCount, atRiskCount, averageScore, currentDay, startDate, completionDate, attendanceRate, workspaceId)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name=VALUES(name), college=VALUES(college), trainer=VALUES(trainer), workspaceId=VALUES(workspaceId)`,
        [
          batch.id,
          batch.name,
          batch.college,
          batch.trainer,
          batch.totalStudents,
          batch.readyCount,
          batch.atRiskCount,
          batch.averageScore,
          batch.currentDay,
          batch.startDate,
          batch.completionDate,
          batch.attendanceRate,
          workspaceId,
        ]
      );
    }

    console.log('Seeding users...');
    for (const u of INITIAL_USERS) {
      if (u.role === 'student') continue; // Skip to avoid ID/email duplicate conflicts with SAMPLE_STUDENTS
      await connection.execute(
        `INSERT INTO Users (id, name, email, role, avatar, phone, rollNo, college, department, branch, batchId, trainerName)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name=VALUES(name), role=VALUES(role), avatar=VALUES(avatar)`,
        [
          u.id,
          u.name,
          u.email,
          u.role,
          u.avatar,
          u.phone || null,
          u.rollNo || null,
          u.college || null,
          u.department || null,
          u.branch || null,
          u.batchId || null,
          u.trainerName || null
        ]
      );
      await connection.execute(
        'INSERT INTO WorkspaceMemberships (id, workspaceId, userId, role) VALUES (?, ?, ?, ?) ',
        [`seed-membership-${u.id}`, workspaceId, u.id, u.role === 'admin' ? 'college_admin' : u.role],
      );
    }

    console.log('Seeding student profiles...');
    for (const student of SAMPLE_STUDENTS) {
      // First ensure the student exists in the Users table to satisfy foreign key constraints
      await connection.execute(
        `INSERT INTO Users (id, name, email, role, avatar, phone, rollNo, college, department, branch, batchId, trainerName)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name=VALUES(name), email=VALUES(email)`,
        [
          student.id,
          student.name,
          student.email,
          'student',
          student.photo,
          student.phone,
          student.rollNo,
          student.college,
          student.department,
          student.branch,
          student.batch ? 'batch-1' : null,
          student.trainer
        ]
      );
      await connection.execute(
        `INSERT INTO WorkspaceMemberships (id, workspaceId, userId, role) VALUES (?, ?, ?, 'student')`,
        [`seed-membership-${student.id}`, workspaceId, student.id],
      );

      await connection.execute(
        `INSERT INTO StudentProfiles (
          id, attendancePercent, currentDay, overallProgressPercent, placementReadinessScore,
          coding, aptitude, reasoning, sqlScore, csFundamentals, communication, techInterview, hrInterview, overallReadiness,
          eligibilityJson, weakAreasJson, strengthsJson, recentRemarksJson, batchId
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE attendancePercent=VALUES(attendancePercent), placementReadinessScore=VALUES(placementReadinessScore)`,
        [
          student.id,
          student.attendancePercent,
          student.currentDay,
          student.overallProgressPercent,
          student.placementReadinessScore,
          student.metrics.coding,
          student.metrics.aptitude,
          student.metrics.reasoning,
          student.metrics.sql,
          student.metrics.csFundamentals,
          student.metrics.communication,
          student.metrics.techInterview,
          student.metrics.hrInterview,
          student.metrics.overallReadiness,
          JSON.stringify(student.eligibility),
          JSON.stringify(student.weakAreas),
          JSON.stringify(student.strengths),
          JSON.stringify(student.recentRemarks),
          student.batch ? 'batch-1' : null
        ]
      );
      await connection.execute(
        `INSERT INTO WorkspaceStudentProfiles (
          workspaceId, userId, rollNo, phone, college, department, branch, trainerName,
          attendancePercent, currentDay, overallProgressPercent, placementReadinessScore,
          coding, aptitude, reasoning, sqlScore, csFundamentals, communication, techInterview, hrInterview, overallReadiness,
          eligibilityJson, weakAreasJson, strengthsJson, recentRemarksJson, batchId
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE batchId=VALUES(batchId), placementReadinessScore=VALUES(placementReadinessScore)`,
        [
          workspaceId,
          student.id,
          student.rollNo,
          student.phone,
          student.college,
          student.department,
          student.branch,
          student.trainer,
          student.attendancePercent,
          student.currentDay,
          student.overallProgressPercent,
          student.placementReadinessScore,
          student.metrics.coding,
          student.metrics.aptitude,
          student.metrics.reasoning,
          student.metrics.sql,
          student.metrics.csFundamentals,
          student.metrics.communication,
          student.metrics.techInterview,
          student.metrics.hrInterview,
          student.metrics.overallReadiness,
          JSON.stringify(student.eligibility),
          JSON.stringify(student.weakAreas),
          JSON.stringify(student.strengths),
          JSON.stringify(student.recentRemarks),
          student.batch ? 'batch-1' : null,
        ],
      );
    }

    await connection.query(
      `INSERT IGNORE INTO WorkspaceBatchAssignments (workspaceId, batchId, trainerUserId)
       SELECT b.workspaceId, b.id, u.id
       FROM Batches b
       JOIN Users u ON LOWER(TRIM(u.name)) = LOWER(TRIM(b.trainer))
       JOIN WorkspaceMemberships wm ON wm.workspaceId = b.workspaceId AND wm.userId = u.id AND wm.role = 'trainer'
       WHERE b.workspaceId = ?`,
      [workspaceId],
    );

    const mockNotifications = [
      {
        id: 'n1',
        title: 'Day 40 Final Placement Simulation Live',
        time: '10 minutes ago',
        desc: '3-Hour capstone test is now active for all batches.',
        unread: 1,
      },
      {
        id: 'n2',
        title: 'TCS NQT Drive Benchmark Updated',
        time: '1 hour ago',
        desc: 'Your coding score (92%) qualifies for TCS Digital shortlist.',
        unread: 1,
      },
      {
        id: 'n3',
        title: 'Technical Mock Interview Scheduled',
        time: 'Yesterday',
        desc: 'Panel session completed with Prof. Rajesh Sharma. Score: 88%.',
        unread: 0,
      },
    ];

    console.log('Seeding notifications...');
    for (const notif of mockNotifications) {
      await connection.execute(
        `INSERT INTO Notifications (id, title, time, \`desc\`, unread, workspaceId)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE title=VALUES(title), workspaceId=VALUES(workspaceId)`,
        [notif.id, notif.title, notif.time, notif.desc, notif.unread, workspaceId]
      );
    }

    console.log('Database seeded successfully!');
  } catch (error) {
    console.error('Error seeding database:', error);
  } finally {
    await connection.end();
  }
}

seed();
