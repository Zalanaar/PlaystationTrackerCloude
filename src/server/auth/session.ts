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
/** uid = id основного профиля (вход), pid = id активного профиля (Фаза 41, контракт 41.2); нет pid = pid = uid. */
/** Фаза 45: sid = id сессии (отзыв «Выйти»), se = эпоха сессий входа (allowed_users.session_epoch, «Выйти на всех устройствах»). */
export type SessionClaims = { uid: number; role: SessionRole; amr: SessionAmr; pid?: number; se?: number };
export type Session = Omit<SessionClaims, 'se'> & { v: 2; iat: number; exp: number; sid?: string; se: number };

const SID_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** Случайный id сессии (128 бит, base64url). */
export function newSessionId(): string {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
}

/** Ключ отзыва: sid; у токенов до Фазы 44 (без sid) стабильная пара uid+iat (iat не меняется при переключении профиля). */
export function sessionRevocationKey(session: Session): string {
  return session.sid ?? `legacy-${session.uid}-${session.iat}`;
}

function epochField(se: number | undefined): { se?: number } {
  if (se === undefined || se === 0) return {};
  if (!Number.isInteger(se) || se < 0) throw new Error('invalid session epoch');
  return { se };
}

async function signBody(secret: string, body: Record<string, unknown>): Promise<string> {
  const payload = b64urlEncode(enc.encode(JSON.stringify(body)));
  const sig = await crypto.subtle.sign('HMAC', await importKey(secret, 'sign'), enc.encode(payload));
  return `${payload}.${b64urlEncode(new Uint8Array(sig))}`;
}

function pidField(uid: number, pid: number | undefined): { pid?: number } {
  if (pid === undefined || pid === uid) return {};
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('invalid pid');
  return { pid };
}

/** Токен v:2 (контракт 22.3). Бросает при пустом/коротком секрете или некорректных claims. */
export async function createSessionTokenV2(
  secret: string | null | undefined,
  claims: SessionClaims,
  nowMs: number = Date.now(),
): Promise<string> {
  if (!validSecret(secret)) throw new Error('session secret is missing or too short');
  if (!Number.isInteger(claims.uid) || claims.uid <= 0) throw new Error('invalid uid');
  const iat = Math.floor(nowMs / 1000);
  return signBody(secret, {
    v: 2,
    uid: claims.uid,
    role: claims.role,
    amr: claims.amr,
    ...pidField(claims.uid, claims.pid),
    sid: newSessionId(),
    ...epochField(claims.se),
    iat,
    exp: iat + SESSION_TTL_SECONDS,
  });
}

/** Переключение профиля (41.2): новый токен с теми же uid/role/amr/sid/se/iat/exp, срок НЕ продлевается. pid = uid или undefined убирает pid. */
export async function reissueSessionToken(secret: string | null | undefined, session: Session, pid: number | undefined): Promise<string> {
  if (!validSecret(secret)) throw new Error('session secret is missing or too short');
  return signBody(secret, {
    v: 2,
    uid: session.uid,
    role: session.role,
    amr: session.amr,
    ...pidField(session.uid, pid),
    ...(session.sid !== undefined ? { sid: session.sid } : {}),
    ...epochField(session.se),
    iat: session.iat,
    exp: session.exp,
  });
}

/** Остаток жизни токена в секундах (для maxAge cookie при переключении профиля). */
export function sessionRemainingSeconds(session: Session, nowMs: number = Date.now()): number {
  return Math.max(0, session.exp - Math.floor(nowMs / 1000));
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
      const { uid, role, amr, pid, sid, se } = d;
      if (typeof uid !== 'number' || !Number.isInteger(uid) || uid <= 0) return null;
      if (role !== 'owner' && role !== 'member') return null;
      if (amr !== 'google' && amr !== 'pwd') return null;
      if (pid !== undefined && (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0)) return null;
      if (sid !== undefined && (typeof sid !== 'string' || !SID_RE.test(sid))) return null;
      if (se !== undefined && (typeof se !== 'number' || !Number.isInteger(se) || se < 0)) return null;
      return { v: 2, uid, role, amr, ...(pid !== undefined && pid !== uid ? { pid } : {}), ...(sid !== undefined ? { sid } : {}), se: se ?? 0, iat, exp };
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

export function sessionCookieOptions(secure: boolean, maxAge: number = SESSION_TTL_SECONDS) {
  return { httpOnly: true, secure, sameSite: 'lax' as const, path: '/', maxAge };
}
