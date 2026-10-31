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

/** Подписанный JSON (HMAC-SHA256 SESSION_SECRET) для коротких служебных cookie, например pst_oauth. */
export async function signJson(secret: string | null | undefined, data: Record<string, unknown>): Promise<string> {
  if (!validSecret(secret)) throw new Error('session secret is missing or too short');
  const payload = b64urlEncode(enc.encode(JSON.stringify(data)));
  const sig = await crypto.subtle.sign('HMAC', await importKey(secret, 'sign'), enc.encode(payload));
  return `${payload}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function verifyJson(secret: string | null | undefined, token: string | null | undefined): Promise<Record<string, unknown> | null> {
  if (!token || !validSecret(secret)) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const sig = b64urlDecode(parts[1]);
  const body = b64urlDecode(parts[0]);
  if (!sig || !body) return null;
  try {
    if (!(await crypto.subtle.verify('HMAC', await importKey(secret, 'verify'), sig as BufferSource, enc.encode(parts[0])))) return null;
    const d: unknown = JSON.parse(dec.decode(body));
    return typeof d === 'object' && d !== null && !Array.isArray(d) ? (d as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export type SessionRole = 'owner' | 'member';
export type SessionAmr = 'google' | 'pwd';
export type SessionClaims = { uid: number; role: SessionRole; amr: SessionAmr };
export type Session = SessionClaims & { v: 2; iat: number; exp: number };

/** Токен v:2 (контракт 22.3). Бросает при пустом/коротком секрете или некорректных claims. */
export async function createSessionTokenV2(
  secret: string | null | undefined,
  claims: SessionClaims,
  nowMs: number = Date.now(),
): Promise<string> {
  if (!validSecret(secret)) throw new Error('session secret is missing or too short');
  if (!Number.isInteger(claims.uid) || claims.uid <= 0) throw new Error('invalid uid');
  const iat = Math.floor(nowMs / 1000);
  const body = { v: 2, uid: claims.uid, role: claims.role, amr: claims.amr, iat, exp: iat + SESSION_TTL_SECONDS };
  const payload = b64urlEncode(enc.encode(JSON.stringify(body)));
  const sig = await crypto.subtle.sign('HMAC', await importKey(secret, 'sign'), enc.encode(payload));
  return `${payload}.${b64urlEncode(new Uint8Array(sig))}`;
}

/** Разбор и проверка токена (только v:2; v:1 удалён после 0015, контракт 22.3): подпись, форма, срок. null при любой ошибке. Без БД. */
export async function readSessionToken(
  token: string | null | undefined,
  secret: string | null | undefined,
  nowMs: number = Date.now(),
): Promise<Session | null> {
  if (!token || !validSecret(secret)) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const sigBytes = b64urlDecode(sig);
  const payloadBytes = b64urlDecode(payload);
  if (!sigBytes || !payloadBytes) return null;
  try {
    // crypto.subtle.verify сравнивает подпись за постоянное время
    const ok = await crypto.subtle.verify('HMAC', await importKey(secret, 'verify'), sigBytes as BufferSource, enc.encode(payload));
    if (!ok) return null;
    const data: unknown = JSON.parse(dec.decode(payloadBytes));
    if (typeof data !== 'object' || data === null) return null;
    const d = data as Record<string, unknown>;
    const { v, iat, exp } = d;
    if (typeof iat !== 'number' || typeof exp !== 'number') return null;
    const nowS = Math.floor(nowMs / 1000);
    if (!(nowS < exp) || iat > nowS + 60) return null;
    if (v === 2) {
      const { uid, role, amr } = d;
      if (typeof uid !== 'number' || !Number.isInteger(uid) || uid <= 0) return null;
      if (role !== 'owner' && role !== 'member') return null;
      if (amr !== 'google' && amr !== 'pwd') return null;
      return { v: 2, uid, role, amr, iat, exp };
    }
    return null;
  } catch {
    return null;
  }
}

/** true только для токена с верной подписью и неистёкшим сроком (v:2). Любая ошибка = false. */
export async function verifySessionToken(
  token: string | null | undefined,
  secret: string | null | undefined,
  nowMs: number = Date.now(),
): Promise<boolean> {
  return (await readSessionToken(token, secret, nowMs)) !== null;
}

export function sessionCookieOptions(secure: boolean) {
  return { httpOnly: true, secure, sameSite: 'lax' as const, path: '/', maxAge: SESSION_TTL_SECONDS };
}
