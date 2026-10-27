// Только Node runtime (node:crypto).
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/** Constant-time сравнение строк: хэши по 32 байта выравнивают длину. */
export function secureEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

/** Пустой ожидаемый секрет никогда не совпадает (fail closed). */
export function checkPassword(input: string, expected: string | null | undefined): boolean {
  if (!expected) return false;
  return secureEqual(input, expected);
}

/** Bearer-проверка для cron. Пустой/отсутствующий секрет = всегда false. */
export function checkBearer(header: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret || !header) return false;
  const m = /^Bearer (.+)$/.exec(header);
  if (!m) return false;
  return secureEqual(m[1], secret);
}

export function hashIp(ip: string, secret: string): string {
  return createHmac('sha256', secret).update(ip, 'utf8').digest('hex');
}
