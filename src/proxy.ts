// Контракт 3.4. В Next.js 16 файл middleware.ts переименован в proxy.ts (та же роль, runtime Node.js).
import { NextResponse, type NextRequest } from 'next/server';
import { getCronSecret, getSessionSecret } from '@/server/env';
import { checkBearer } from '@/server/auth/password';
import { SESSION_COOKIE, verifySessionToken } from '@/server/auth/session';
import { safeNext } from '@/server/http';

const NO_STORE = { 'Cache-Control': 'no-store' };

function json(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status, headers: NO_STORE });
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Контракт 22.4: вход открыт без сессии (старт и callback Google); /api/auth/me требует сессию
  if (pathname === '/api/auth/login' || pathname === '/api/auth/logout' || pathname === '/api/auth/google' || pathname === '/api/auth/google/callback') {
    return NextResponse.next({ headers: NO_STORE });
  }

  if (pathname === '/api/cron' || pathname.startsWith('/api/cron/')) {
    if (!checkBearer(req.headers.get('authorization'), getCronSecret())) {
      return json(401, 'unauthorized', 'Не авторизован.');
    }
    return NextResponse.next({ headers: NO_STORE });
  }

  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const valid = await verifySessionToken(cookie, getSessionSecret());

  if (pathname === '/login') {
    if (valid) return NextResponse.redirect(new URL('/', req.url));
    const res = NextResponse.next({ headers: NO_STORE });
    if (cookie) res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  if (!valid) {
    const isApi = pathname === '/api' || pathname.startsWith('/api/');
    const res = isApi
      ? json(401, 'unauthorized', 'Требуется вход.')
      : NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(safeNext(pathname + search))}`, req.url));
    if (!isApi) res.headers.set('Cache-Control', 'no-store');
    if (cookie) res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  return NextResponse.next({ headers: NO_STORE });
}

// /api/* всегда проходит через proxy (первый паттерн); статика по расширению пропускается только вне /api.
// manifest.webmanifest и иконки (icon.svg, favicon.ico, apple-icon.png, /icons/*.png) открыты: без них «На экран Домой» не работает.
// Строки должны быть статичными (требование Next), без шаблонов.
export const config = {
  matcher: [
    '/api/:path*',
    '/((?!api(?:/|$)|_next/static|_next/image|favicon\\.ico$|manifest\\.webmanifest$|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|avif|woff|woff2|ttf|otf)$).*)',
  ],
};
