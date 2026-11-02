import { z } from 'zod';
import { getAuthEnv } from '@/server/env';
import { clientIp, fail, ok, originAllowed, safeNext } from '@/server/http';
import { checkPassword, hashIp } from '@/server/auth/password';
import { markLoginSuccess, reserveLoginAttempt } from '@/server/auth/attempts';
import { getDb } from '@/db';
import { getOwner } from '@/server/auth/users';
import { createSessionTokenV2, SESSION_COOKIE, sessionCookieOptions } from '@/server/auth/session';

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

  let owner: Awaited<ReturnType<typeof getOwner>> = null;
  const ipHash = hashIp(clientIp(req), env.sessionSecret);
  try {
    // Попытка резервируется (как неудача) атомарно до сравнения пароля, см. контракт 3.3.
    const reservation = await reserveLoginAttempt(ipHash, 'password');
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
    // Контракт 22.3: аварийный вход только для owner; нет строки или blocked: тот же отказ
    owner = await getOwner(getDb());
    if (!owner || owner.status === 'blocked') {
      await new Promise((r) => setTimeout(r, 500));
      return fail(401, 'invalid_credentials', 'Неверный пароль.');
    }
    await markLoginSuccess(reservation.id);
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }

  const token = await createSessionTokenV2(env.sessionSecret, { uid: owner.id, role: 'owner', amr: 'pwd', se: owner.sessionEpoch });
  const res = ok({ redirectTo: safeNext(parsed.next) });
  const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '').split(':')[0];
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(host !== 'localhost' && host !== '127.0.0.1'));
  return res;
}
