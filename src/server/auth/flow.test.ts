// Интеграция входа Google и «Доступ»: PGlite со всеми миграциями, Google мокается через global fetch и свою пару RSA-ключей.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { type TestDb } from '@/server/sync/test-helpers';

import type { PGlite } from '@electric-sql/pglite';
const pgc = (x: TestDb) => (x.pg as unknown as { $client: PGlite }).$client;
let t: TestDb;
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => t.db }));

// лимит: управляемая подмена (БД-версия покрыта чистой логикой в limiter)
const attempts = { limited: false, successes: [] as number[], reserved: 0 };
vi.mock('./attempts', () => ({
  reserveLoginAttempt: vi.fn(async () => {
    if (attempts.limited) return { limited: true, retryAfterSeconds: 30 };
    return { limited: false, id: ++attempts.reserved };
  }),
  peekLoginLimit: vi.fn(async () => (attempts.limited ? { limited: true, retryAfterSeconds: 30 } : { limited: false })),
  markLoginSuccess: vi.fn(async (id: number) => void attempts.successes.push(id)),
}));

const { GET: googleStart } = await import('@/app/api/auth/google/route');
const { GET: googleCallback } = await import('@/app/api/auth/google/callback/route');
const { GET: me } = await import('@/app/api/auth/me/route');
const { POST: login } = await import('@/app/api/auth/login/route');
const { GET: listUsers, POST: addUser } = await import('@/app/api/access/users/route');
const { PATCH: patchUser, DELETE: delUser } = await import('@/app/api/access/users/[id]/route');
const { createSessionTokenV2, createSessionToken, SESSION_COOKIE } = await import('./session');
const { resetJwksCache, OAUTH_COOKIE } = await import('./google');
const { bootstrapOwner } = await import('./users');

const SECRET = 's'.repeat(40);
const CLIENT = 'cid';
const ORIGIN = 'https://app.example';
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'k1' };

let idClaims: Record<string, unknown> = {};
let tokenStatus = 200;
function signed(claims: Record<string, unknown>) {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1' })).toString('base64url');
  const c = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${h}.${c}.${createSign('RSA-SHA256').update(`${h}.${c}`).sign(keys.privateKey).toString('base64url')}`;
}

beforeAll(async () => {
  t = await (await import('@/server/sync/test-helpers')).createTestDb();
});
afterAll(() => t.close());

beforeEach(async () => {
  await pgc(t).exec('TRUNCATE allowed_users RESTART IDENTITY CASCADE');
  attempts.limited = false;
  attempts.successes = [];
  attempts.reserved = 0;
  resetJwksCache();
  tokenStatus = 200;
  vi.stubEnv('SESSION_SECRET', SECRET);
  vi.stubEnv('ADMIN_PASSWORD', 'correct-horse-battery');
  vi.stubEnv('GOOGLE_CLIENT_ID', CLIENT);
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'gsecret');
  vi.stubEnv('APP_ORIGIN', ORIGIN);
  vi.stubEnv('MULTIUSER_ENABLED', '0');
  vi.stubEnv('MAX_USERS', '10');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/certs')) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
    if (tokenStatus !== 200) return new Response('{}', { status: tokenStatus });
    return new Response(JSON.stringify({ id_token: signed(idClaims) }), { status: 200 });
  }));
  await bootstrapOwner(t.db, 'owner@x.com', 'ArtemPSN');
});

const cookieOf = (res: Response, name: string) => {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  return raw ? raw.split(';')[0].slice(name.length + 1) : undefined;
};

/** Проходит старт и callback; claims выдаёт «Google». */
async function googleLogin(claims: Partial<Record<string, unknown>>, opts: { state?: string; dropCookie?: boolean; next?: string } = {}) {
  const start = await googleStart(new Request(`${ORIGIN}/api/auth/google${opts.next ? `?next=${encodeURIComponent(opts.next)}` : ''}`, { headers: { 'x-forwarded-for': '9.9.9.9' } }));
  expect(start.status).toBe(302);
  const au = new URL(start.headers.get('location')!);
  const oauth = cookieOf(start, OAUTH_COOKIE)!;
  idClaims = { iss: 'https://accounts.google.com', aud: CLIENT, sub: 'sub-1', email: 'owner@x.com', email_verified: true, nonce: au.searchParams.get('nonce'), exp: Math.floor(Date.now() / 1000) + 600, ...claims };
  const cb = await googleCallback(
    new Request(`${ORIGIN}/api/auth/google/callback?code=abc&state=${opts.state ?? au.searchParams.get('state')}`, {
      headers: { cookie: opts.dropCookie ? '' : `${OAUTH_COOKIE}=${oauth}` },
    }),
  );
  return { start, cb, au };
}
const loc = (r: Response) => new URL(r.headers.get('location')!).pathname + new URL(r.headers.get('location')!).search;

describe('старт /api/auth/google', () => {
  it('302 на Google, cookie pst_oauth HttpOnly Secure Lax Path=/api/auth/google Max-Age=600', async () => {
    const r = await googleStart(new Request(`${ORIGIN}/api/auth/google?next=//evil.com`));
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toMatch(/^https:\/\/accounts\.google\.com\//);
    const raw = r.headers.getSetCookie().find((c) => c.startsWith(OAUTH_COOKIE))!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/Secure/i);
    expect(raw).toMatch(/SameSite=lax/i);
    expect(raw).toMatch(/Path=\/api\/auth\/google/);
    expect(raw).toMatch(/Max-Age=600/);
  });
  it('нет настроек: 500 config_error; лимит: 429 + Retry-After', async () => {
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
    const r = await googleStart(new Request(`${ORIGIN}/api/auth/google`));
    expect(r.status).toBe(500);
    expect((await r.json()).error.code).toBe('config_error');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'g');
    attempts.limited = true;
    const l = await googleStart(new Request(`${ORIGIN}/api/auth/google`));
    expect(l.status).toBe(429);
    expect(l.headers.get('retry-after')).toBe('30');
  });
});

describe('callback: вход', () => {
  it('owner из списка: привязка sub, сессия v:2 owner/google, редирект на next, cookie pst_oauth сброшена', async () => {
    const { cb } = await googleLogin({}, { next: '/games' });
    expect(cb.status).toBe(302);
    expect(loc(cb)).toBe('/games');
    const sess = cookieOf(cb, SESSION_COOKIE)!;
    expect(sess).toBeTruthy();
    expect(cb.headers.getSetCookie().find((c) => c.startsWith(OAUTH_COOKIE))).toMatch(/Max-Age=0/);
    const row = (await pgc(t).query<{ google_sub: string; last_login_at: string | null }>('select google_sub, last_login_at from allowed_users')).rows[0];
    expect(row.google_sub).toBe('sub-1');
    expect(row.last_login_at).not.toBeNull();
    expect(attempts.successes).toHaveLength(1);
    const m = await me(new Request(`${ORIGIN}/api/auth/me`, { headers: { cookie: `${SESSION_COOKIE}=${sess}` } }));
    expect(m.status).toBe(200);
    expect((await m.json()).data).toMatchObject({ id: 1, email: 'owner@x.com', role: 'owner', amr: 'google', psn: { onlineId: 'ArtemPSN', accessStatus: 'ok' } });
  });

  it('email в другом регистре и с пробелами находит запись', async () => {
    const { cb } = await googleLogin({ email: 'Owner@X.com' });
    expect(loc(cb)).toBe('/');
    expect(cookieOf(cb, SESSION_COOKIE)).toBeTruthy();
  });

  it('invited member -> active при первом входе (строка добавлена напрямую, минуя multiuser_not_ready)', async () => {
    await pgc(t).exec(`insert into allowed_users (email) values ('m@x.com')`);
    const { cb } = await googleLogin({ email: 'm@x.com', sub: 'sub-m' });
    expect(cookieOf(cb, SESSION_COOKIE)).toBeTruthy();
    expect((await pgc(t).query<{ status: string }>(`select status from allowed_users where email='m@x.com'`)).rows[0].status).toBe('active');
  });

  it.each([
    ['email не из списка', { email: 'stranger@x.com', sub: 'sub-z' }],
    ['email не подтверждён', { email_verified: false }],
  ])('%s: единый отказ access_denied, без сессии', async (_n, claims) => {
    const { cb } = await googleLogin(claims);
    expect(loc(cb)).toBe('/login?error=access_denied');
    expect(cookieOf(cb, SESSION_COOKIE)).toBeUndefined();
    expect(attempts.successes).toHaveLength(0);
  });

  it('blocked: тот же access_denied (по sub и по email)', async () => {
    await pgc(t).exec(`insert into allowed_users (email, status, google_sub) values ('b@x.com','blocked','sub-b'), ('c@x.com','blocked',null)`);
    expect(loc((await googleLogin({ email: 'b@x.com', sub: 'sub-b' })).cb)).toBe('/login?error=access_denied');
    expect(loc((await googleLogin({ email: 'c@x.com', sub: 'sub-c' })).cb)).toBe('/login?error=access_denied');
  });

  it('чужой sub: строка с email привязана к другому sub -> access_denied, привязка не меняется', async () => {
    await googleLogin({}); // привязали sub-1 к owner
    const { cb } = await googleLogin({ sub: 'sub-attacker' });
    expect(loc(cb)).toBe('/login?error=access_denied');
    expect((await pgc(t).query<{ google_sub: string }>('select google_sub from allowed_users')).rows[0].google_sub).toBe('sub-1');
  });

  it('вход по sub, даже если email в Google сменился на не из списка, работает по привязке', async () => {
    await googleLogin({});
    const { cb } = await googleLogin({ email: 'renamed@x.com' });
    expect(cookieOf(cb, SESSION_COOKIE)).toBeTruthy();
  });

  it('sub уже у другого пользователя: отказ без падения', async () => {
    await pgc(t).exec(`insert into allowed_users (email, google_sub) values ('m@x.com','sub-1')`);
    const { cb } = await googleLogin({ email: 'owner@x.com', sub: 'sub-1' });
    // найден по sub как member m@x.com: вход как m, не как owner
    const sess = cookieOf(cb, SESSION_COOKIE)!;
    const m = await me(new Request(`${ORIGIN}/api/auth/me`, { headers: { cookie: `${SESSION_COOKIE}=${sess}` } }));
    expect((await m.json()).data.email).toBe('m@x.com');
  });
});

describe('callback: протокольные ошибки -> oauth_failed', () => {
  it('нет cookie pst_oauth', async () => {
    expect(loc((await googleLogin({}, { dropCookie: true })).cb)).toBe('/login?error=oauth_failed');
  });
  it('state не совпал', async () => {
    expect(loc((await googleLogin({}, { state: 'forged' })).cb)).toBe('/login?error=oauth_failed');
  });
  it('неверный nonce в id_token', async () => {
    expect(loc((await googleLogin({ nonce: 'wrong' })).cb)).toBe('/login?error=oauth_failed');
  });
  it('чужой aud / истёкший токен', async () => {
    expect(loc((await googleLogin({ aud: 'x' })).cb)).toBe('/login?error=oauth_failed');
    expect(loc((await googleLogin({ exp: 1 })).cb)).toBe('/login?error=oauth_failed');
  });
  it('Google отвечает ошибкой на обмен кода', async () => {
    tokenStatus = 400;
    expect(loc((await googleLogin({})).cb)).toBe('/login?error=oauth_failed');
  });
  it('ошибка от Google в query (error=access_denied)', async () => {
    const r = await googleCallback(new Request(`${ORIGIN}/api/auth/google/callback?error=access_denied`));
    expect(loc(r)).toBe('/login?error=oauth_failed');
  });
  it('лимит исчерпан: /login?error=rate_limited, обмен кода не выполняется', async () => {
    attempts.limited = true;
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();
    const r = await googleCallback(new Request(`${ORIGIN}/api/auth/google/callback?code=a&state=b`));
    expect(loc(r)).toBe('/login?error=rate_limited');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('cookie одноразовая: ответ всегда её сбрасывает', async () => {
    const r = await googleCallback(new Request(`${ORIGIN}/api/auth/google/callback`));
    expect(r.headers.getSetCookie().find((c) => c.startsWith(OAUTH_COOKIE))).toMatch(/Max-Age=0/);
  });
  it('ответы не содержат email и токенов', async () => {
    const { cb } = await googleLogin({ email: 'stranger@x.com', sub: 'sub-z' });
    const all = cb.headers.get('location')! + cb.headers.getSetCookie().join(';');
    expect(all).not.toContain('stranger');
    expect(all).not.toContain('gsecret');
  });
});

describe('requireUser и роли (/api/auth/me)', () => {
  const get = (tok?: string) => me(new Request(`${ORIGIN}/api/auth/me`, { headers: tok ? { cookie: `${SESSION_COOKIE}=${tok}` } : {} }));

  it('без cookie и с битой cookie: 401, битая очищается', async () => {
    expect((await get()).status).toBe(401);
    const bad = await get('garbage');
    expect(bad.status).toBe(401);
    expect(bad.headers.getSetCookie().join()).toMatch(/Max-Age=0/);
  });
  it('роль берётся из БД: cookie с role=owner у member остаётся member', async () => {
    await pgc(t).exec(`insert into allowed_users (email, status) values ('m@x.com','active')`);
    const tok = await createSessionTokenV2(SECRET, { uid: 2, role: 'owner', amr: 'google' });
    expect((await (await get(tok)).json()).data.role).toBe('member');
  });
  it('blocked, удалённый, invited: 401 сразу', async () => {
    await pgc(t).exec(`insert into allowed_users (email, status) values ('b@x.com','blocked'), ('i@x.com','invited')`);
    expect((await get(await createSessionTokenV2(SECRET, { uid: 2, role: 'member', amr: 'google' }))).status).toBe(401);
    expect((await get(await createSessionTokenV2(SECRET, { uid: 3, role: 'member', amr: 'google' }))).status).toBe(401);
    expect((await get(await createSessionTokenV2(SECRET, { uid: 99, role: 'member', amr: 'google' }))).status).toBe(401);
  });
  it('старая cookie v:1 работает как owner', async () => {
    const r = await get(await createSessionToken(SECRET));
    expect(r.status).toBe(200);
    expect((await r.json()).data).toMatchObject({ id: 1, role: 'owner', email: 'owner@x.com' });
  });
  it('v:1 при заблокированном/отсутствующем owner не проходит', async () => {
    await pgc(t).exec('TRUNCATE allowed_users RESTART IDENTITY CASCADE');
    expect((await get(await createSessionToken(SECRET))).status).toBe(401);
  });
});

describe('аварийный вход паролем', () => {
  const pwd = (password: string) => login(new Request(`${ORIGIN}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', host: 'app.example' }, body: JSON.stringify({ password }) }));
  it('выдаёт v:2 owner/pwd', async () => {
    const r = await pwd('correct-horse-battery');
    expect(r.status).toBe(200);
    const m = await me(new Request(`${ORIGIN}/api/auth/me`, { headers: { cookie: `${SESSION_COOKIE}=${cookieOf(r, SESSION_COOKIE)}` } }));
    expect((await m.json()).data).toMatchObject({ role: 'owner', amr: 'pwd', id: 1 });
  });
  it('нет owner или owner blocked в БД: 401 invalid_credentials', async () => {
    await pgc(t).exec('TRUNCATE allowed_users RESTART IDENTITY CASCADE');
    expect((await pwd('correct-horse-battery')).status).toBe(401);
  }, 10000);
}, 20000);

describe('API «Доступ»', () => {
  const ownerCookie = async () => `${SESSION_COOKIE}=${await createSessionTokenV2(SECRET, { uid: 1, role: 'owner', amr: 'google' })}`;
  const json = (method: string, url: string, body: unknown, cookie: string) =>
    new Request(`${ORIGIN}${url}`, { method, headers: { cookie, 'content-type': 'application/json', host: 'app.example' }, body: JSON.stringify(body) });
  const ctx = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) });

  it('GET: без сессии 401, member 403, owner 200 с owner в списке', async () => {
    expect((await listUsers(new Request(`${ORIGIN}/api/access/users`))).status).toBe(401);
    await pgc(t).exec(`insert into allowed_users (email, status) values ('m@x.com','active')`);
    const mc = `${SESSION_COOKIE}=${await createSessionTokenV2(SECRET, { uid: 2, role: 'owner', amr: 'google' })}`; // cookie врёт про роль
    const f = await listUsers(new Request(`${ORIGIN}/api/access/users`, { headers: { cookie: mc } }));
    expect(f.status).toBe(403);
    expect((await f.json()).error.code).toBe('forbidden');
    const r = await listUsers(new Request(`${ORIGIN}/api/access/users`, { headers: { cookie: await ownerCookie() } }));
    const d = (await r.json()).data;
    expect(d.users.map((u: { id: number }) => u.id)).toEqual([1, 2]);
    expect(d.users[0]).toMatchObject({ email: 'owner@x.com', role: 'owner', status: 'active', psnOnlineId: 'ArtemPSN', gamesCount: 0, lastSyncAt: null });
    expect(Object.keys(d.users[0]).sort()).toEqual(['createdAt', 'displayName', 'email', 'gamesCount', 'id', 'lastLoginAt', 'lastSyncAt', 'psnAccessStatus', 'psnOnlineId', 'role', 'status']);
  });

  it('POST при MULTIUSER_ENABLED != 1: 409 multiuser_not_ready, никого не создаёт', async () => {
    const r = await addUser(json('POST', '/api/access/users', { email: 'new@x.com' }, await ownerCookie()));
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe('multiuser_not_ready');
    expect((await pgc(t).query('select 1 from allowed_users')).rows).toHaveLength(1);
  });

  describe('с MULTIUSER_ENABLED=1', () => {
    beforeEach(() => vi.stubEnv('MULTIUSER_ENABLED', '1'));

    it('POST создаёт invited member с нормализованным email, 201', async () => {
      const r = await addUser(json('POST', '/api/access/users', { email: '  New@X.com ' }, await ownerCookie()));
      expect(r.status).toBe(201);
      expect((await r.json()).data.user).toMatchObject({ id: 2, email: 'new@x.com', role: 'member', status: 'invited' });
    });
    it('валидация: плохой email, role=owner, не JSON, чужой Origin', async () => {
      const c = await ownerCookie();
      expect((await addUser(json('POST', '/api/access/users', { email: 'nope' }, c))).status).toBe(400);
      expect((await addUser(json('POST', '/api/access/users', { email: 'a@x.com', role: 'owner' }, c))).status).toBe(400);
      const form = new Request(`${ORIGIN}/api/access/users`, { method: 'POST', headers: { cookie: c, 'content-type': 'text/plain', host: 'app.example' }, body: '{}' });
      expect((await addUser(form)).status).toBe(400);
      const evil = json('POST', '/api/access/users', { email: 'a@x.com' }, c);
      evil.headers.set('origin', 'https://evil.example');
      expect((await addUser(evil)).status).toBe(400);
    });
    it('дубликат: 409 user_exists (в т.ч. другой регистр)', async () => {
      const c = await ownerCookie();
      expect((await addUser(json('POST', '/api/access/users', { email: 'OWNER@x.com' }, c))).status).toBe(409);
    });
    it('MAX_USERS: сверх лимита 409 user_limit; blocked в лимит не входит', async () => {
      vi.stubEnv('MAX_USERS', '3');
      const c = await ownerCookie();
      expect((await addUser(json('POST', '/api/access/users', { email: 'a@x.com' }, c))).status).toBe(201);
      expect((await addUser(json('POST', '/api/access/users', { email: 'b@x.com' }, c))).status).toBe(201);
      const over = await addUser(json('POST', '/api/access/users', { email: 'c@x.com' }, c));
      expect(over.status).toBe(409);
      expect((await over.json()).error.code).toBe('user_limit');
      await patchUser(json('PATCH', '/api/access/users/2', { status: 'blocked' }, c), ctx(2));
      expect((await addUser(json('POST', '/api/access/users', { email: 'c@x.com' }, c))).status).toBe(201);
      // разблокировка тоже уважает лимит
      const un = await patchUser(json('PATCH', '/api/access/users/2', { status: 'active' }, c), ctx(2));
      expect(un.status).toBe(409);
    });
    it('одновременные POST не обходят MAX_USERS', async () => {
      vi.stubEnv('MAX_USERS', '3');
      const c = await ownerCookie();
      const rs = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((n) => addUser(json('POST', '/api/access/users', { email: `${n}@x.com` }, c))));
      expect(rs.filter((r) => r.status === 201)).toHaveLength(2);
    });
    it('PATCH: блокировка действует на следующий запрос; разблокировка вернёт invited, если не входил', async () => {
      const c = await ownerCookie();
      await pgc(t).exec(`insert into allowed_users (email, status, google_sub, last_login_at) values ('m@x.com','active','sub-m', now()), ('n@x.com','invited',null,null)`);
      const memberCookie = `${SESSION_COOKIE}=${await createSessionTokenV2(SECRET, { uid: 2, role: 'member', amr: 'google' })}`;
      expect((await me(new Request(`${ORIGIN}/api/auth/me`, { headers: { cookie: memberCookie } }))).status).toBe(200);
      expect((await patchUser(json('PATCH', '/api/access/users/2', { status: 'blocked' }, c), ctx(2))).status).toBe(200);
      expect((await me(new Request(`${ORIGIN}/api/auth/me`, { headers: { cookie: memberCookie } }))).status).toBe(401);
      expect((await (await patchUser(json('PATCH', '/api/access/users/2', { status: 'active' }, c), ctx(2))).json()).data.user.status).toBe('active');
      await patchUser(json('PATCH', '/api/access/users/3', { status: 'blocked' }, c), ctx(3));
      expect((await (await patchUser(json('PATCH', '/api/access/users/3', { status: 'active' }, c), ctx(3))).json()).data.user.status).toBe('invited');
    });
    it('PATCH: owner защищён, себя нельзя, 404, плохое тело, psnAccessMode', async () => {
      const c = await ownerCookie();
      const own = await patchUser(json('PATCH', '/api/access/users/1', { status: 'blocked' }, c), ctx(1));
      expect(own.status).toBe(409);
      expect((await own.json()).error.code).toBe('owner_protected');
      expect((await patchUser(json('PATCH', '/api/access/users/77', { status: 'blocked' }, c), ctx(77))).status).toBe(404);
      expect((await patchUser(json('PATCH', '/api/access/users/1', {}, c), ctx(1))).status).toBe(400);
      expect((await patchUser(json('PATCH', '/api/access/users/abc', { status: 'blocked' }, c), ctx('abc'))).status).toBe(400);
      expect((await patchUser(json('PATCH', '/api/access/users/1', { status: 'invited' }, c), ctx(1))).status).toBe(400);
      await pgc(t).exec(`insert into allowed_users (email, status) values ('m@x.com','active')`);
      const m = await patchUser(json('PATCH', '/api/access/users/2', { psnAccessMode: 'friend' }, c), ctx(2));
      expect(m.status).toBe(200);
      expect((await pgc(t).query<{ psn_access_mode: string }>('select psn_access_mode from allowed_users where id=2')).rows[0].psn_access_mode).toBe('friend');
    });
    it('PATCH/DELETE от member: 403', async () => {
      await pgc(t).exec(`insert into allowed_users (email, status) values ('m@x.com','active')`);
      const mc = `${SESSION_COOKIE}=${await createSessionTokenV2(SECRET, { uid: 2, role: 'member', amr: 'google' })}`;
      expect((await patchUser(json('PATCH', '/api/access/users/1', { status: 'blocked' }, mc), ctx(1))).status).toBe(403);
      expect((await delUser(json('DELETE', '/api/access/users/1', { confirmEmail: 'owner@x.com' }, mc), ctx(1))).status).toBe(403);
      expect((await addUser(json('POST', '/api/access/users', { email: 'z@x.com' }, mc))).status).toBe(403);
    });
    it('DELETE: только blocked/invited, нужен confirmEmail, owner и себя нельзя', async () => {
      const c = await ownerCookie();
      await pgc(t).exec(`insert into allowed_users (email, status) values ('a@x.com','active'), ('b@x.com','blocked'), ('i@x.com','invited')`);
      const act = await delUser(json('DELETE', '/api/access/users/2', { confirmEmail: 'a@x.com' }, c), ctx(2));
      expect(act.status).toBe(409);
      expect((await act.json()).error.code).toBe('not_blocked');
      const mism = await delUser(json('DELETE', '/api/access/users/3', { confirmEmail: 'other@x.com' }, c), ctx(3));
      expect(mism.status).toBe(400);
      expect((await mism.json()).error.code).toBe('confirm_mismatch');
      expect((await (await delUser(json('DELETE', '/api/access/users/3', { confirmEmail: 'B@x.com' }, c), ctx(3))).json()).data).toEqual({ deleted: true });
      expect((await delUser(json('DELETE', '/api/access/users/4', { confirmEmail: 'i@x.com' }, c), ctx(4))).status).toBe(200);
      expect((await delUser(json('DELETE', '/api/access/users/3', { confirmEmail: 'b@x.com' }, c), ctx(3))).status).toBe(404);
      const ow = await delUser(json('DELETE', '/api/access/users/1', { confirmEmail: 'owner@x.com' }, c), ctx(1));
      expect(ow.status).toBe(409);
      expect((await ow.json()).error.code).toBe('owner_protected');
      expect((await delUser(json('DELETE', '/api/access/users/2', {}, c), ctx(2))).status).toBe(400);
    });
  });
});

describe('схема allowed_users', () => {
  it('ровно один owner, уникальные email/sub, owner не blocked, CHECK email', async () => {
    const x = (sql: string) => pgc(t).exec(sql);
    await expect(x(`insert into allowed_users (email, role) values ('o2@x.com','owner')`)).rejects.toThrow();
    await expect(x(`insert into allowed_users (email) values ('owner@x.com')`)).rejects.toThrow();
    await expect(x(`update allowed_users set status='blocked' where role='owner'`)).rejects.toThrow();
    await expect(x(`insert into allowed_users (email) values ('bad email@x')`)).rejects.toThrow();
    await expect(x(`insert into allowed_users (email, status) values ('s@x.com','weird')`)).rejects.toThrow();
    await x(`insert into allowed_users (email, google_sub) values ('p@x.com','dup'), ('q@x.com',null), ('r@x.com',null)`);
    await expect(x(`insert into allowed_users (email, google_sub) values ('s@x.com','dup')`)).rejects.toThrow();
  });
  it('runBootstrapOwner: id=1 даёт 0, id<>1 даёт 1 без email в сообщении', async () => {
    const { runBootstrapOwner } = await import('./users');
    const ok = await runBootstrapOwner(t.db, 'owner@x.com', null);
    expect(ok.code).toBe(0);
    await pgc(t).exec('TRUNCATE allowed_users CASCADE'); // без RESTART IDENTITY: следующий id = 2
    const bad = await runBootstrapOwner(t.db, 'secret-owner@x.com', null);
    expect(bad.code).toBe(1);
    expect(bad.message).toContain('должен быть 1');
    expect(bad.message).not.toContain('secret-owner');
    const again = await runBootstrapOwner(t.db, 'secret-owner@x.com', null); // уже существующий owner с id=2
    expect(again.code).toBe(1);
  });

  it('bootstrapOwner идемпотентен', async () => {
    expect(await bootstrapOwner(t.db, 'owner@x.com', null)).toBe(false);
    expect(await bootstrapOwner(t.db, 'other@x.com', null)).toBe(false);
    expect((await pgc(t).query('select 1 from allowed_users')).rows).toHaveLength(1);
  });
  it('login_attempts.kind: default password, CHECK', async () => {
    await pgc(t).exec(`insert into login_attempts (ip_hash, success) values ('h', false)`);
    expect((await pgc(t).query<{ kind: string }>('select kind from login_attempts')).rows[0].kind).toBe('password');
    await expect(pgc(t).exec(`insert into login_attempts (ip_hash, success, kind) values ('h', false, 'sms')`)).rejects.toThrow();
  });
});

