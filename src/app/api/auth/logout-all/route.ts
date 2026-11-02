// Фаза 45: «Выйти на всех устройствах» — эпоха сессий входа + 1, все cookie этого входа (и текущая) перестают пускать.
import { getDb } from '@/db';
import { revokeAllSessions } from '@/server/auth/revocation';
import { requireUser } from '@/server/auth/require-user';
import { SESSION_COOKIE } from '@/server/auth/session';
import { fail, ok, originAllowed } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  try {
    await revokeAllSessions(getDb(), auth.user.loginId);
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
  const res = ok({}, { headers: { 'Clear-Site-Data': '"cache"' } }); // HTTP-кэш тяжёлых GET (Фаза 47)
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}
