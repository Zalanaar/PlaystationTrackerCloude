import { z } from 'zod';
import { getAuthEnv } from '@/server/env';
import { clientIp, fail, ok, originAllowed, safeNext } from '@/server/http';
import { checkPassword, hashIp } from '@/server/auth/password';
import { markLoginSuccess, reserveLoginAttempt } from '@/server/auth/attempts';
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = z.object({ password: z.string().min(1).max(256), next: z.string().optional() });

export async function POST(req: Request) {
  const env = getAuthEnv();
  if (!env) return fail(500, 'config_error', 'Сервер не настроен.');

  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }
  let parsed: z.infer<typeof body>;
  try {
    const r = body.safeParse(await req.json());
    if (!r.success) return fail(400, 'invalid_request', 'Некорректный запрос.');
    parsed = r.data;
  } catch {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }

  const ipHash = hashIp(clientIp(req), env.sessionSecret);
  try {
    // Попытка резервируется (как неудача) атомарно до сравнения пароля, см. контракт 3.3.
    const reservation = await reserveLoginAttempt(ipHash);
    if (reservation.limited) {
      return fail(
        429,
        'rate_limited',
        'Слишком много попыток. Попробуйте позже.',
        { retryAfterSeconds: reservation.retryAfterSeconds },
        { 'Retry-After': String(reservation.retryAfterSeconds) },
      );
    }

    if (!checkPassword(parsed.password, env.adminPassword)) {
      await new Promise((r) => setTimeout(r, 500));
      return fail(401, 'invalid_credentials', 'Неверный пароль.');
    }
    await markLoginSuccess(reservation.id);
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }

  const token = await createSessionToken(env.sessionSecret);
  const res = ok({ redirectTo: safeNext(parsed.next) });
  const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '').split(':')[0];
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(host !== 'localhost' && host !== '127.0.0.1'));
  return res;
}
