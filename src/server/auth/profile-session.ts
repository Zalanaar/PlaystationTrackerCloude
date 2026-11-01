// Переключение профиля в cookie (Фаза 41, контракт 41.2): новый токен с теми же iat/exp, срок не продлевается.
import type { NextResponse } from 'next/server';
import { getSessionSecret } from '@/server/env';
import { readSessionToken, reissueSessionToken, sessionCookieOptions, sessionRemainingSeconds, SESSION_COOKIE } from './session';

function cookieValue(req: Request): string | undefined {
  const raw = req.headers.get('cookie');
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE) return part.slice(i + 1).trim();
  }
  return undefined;
}

/** Ставит cookie с активным профилем pid (pid = вход убирает pid). false, если сессию перечитать не удалось. */
export async function setActiveProfileCookie(res: NextResponse, req: Request, pid: number): Promise<boolean> {
  const secret = getSessionSecret();
  const session = await readSessionToken(cookieValue(req), secret);
  if (!session) return false;
  const token = await reissueSessionToken(secret, session, pid);
  const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '').split(':')[0];
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(host !== 'localhost' && host !== '127.0.0.1', sessionRemainingSeconds(session)));
  return true;
}
