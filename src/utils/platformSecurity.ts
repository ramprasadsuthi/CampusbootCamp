import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function encodeBase32(value: Uint8Array): string {
  let bits = 0;
  let buffer = 0;
  let output = '';
  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(buffer << (5 - bits)) & 31];
  return output;
}

export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

function decodeBase32(value: string): Buffer {
  let bits = 0;
  let buffer = 0;
  const output: number[] = [];
  for (const character of value.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    const index = BASE32.indexOf(character);
    if (index < 0) continue;
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function totpCode(secret: string, timestamp = Date.now()): string {
  const counter = Math.floor(timestamp / 30_000);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

export function verifyTotp(secret: string, code: unknown, timestamp = Date.now()): boolean {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return false;
  const submitted = Buffer.from(code);
  for (const drift of [-30_000, 0, 30_000]) {
    const expected = Buffer.from(totpCode(secret, timestamp + drift));
    if (submitted.length === expected.length && timingSafeEqual(submitted, expected)) return true;
  }
  return false;
}

function encryptionKey(): Buffer {
  const configured = process.env.PLATFORM_MFA_ENCRYPTION_KEY;
  if (!configured || configured.length < 32) throw new Error('Set PLATFORM_MFA_ENCRYPTION_KEY to a random secret of at least 32 characters.');
  return createHash('sha256').update(configured).digest();
}

export function encryptTotpSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptTotpSecret(encoded: string): string {
  const [version, ivText, tagText, encryptedText] = encoded.split(':');
  if (version !== 'v1' || !ivText || !tagText || !encryptedText) throw new Error('Platform MFA secret is invalid.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, 'base64url')), decipher.final()]).toString('utf8');
}
