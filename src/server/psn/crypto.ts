// AES-256-GCM для токенов в psn_auth. Формат: v1:<iv_b64url>:<tag_b64url>:<ciphertext_b64url>.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';

function keyFrom(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes in base64');
  return key;
}

export function isValidEncryptionKey(keyB64: string | undefined): keyB64 is string {
  if (!keyB64) return false;
  return Buffer.from(keyB64, 'base64').length === 32;
}

export function encryptToken(plain: string, keyB64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(keyB64), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join(':');
}

/** Бросает ошибку, если формат неверный, ключ не подходит или данные изменены. */
export function decryptToken(enc: string, keyB64: string): string {
  const [v, iv, tag, ct] = enc.split(':');
  if (v !== VERSION || !iv || !tag || ct === undefined) throw new Error('bad token format');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(keyB64), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}
