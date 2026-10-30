// Проверка пользователя в route handler (контракт 22.3). proxy.ts проверяет только подпись/срок, роль и статус берутся из БД.
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { getSessionSecret } from '@/server/env';
import { fail } from '@/server/http';
import { readSessionToken, SESSION_COOKIE, type SessionAmr, type SessionRole } from './session';
import { asUserId, type UserId } from './user-id';
import { getUserById, type UserRow } from './users';

export type AuthedUser = {
  id: UserId;
  email: string;
  role: SessionRole;
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

/** Сессия валидна и пользователь в БД active. Роль берётся из БД, не из cookie. */
export async function requireUser(req: Request): Promise<AuthResult> {
  const token = cookieValue(req, SESSION_COOKIE);
  const session = await readSessionToken(token, getSessionSecret());
  if (!session) return unauthorized(!!token);
  let row: UserRow | null;
  try {
    row = await getUserById(getDb(), session.uid);
  } catch {
    return { ok: false, response: fail(503, 'db_unavailable', 'База данных недоступна.') };
  }
  if (!row || row.status !== 'active') return unauthorized(true);
  return { ok: true, user: { id: asUserId(row.id), email: row.email, role: row.role as SessionRole, amr: session.amr, row } };
}

/** requireUser + роль owner по БД; иначе 403 forbidden. */
export async function requireOwner(req: Request): Promise<AuthResult> {
  const r = await requireUser(req);
  if (!r.ok) return r;
  if (r.user.role !== 'owner') return { ok: false, response: fail(403, 'forbidden', 'Недостаточно прав.') };
  return r;
}
