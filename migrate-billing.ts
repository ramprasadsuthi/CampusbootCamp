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
const version = '20261126_subscription_billing_v1';
const name = 'Subscription self-service billing';

async function addColumn(table: string, column: string, definition: string) {
  const [rows]: any = await pool.execute(
    'SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [table, column],
  );
  if (!rows.length) await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
}

async function migrate() {
  const checksum = createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex');
  await pool.query(`CREATE TABLE IF NOT EXISTS SchemaMigrations (
    version VARCHAR(64) PRIMARY KEY, name VARCHAR(191) NOT NULL, checksum CHAR(64) NOT NULL,
    appliedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  const [existing]: any = await pool.execute('SELECT checksum FROM SchemaMigrations WHERE version = ?', [version]);
  if (existing.length && existing[0].checksum !== checksum) throw new Error(`Migration ${version} checksum changed. Create a new migration version.`);
  const lockName = `talentedge:migrate:${process.env.DB_NAME || 'talentedge'}`;
  const [lock]: any = await pool.execute('SELECT GET_LOCK(?, 30) AS acquired', [lockName]);
  if (Number(lock[0]?.acquired) !== 1) throw new Error('Could not acquire the database migration lock.');
  try {
    await addColumn('PlatformSubscriptionPlans', 'monthlyPricePaise', 'BIGINT UNSIGNED NULL');
    await addColumn('PlatformSubscriptionPlans', 'annualPricePaise', 'BIGINT UNSIGNED NULL');
    await addColumn('WorkspaceSubscriptions', 'providerSubscriptionId', 'VARCHAR(191) NULL');
    await addColumn('WorkspaceSubscriptions', 'pendingBillingAttemptId', 'VARCHAR(191) NULL');
    await pool.query(`CREATE TABLE IF NOT EXISTS RazorpayPlanCatalog (
      planId VARCHAR(64) NOT NULL, billingInterval ENUM('monthly','annual') NOT NULL, amountPaise BIGINT UNSIGNED NOT NULL,
      providerPlanId VARCHAR(191) NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (planId, billingInterval), UNIQUE KEY uq_razorpay_plan_id (providerPlanId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await pool.query(`CREATE TABLE IF NOT EXISTS WorkspaceBillingAttempts (
      id VARCHAR(191) PRIMARY KEY, workspaceId VARCHAR(191) NOT NULL, requestedByUserId VARCHAR(191) NOT NULL,
      planId VARCHAR(64) NOT NULL, billingInterval ENUM('monthly','annual') NOT NULL, amountPaise BIGINT UNSIGNED NOT NULL,
      status ENUM('creating','created','authenticated','active','failed','superseded') NOT NULL DEFAULT 'creating',
      providerPlanId VARCHAR(191) NULL, providerSubscriptionId VARCHAR(191) NULL, providerPaymentId VARCHAR(191) NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_billing_attempt_subscription (providerSubscriptionId),
      KEY idx_billing_attempt_workspace (workspaceId, createdAt),
      CONSTRAINT fk_billing_attempt_workspace FOREIGN KEY (workspaceId) REFERENCES Workspaces(id) ON DELETE CASCADE,
      CONSTRAINT fk_billing_attempt_user FOREIGN KEY (requestedByUserId) REFERENCES Users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await pool.query(`CREATE TABLE IF NOT EXISTS WorkspaceBillingInvoices (
      id VARCHAR(191) PRIMARY KEY, invoiceNumber VARCHAR(64) NOT NULL, workspaceId VARCHAR(191) NOT NULL,
      billingAttemptId VARCHAR(191) NULL, planId VARCHAR(64) NOT NULL, billingInterval ENUM('monthly','annual') NOT NULL,
      amountPaise BIGINT UNSIGNED NOT NULL, currency CHAR(3) NOT NULL DEFAULT 'INR', status ENUM('paid','failed','pending') NOT NULL,
      providerPaymentId VARCHAR(191) NULL, providerInvoiceId VARCHAR(191) NULL, providerSubscriptionId VARCHAR(191) NULL,
      invoiceUrl VARCHAR(1000) NULL,
      paymentMethod VARCHAR(64) NULL, issuedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      periodStart DATETIME NULL, periodEnd DATETIME NULL,
      UNIQUE KEY uq_billing_invoice_number (invoiceNumber), UNIQUE KEY uq_billing_payment (providerPaymentId),
      KEY idx_billing_invoice_workspace (workspaceId, issuedAt),
      CONSTRAINT fk_billing_invoice_workspace FOREIGN KEY (workspaceId) REFERENCES Workspaces(id) ON DELETE CASCADE,
      CONSTRAINT fk_billing_invoice_attempt FOREIGN KEY (billingAttemptId) REFERENCES WorkspaceBillingAttempts(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await pool.query(`CREATE TABLE IF NOT EXISTS WorkspaceBillingWebhookEvents (
      providerEventId VARCHAR(191) PRIMARY KEY, eventType VARCHAR(100) NOT NULL, receivedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processingAt DATETIME NULL, processedAt DATETIME NULL, processingError VARCHAR(500) NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await pool.query(`CREATE TABLE IF NOT EXISTS WorkspaceBillingCancellationQueue (
      id VARCHAR(191) PRIMARY KEY, workspaceId VARCHAR(191) NOT NULL, providerSubscriptionId VARCHAR(191) NOT NULL,
      status ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending', attempts INT UNSIGNED NOT NULL DEFAULT 0,
      lastError VARCHAR(500) NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_billing_cancel_subscription (providerSubscriptionId), KEY idx_billing_cancel_queue (status, updatedAt),
      CONSTRAINT fk_billing_cancel_workspace FOREIGN KEY (workspaceId) REFERENCES Workspaces(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await pool.execute('INSERT IGNORE INTO SchemaMigrations (version, name, checksum) VALUES (?, ?, ?)', [version, name, checksum]);
    console.log('Subscription billing schema is ready.');
  } finally {
    await pool.execute('SELECT RELEASE_LOCK(?)', [lockName]);
  }
}

migrate().catch((error) => { console.error('Billing migration failed:', error); process.exitCode = 1; }).finally(async () => pool.end());
