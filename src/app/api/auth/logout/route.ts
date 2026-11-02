import { getDb } from '@/db';
import { getSessionSecret } from '@/server/env';
import { fail, ok, originAllowed } from '@/server/http';
import { revokeSession } from '@/server/auth/revocation';
import { readSessionToken, SESSION_COOKIE } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function cookieValue(req: Request): string | undefined {
  const raw = req.headers.get('cookie');
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE) return part.slice(i + 1).trim();
  }
  return undefined;
}

export async function POST(req: Request) {
  // Контракт 3.4: Origin (если есть) совпадает с хостом, Content-Type application/json.
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }
  // Фаза 45: текущая сессия отзывается на сервере (копия cookie больше не пускает). Сбой БД не мешает выйти: cookie удаляется всегда.
  const session = await readSessionToken(cookieValue(req), getSessionSecret());
  let revoked = false;
  if (session) {
    try {
      await revokeSession(getDb(), session);
      revoked = true;
    } catch {
      revoked = false;
    }
  }
  const res = ok({ revoked });
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}
