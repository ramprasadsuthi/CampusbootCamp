import dotenv from 'dotenv';
import { spawn } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

dotenv.config();

const database = process.env.DB_NAME || 'talentedge';
const outputDirectory = path.resolve(process.env.DB_BACKUP_DIR || 'backups');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputFile = path.join(outputDirectory, `${database}-${timestamp}.sql`);

async function backup() {
  await mkdir(outputDirectory, { recursive: true });
  const args = [
    '--host', process.env.DB_HOST || 'localhost',
    '--user', process.env.DB_USER || 'root',
    '--single-transaction', '--routines', '--triggers', '--events', '--hex-blob',
    '--default-character-set=utf8mb4', database,
  ];
  const env = { ...process.env };
  if (process.env.DB_PASSWORD) env.MYSQL_PWD = process.env.DB_PASSWORD;
  const executable = process.env.MYSQLDUMP_PATH || 'mysqldump';
  const child = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
  const exit = new Promise<void>((resolve, reject) => {
    child.once('error', (error) => reject(new Error(`Could not start ${executable}: ${error.message}`)));
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`mysqldump exited with code ${code}.`)));
  });
  await Promise.all([pipeline(child.stdout, createWriteStream(outputFile, { flags: 'wx' })), exit]);
  const backupStat = await stat(outputFile);
  if (backupStat.size === 0) throw new Error('The backup file is empty.');
  console.log(`Database backup created: ${outputFile} (${backupStat.size} bytes)`);
}

backup().catch((error) => { console.error('Database backup failed:', error); process.exitCode = 1; });
