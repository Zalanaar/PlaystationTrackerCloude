// Подписанная cookie-сессия. Только Web Crypto, без Node-API (работает и в Edge, и в Node).
export const SESSION_COOKIE = 'pst_session';
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const MIN_SECRET_LENGTH = 32;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(str)) return null;
  try {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function validSecret(secret: string | null | undefined): secret is string {
  return typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH;
}

function importKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

/** Создать токен сессии. Бросает при пустом/коротком секрете (fail closed). */
export async function createSessionToken(secret: string | null | undefined, nowMs: number = Date.now()): Promise<string> {
  if (!validSecret(secret)) throw new Error('session secret is missing or too short');
  const iat = Math.floor(nowMs / 1000);
  const payload = b64urlEncode(enc.encode(JSON.stringify({ v: 1, iat, exp: iat + SESSION_TTL_SECONDS })));
  const sig = await crypto.subtle.sign('HMAC', await importKey(secret, 'sign'), enc.encode(payload));
  return `${payload}.${b64urlEncode(new Uint8Array(sig))}`;
}

/** true только для токена с верной подписью и неистёкшим сроком. Любая ошибка = false. */
export async function verifySessionToken(
  token: string | null | undefined,
  secret: string | null | undefined,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (!token || !validSecret(secret)) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const sigBytes = b64urlDecode(sig);
  const payloadBytes = b64urlDecode(payload);
  if (!sigBytes || !payloadBytes) return false;
  try {
    // crypto.subtle.verify сравнивает подпись за постоянное время
    const ok = await crypto.subtle.verify('HMAC', await importKey(secret, 'verify'), sigBytes as BufferSource, enc.encode(payload));
    if (!ok) return false;
    const data: unknown = JSON.parse(dec.decode(payloadBytes));
    if (typeof data !== 'object' || data === null) return false;
    const { v, iat, exp } = data as Record<string, unknown>;
    if (v !== 1 || typeof iat !== 'number' || typeof exp !== 'number') return false;
    return Math.floor(nowMs / 1000) < exp && iat <= Math.floor(nowMs / 1000) + 60;
  } catch {
    return false;
  }
}

export function sessionCookieOptions(secure: boolean) {
  return { httpOnly: true, secure, sameSite: 'lax' as const, path: '/', maxAge: SESSION_TTL_SECONDS };
}
