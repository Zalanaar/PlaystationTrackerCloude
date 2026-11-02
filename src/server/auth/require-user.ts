// Проверка пользователя в route handler (контракт 22.3). proxy.ts проверяет только подпись/срок, роль, статус и отзыв сессии берутся из БД.
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { getSessionSecret } from '@/server/env';
import { fail } from '@/server/http';
import { readSessionToken, SESSION_COOKIE, type SessionAmr, type SessionRole } from './session';
import { isSessionRevoked } from './revocation';
import { asUserId, type UserId } from './user-id';
import { resolveAuthContext, type UserRow } from './users';

export type AuthedUser = {
  /** Активный профиль (Фаза 41): под ним все данные. Без pid в сессии = основной профиль. */
  id: UserId;
  /** Основной профиль = вход (Telegram, «Доступ»). */
  loginId: UserId;
  email: string;
  /** Роль ВХОДА (права, 41.1), из основной строки. */
  role: SessionRole;
  /** Роль строки активного профиля: у дополнительного всегда member. */
  profileRole: SessionRole;
  amr: SessionAmr;
  row: UserRow;
};

export type AuthResult = { ok: true; user: AuthedUser } | { ok: false; response: NextResponse };

function cookieValue(req: Request, name: string): string | undefined {
  const raw = req.headers.get('cookie');
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

function unauthorized(clearCookie: boolean): AuthResult {
  const response = fail(401, 'unauthorized', 'Требуется вход.');
  if (clearCookie) response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return { ok: false, response };
}

/** Сессия валидна, не отозвана (Фаза 45) и вход/профиль в БД active (41.2: принадлежность pid проверяется на КАЖДОМ запросе). Роль берётся из БД, не из cookie. */
export async function requireUser(req: Request): Promise<AuthResult> {
  const token = cookieValue(req, SESSION_COOKIE);
  const session = await readSessionToken(token, getSessionSecret());
  if (!session) return unauthorized(!!token);
  let ctx: Awaited<ReturnType<typeof resolveAuthContext>>;
  let revoked: boolean;
  try {
    const db = getDb();
    [ctx, revoked] = await Promise.all([resolveAuthContext(db, session.uid, session.pid), isSessionRevoked(db, session)]);
  } catch {
    return { ok: false, response: fail(503, 'db_unavailable', 'База данных недоступна.') };
  }
  // Фаза 45: сессия отозвана выходом или «Выйти на всех устройствах» (эпоха входа сменилась)
  if (!ctx || revoked || ctx.login.sessionEpoch !== session.se) return unauthorized(true);
  const { profile: row, login } = ctx;
  return {
    ok: true,
    user: { id: asUserId(row.id), loginId: asUserId(login.id), email: row.email, role: login.role as SessionRole, profileRole: row.role as SessionRole, amr: session.amr, row },
  };
}

/** requireUser + роль owner по БД; иначе 403 forbidden. */
export async function requireOwner(req: Request): Promise<AuthResult> {
  const r = await requireUser(req);
  if (!r.ok) return r;
  if (r.user.role !== 'owner') return { ok: false, response: fail(403, 'forbidden', 'Недостаточно прав.') };
  return r;
}
