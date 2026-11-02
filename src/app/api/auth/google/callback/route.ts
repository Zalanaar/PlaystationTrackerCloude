import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { getGoogleEnv, getSessionSecret } from '@/server/env';
import { clientIp, safeNext } from '@/server/http';
import { hashIp } from '@/server/auth/password';
import { markLoginSuccess, reserveLoginAttempt } from '@/server/auth/attempts';
import { exchangeCode, GoogleAuthError, OAUTH_COOKIE, OAUTH_COOKIE_PATH, readOAuthCookie, stateMatches, verifyIdToken } from '@/server/auth/google';
import { createSessionTokenV2, SESSION_COOKIE, sessionCookieOptions } from '@/server/auth/session';
import { completeLogin, lookupForLogin, normalizeEmail } from '@/server/auth/users';
import { setHeroHintCookie } from '@/server/auth/hero-hint';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ErrorKind = 'access_denied' | 'oauth_failed' | 'rate_limited';

// Контракт 22.4: один и тот же отказ для всех причин списка; в ответ и логи не попадают email, причина, токены.
export async function GET(req: Request) {
  const cfg = getGoogleEnv();
  const secret = getSessionSecret();
  const base = cfg?.origin ?? new URL(req.url).origin;
  const secure = !base.startsWith('http://');

  const finish = (to: string): NextResponse => {
    const res = NextResponse.redirect(new URL(to, base), 302);
    res.headers.set('Cache-Control', 'no-store');
    // pst_oauth одноразовая: удаляется при любом исходе
    res.cookies.set(OAUTH_COOKIE, '', { httpOnly: true, secure, sameSite: 'lax', path: OAUTH_COOKIE_PATH, maxAge: 0 });
    return res;
  };
  const deny = (kind: ErrorKind) => finish(`/login?error=${kind}`);

  if (!cfg || !secret) return deny('oauth_failed');

  let attemptId: number;
  try {
    const r = await reserveLoginAttempt(hashIp(clientIp(req), secret), 'google');
    if (r.limited) return deny('rate_limited');
    attemptId = r.id;
  } catch {
    return deny('oauth_failed');
  }

  const url = new URL(req.url);
  const cookie = req.headers.get('cookie')?.split(';').map((p) => p.trim()).find((p) => p.startsWith(`${OAUTH_COOKIE}=`));
  const saved = await readOAuthCookie(secret, cookie?.slice(OAUTH_COOKIE.length + 1));
  const code = url.searchParams.get('code');
  if (!saved || !stateMatches(saved.state, url.searchParams.get('state')) || !code || url.searchParams.has('error')) return deny('oauth_failed');

  let identity;
  try {
    const idToken = await exchangeCode(cfg, code, saved.verifier);
    identity = await verifyIdToken(idToken, { clientId: cfg.clientId, nonce: saved.nonce });
  } catch (e) {
    return deny(e instanceof GoogleAuthError && e.code === 'unverified' ? 'access_denied' : 'oauth_failed');
  }

  try {
    const db = getDb();
    const email = normalizeEmail(identity.email);
    const found = email ? await lookupForLogin(db, identity.sub, email) : ({ ok: false } as const);
    if (!found.ok || !(await completeLogin(db, found.user, identity.sub, identity.name))) return deny('access_denied');
    await markLoginSuccess(attemptId);
    const token = await createSessionTokenV2(secret, { uid: found.user.id, role: found.user.role === 'owner' ? 'owner' : 'member', amr: 'google', se: found.user.sessionEpoch });
    const res = finish(safeNext(saved.next));
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(secure));
    await setHeroHintCookie(res, req, found.user.id);
    return res;
  } catch {
    return deny('oauth_failed');
  }
}
