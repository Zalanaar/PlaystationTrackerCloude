import { NextResponse } from 'next/server';
import { getGoogleEnv, getSessionSecret } from '@/server/env';
import { clientIp, fail, safeNext } from '@/server/http';
import { hashIp } from '@/server/auth/password';
import { peekLoginLimit } from '@/server/auth/attempts';
import { buildAuthUrl, newOAuthState, OAUTH_COOKIE, OAUTH_COOKIE_PATH, OAUTH_TTL_SECONDS, signOAuthCookie } from '@/server/auth/google';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Контракт 22.4: старт входа через Google.
export async function GET(req: Request) {
  const cfg = getGoogleEnv();
  const secret = getSessionSecret();
  if (!cfg || !secret) return fail(500, 'config_error', 'Вход через Google не настроен.');

  try {
    const limit = await peekLoginLimit(hashIp(clientIp(req), secret), 'google');
    if (limit.limited) {
      return fail(429, 'rate_limited', 'Слишком много попыток. Попробуйте позже.', { retryAfterSeconds: limit.retryAfterSeconds }, { 'Retry-After': String(limit.retryAfterSeconds) });
    }
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }

  const next = safeNext(new URL(req.url).searchParams.get('next'));
  const s = newOAuthState(next);
  const res = NextResponse.redirect(buildAuthUrl(cfg, s), 302);
  res.headers.set('Cache-Control', 'no-store');
  res.cookies.set(OAUTH_COOKIE, await signOAuthCookie(secret, s), {
    httpOnly: true,
    secure: !cfg.origin.startsWith('http://'),
    sameSite: 'lax',
    path: OAUTH_COOKIE_PATH,
    maxAge: OAUTH_TTL_SECONDS,
  });
  return res;
}
