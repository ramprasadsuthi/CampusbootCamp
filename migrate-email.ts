import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

dotenv.config();
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'talentedge', waitForConnections: true, connectionLimit: 4,
});
const version = '20261126_account_email_delivery_v1';

async function migrate() {
  const checksum = createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex');
  await pool.query(`CREATE TABLE IF NOT EXISTS SchemaMigrations (
    version VARCHAR(64) PRIMARY KEY, name VARCHAR(191) NOT NULL, checksum CHAR(64) NOT NULL,
    appliedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  const [applied]: any = await pool.execute('SELECT checksum FROM SchemaMigrations WHERE version = ?', [version]);
  if (applied.length && applied[0].checksum !== checksum) throw new Error(`Migration ${version} checksum changed. Create a new version.`);
  const lockName = `talentedge:migrate:${process.env.DB_NAME || 'talentedge'}`;
  const [lock]: any = await pool.execute('SELECT GET_LOCK(?, 30) AS acquired', [lockName]);
  if (Number(lock[0]?.acquired) !== 1) throw new Error('Could not acquire the database migration lock.');
  try {
    await pool.query('ALTER TABLE WorkspacePasswordResets MODIFY COLUMN createdByUserId VARCHAR(191) NULL');
    await pool.query(`CREATE TABLE IF NOT EXISTS AccountEmailDeliveries (
      id VARCHAR(191) PRIMARY KEY, workspaceId VARCHAR(191) NULL, recipientEmail VARCHAR(191) NOT NULL,
      deliveryType VARCHAR(64) NOT NULL, relatedEntityId VARCHAR(191) NULL,
      status ENUM('queued','sent','failed','not_configured') NOT NULL DEFAULT 'queued',
      providerMessageId VARCHAR(191) NULL, lastError VARCHAR(500) NULL,
      requestedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, sentAt DATETIME NULL,
      KEY idx_email_delivery_workspace (workspaceId, requestedAt), KEY idx_email_delivery_recipient (recipientEmail, requestedAt),
      CONSTRAINT fk_email_delivery_workspace FOREIGN KEY (workspaceId) REFERENCES Workspaces(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await pool.query(`CREATE TABLE IF NOT EXISTS AccountEmailRateLimits (
      bucketKey CHAR(64) PRIMARY KEY, windowStartedAt DATETIME NOT NULL,
      requestCount SMALLINT UNSIGNED NOT NULL DEFAULT 0, updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await pool.execute('INSERT IGNORE INTO SchemaMigrations (version, name, checksum) VALUES (?, ?, ?)', [version, 'Invitation delivery and account lifecycle email', checksum]);
    console.log('Account email delivery schema is ready.');
  } finally { await pool.execute('SELECT RELEASE_LOCK(?)', [lockName]); }
}

migrate().catch((error) => { console.error('Account email migration failed:', error); process.exitCode = 1; }).finally(async () => pool.end());
