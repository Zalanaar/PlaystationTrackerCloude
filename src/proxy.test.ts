import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy, config as configRef } from './proxy';
import { createSessionTokenV2, SESSION_COOKIE } from './server/auth/session';
import { originAllowed } from './server/http';

const createSessionToken = (secret: string, nowMs?: number) => createSessionTokenV2(secret, { uid: 1, role: 'owner', amr: 'pwd' }, nowMs); // owner, pwd

const SECRET = 's'.repeat(40);
const CRON = 'c'.repeat(40);
const BASE = 'http://localhost:3000';

function req(path: string, init: { cookie?: string; auth?: string; method?: string } = {}) {
  const headers = new Headers();
  if (init.cookie) headers.set('cookie', `${SESSION_COOKIE}=${init.cookie}`);
  if (init.auth) headers.set('authorization', init.auth);
  return new NextRequest(BASE + path, { method: init.method ?? 'GET', headers });
}

describe('proxy: закрытый доступ', () => {
  beforeEach(() => {
    vi.stubEnv('SESSION_SECRET', SECRET);
    vi.stubEnv('CRON_SECRET', CRON);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('страница без cookie: 307 на /login?next=', async () => {
    const r = await proxy(req('/games?q=1'));
    expect(r.status).toBe(307);
    expect(r.headers.get('location')).toBe(`${BASE}/login?next=${encodeURIComponent('/games?q=1')}`);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('API без cookie: 401 JSON, без редиректа', async () => {
    for (const p of ['/api/health', '/api/anything', '/api']) {
      const r = await proxy(req(p));
      expect(r.status).toBe(401);
      expect((await r.json()).error.code).toBe('unauthorized');
      expect(r.headers.get('location')).toBeNull();
    }
  });

  it('fail closed: SESSION_SECRET не задан, даже «валидный» токен не пускает', async () => {
    const t = await createSessionToken(SECRET);
    vi.stubEnv('SESSION_SECRET', '');
    expect((await proxy(req('/', { cookie: t }))).status).toBe(307);
    expect((await proxy(req('/api/health', { cookie: t }))).status).toBe(401);
  });

  it('валидная cookie пускает; /login редиректит на /', async () => {
    const t = await createSessionToken(SECRET);
    const ok = await proxy(req('/', { cookie: t }));
    expect(ok.headers.get('x-middleware-next')).toBe('1');
    const login = await proxy(req('/login', { cookie: t }));
    expect(login.status).toBe(307);
    expect(login.headers.get('location')).toBe(`${BASE}/`);
  });

  it('просроченная и подделанная cookie: нет сессии, cookie очищается', async () => {
    const old = await createSessionToken(SECRET, Date.now() - 31 * 24 * 3600 * 1000);
    const forged = (await createSessionToken('x'.repeat(40))) as string;
    for (const c of [old, forged, 'garbage']) {
      const r = await proxy(req('/', { cookie: c }));
      expect(r.status).toBe(307);
      expect(r.headers.get('set-cookie')).toMatch(/pst_session=;/);
    }
  });

  it('next не уходит на чужой хост: //evil.com и /\evil.com превращаются в /', async () => {
    for (const p of ['//evil.com', '/%5Cevil.com']) {
      const r = await proxy(new NextRequest(BASE + p));
      const loc = new URL(r.headers.get('location')!);
      expect(loc.origin).toBe(BASE);
      expect(loc.pathname).toBe('/login');
      const next = loc.searchParams.get('next')!;
      expect(next.startsWith('//')).toBe(false);
    }
  });

  it('/login и /api/auth/* открыты без сессии', async () => {
    for (const p of ['/login', '/api/auth/login', '/api/auth/logout']) {
      expect((await proxy(req(p, { method: 'POST' }))).headers.get('x-middleware-next')).toBe('1');
    }
  });

  it('cron: сессия не нужна, но нужен Bearer; без/с чужим секретом 401', async () => {
    expect((await proxy(req('/api/cron/sync'))).status).toBe(401);
    expect((await proxy(req('/api/cron/sync', { auth: 'Bearer wrong' }))).status).toBe(401);
    expect((await proxy(req('/api/cron/sync', { auth: CRON }))).status).toBe(401);
    expect((await proxy(req('/api/cron/sync', { auth: `Bearer ${CRON}` }))).headers.get('x-middleware-next')).toBe('1');
  });

  it('cron fail closed: CRON_SECRET не задан', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await proxy(req('/api/cron/sync', { auth: 'Bearer ' }))).status).toBe(401);
    expect((await proxy(req('/api/cron/sync', { auth: 'Bearer undefined' }))).status).toBe(401);
  });

  it('cookie сессии не заменяет Bearer для cron', async () => {
    const t = await createSessionToken(SECRET);
    expect((await proxy(req('/api/cron/sync', { cookie: t }))).status).toBe(401);
  });
});

describe('originAllowed', () => {
  const mk = (h: Record<string, string>) => new Request('http://x/api/auth/login', { method: 'POST', headers: h });
  it('нет Origin: ок; совпадает: ок; чужой или мусор: нет', () => {
    expect(originAllowed(mk({ host: 'a.test' }))).toBe(true);
    expect(originAllowed(mk({ host: 'a.test', origin: 'https://a.test' }))).toBe(true);
    expect(originAllowed(mk({ host: 'a.test', origin: 'https://evil.test' }))).toBe(false);
    expect(originAllowed(mk({ host: 'a.test', origin: 'null' }))).toBe(false);
    expect(originAllowed(mk({ host: 'a.test', origin: 'https://a.test.evil.test' }))).toBe(false);
  });
});

describe('B4: matcher', async () => {
  const { config } = await import('./proxy');
  const matches = (path: string) =>
    config.matcher.some((m) => (m.includes(':path*') ? path === '/api' || path.startsWith('/api/') : new RegExp(`^${m}$`).test(path)));
  it('/api/* никогда не пропускается по расширению', () => {
    for (const p of ['/api/x.png', '/api/x/[id].svg', '/api/a/b.woff2', '/api/favicon.ico', '/api/health']) expect(matches(p)).toBe(true);
  });
  it('статика вне /api пропускается, страницы нет', () => {
    for (const p of ['/logo.png', '/fonts/a.woff2', '/favicon.ico', '/_next/static/x.js']) expect(matches(p)).toBe(false);
    for (const p of ['/', '/games', '/login', '/apiary.png.html']) expect(matches(p)).toBe(true);
  });
});

describe('proxy: matcher', () => {
  // Next компилирует matcher через path-to-regexp; для негативного lookahead достаточно якорного RegExp.
  const config = configRef;
  const matches = (path: string) =>
    config.matcher.some((m) => (m === '/api/:path*' ? path === '/api' || path.startsWith('/api/') : new RegExp(`^${m}$`).test(path)));

  it('манифест и иконки не проходят через proxy', () => {
    for (const p of ['/manifest.webmanifest', '/icon.svg', '/favicon.ico', '/apple-icon.png', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/_next/static/a.js']) {
      expect(matches(p), p).toBe(false);
    }
  });

  it('страницы и любой /api/* остаются закрытыми', () => {
    for (const p of ['/', '/login', '/games', '/api/health', '/api/manifest.webmanifest', '/api/x.png', '/manifest.webmanifest/x']) {
      expect(matches(p), p).toBe(true);
    }
  });

  it('Фаза 39: /sw.js и /offline открыты без сессии, с CSP на nonce', async () => {
    for (const p of ['/sw.js', '/offline']) {
      const r = await proxy(req(p));
      expect(r.status, p).toBe(200);
      expect(r.headers.get('x-middleware-next')).toBe('1');
      expect(r.headers.get('content-security-policy')).toMatch(/script-src 'self' 'nonce-[^']+'/);
    }
    expect((await proxy(req('/offline/x'))).status).toBe(307);
  });

  it('Google-вход открыт без сессии, /api/auth/me закрыт', async () => {
    vi.stubEnv('SESSION_SECRET', SECRET);
    for (const p of ['/api/auth/google', '/api/auth/google/callback']) {
      const r = await proxy(req(p));
      expect(r.status).toBe(200);
      expect(r.headers.get('x-middleware-next')).toBe('1');
    }
    expect((await proxy(req('/api/auth/me'))).status).toBe(401);
    expect((await proxy(req('/api/access/users'))).status).toBe(401);
  });

  it('cookie v:2 проходит proxy (проверка подписи без БД)', async () => {
    vi.stubEnv('SESSION_SECRET', SECRET);
    const t = await createSessionTokenV2(SECRET, { uid: 3, role: 'member', amr: 'google' });
    expect((await proxy(req('/api/anything', { cookie: t }))).status).toBe(200);
  });

  it('CSP с nonce на каждом ответе (пропуск, 401, редирект), nonce свой на запрос и нет unsafe-inline в script-src', async () => {
    vi.stubEnv('SESSION_SECRET', SECRET);
    vi.stubEnv('CRON_SECRET', CRON);
    const t = await createSessionToken(SECRET);
    const rs = [await proxy(req('/', { cookie: t })), await proxy(req('/')), await proxy(req('/api/x')), await proxy(req('/login')), await proxy(req('/api/cron/sync'))];
    const nonces = new Set<string>();
    for (const r of rs) {
      const csp = r.headers.get('content-security-policy')!;
      const script = csp.split('; ').find((d) => d.startsWith('script-src'))!;
      const m = /'nonce-([A-Za-z0-9+/=]+)'/.exec(script);
      expect(m, script).not.toBeNull();
      expect(script).not.toContain('unsafe-inline');
      nonces.add(m![1]);
    }
    expect(nonces.size).toBe(rs.length);
    // запрос к странице получает тот же nonce в заголовках (x-nonce и CSP) для Next и layout
    const pass = rs[0];
    const nonce = /'nonce-([^']+)'/.exec(pass.headers.get('content-security-policy')!)![1];
    expect(pass.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(pass.headers.get('x-middleware-request-content-security-policy')).toContain(`'nonce-${nonce}'`);
  });

});
