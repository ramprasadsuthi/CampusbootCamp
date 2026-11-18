import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { randomBytes, scrypt as scryptCallback, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { encryptTotpSecret, generateTotpSecret, verifyTotp } from './src/utils/platformSecurity';

dotenv.config();
const scrypt = promisify(scryptCallback);
const pool = mysql.createPool({ host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'talentedge', waitForConnections: true, connectionLimit: 2 });

async function askSecret(prompt: string, rl: ReturnType<typeof createInterface>): Promise<string> {
  if (!input.isTTY || typeof input.setRawMode !== 'function') return rl.question(prompt);
  rl.close();
  output.write(prompt);
  return new Promise((resolve, reject) => {
    let value = '';
    input.setRawMode(true);
    input.resume();
    const finish = (error?: Error) => {
      input.setRawMode(false);
      input.off('data', onData);
      output.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') return finish(new Error('Canceled.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= ' ') value += character;
      }
    };
    input.on('data', onData);
  });
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${key.toString('hex')}`;
}

async function main() {
  if (!process.env.PLATFORM_MFA_ENCRYPTION_KEY || process.env.PLATFORM_MFA_ENCRYPTION_KEY.length < 32) {
    throw new Error('Set PLATFORM_MFA_ENCRYPTION_KEY in .env before recovering a platform administrator.');
  }
  const rl = createInterface({ input, output });
  try {
    const email = (await rl.question('Platform administrator email: ')).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');

    const [accounts]: any = await pool.execute('SELECT id, email FROM PlatformAdminAccounts WHERE isActive = 1 ORDER BY createdAt ASC');
    if (accounts.length !== 1 || accounts[0].email.toLowerCase() !== email) {
      throw new Error('Local recovery is limited to the single active first administrator. For multiple admins, use an active administrator’s MFA reset flow.');
    }

    const phrase = `RECOVER ${email}`;
    const confirmation = await rl.question(`This replaces the password and authenticator and revokes all platform sessions. Type exactly “${phrase}” to continue: `);
    if (confirmation !== phrase) throw new Error('Recovery canceled; no account changes were made.');

    const password = await askSecret('New password (12+ characters): ', rl);
    if (password.length < 12 || password.length > 256) throw new Error('Use a password between 12 and 256 characters.');
    const secret = generateTotpSecret();
    output.write('\nAdd this NEW secret to your authenticator app (TOTP, 30-second, six-digit code):\n');
    output.write(`${secret}\n`);
    output.write(`otpauth://totp/TalentEdge%20Platform%20Admin:${encodeURIComponent(email)}?secret=${secret}&issuer=TalentEdge%20Platform%20Admin\n\n`);
    const codeInterface = createInterface({ input, output });
    const code = (await codeInterface.question('Current six-digit code: ')).trim();
    codeInterface.close();
    if (!verifyTotp(secret, code)) throw new Error('Authenticator code was not accepted; no account changes were made.');

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [locked]: any = await connection.execute('SELECT id, email FROM PlatformAdminAccounts WHERE id = ? AND isActive = 1 FOR UPDATE', [accounts[0].id]);
      if (!locked.length) throw new Error('The platform administrator account is no longer active.');
      await connection.execute('UPDATE PlatformAdminAccounts SET passwordHash = ?, totpSecretEncrypted = ? WHERE id = ?', [await hashPassword(password), encryptTotpSecret(secret), accounts[0].id]);
      await connection.execute('DELETE FROM PlatformAdminSessions WHERE platformAdminId = ?', [accounts[0].id]);
      await connection.execute(
        'INSERT INTO PlatformAuditEvents (id, platformAdminId, action, targetType, targetId, reason) VALUES (?, NULL, ?, ?, ?, ?)',
        [randomUUID(), 'platform_admin.recovered_locally', 'platform_admin', accounts[0].id, 'Single-admin recovery performed through the local CLI; password and MFA replaced; sessions revoked'],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
    output.write(`Recovery completed for ${email}. Sign in at /platform-admin with the new password and authenticator code.\n`);
  } finally { rl.close(); }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(async () => pool.end());
