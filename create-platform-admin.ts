import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { randomUUID, randomBytes, scrypt as scryptCallback } from 'node:crypto';
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
    throw new Error('Set PLATFORM_MFA_ENCRYPTION_KEY (at least 32 random characters) in .env before creating a platform administrator.');
  }
  const rl = createInterface({ input, output });
  try {
    const [rows]: any = await pool.query('SELECT COUNT(*) AS count FROM PlatformAdminAccounts');
    const existingCount = Number(rows[0]?.count || 0);
    if (existingCount > 0) throw new Error('A platform administrator already exists. Ask an active platform admin to invite the next administrator from the console.');
    const name = (await rl.question('Full name: ')).trim();
    const email = (await rl.question('Email: ')).trim().toLowerCase();
    const password = await askSecret('Password (12+ characters): ', rl);
    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12) throw new Error('Enter a name, valid email, and password with at least 12 characters.');
    const secret = generateTotpSecret();
    console.log('\nAdd this authenticator secret to an app using TOTP (30-second, six-digit code):');
    console.log(secret);
    console.log(`otpauth://totp/TalentEdge%20Platform%20Admin:${encodeURIComponent(email)}?secret=${secret}&issuer=TalentEdge%20Platform%20Admin\n`);
    const codeInterface = createInterface({ input, output });
    const code = await codeInterface.question('Authenticator code: ');
    codeInterface.close();
    if (!verifyTotp(secret, code)) throw new Error('Authenticator code was not accepted; no account was created.');
    const id = randomUUID();
    await pool.execute(
      'INSERT INTO PlatformAdminAccounts (id, name, email, passwordHash, totpSecretEncrypted) VALUES (?, ?, ?, ?, ?)',
      [id, name, email, await hashPassword(password), encryptTotpSecret(secret)],
    );
    await pool.execute('INSERT INTO PlatformAuditEvents (id, platformAdminId, action, targetType, targetId, reason) VALUES (?, ?, ?, ?, ?, ?)',
      [randomUUID(), id, 'platform_admin.bootstrapped', 'platform_admin', id, 'Initial account created through the local bootstrap CLI']);
    console.log(`Platform administrator created for ${email}. Visit /platform-admin to sign in. Keep the MFA encryption key backed up; rotating or losing it prevents OTP validation.`);
  } finally { rl.close(); }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(async () => pool.end());
