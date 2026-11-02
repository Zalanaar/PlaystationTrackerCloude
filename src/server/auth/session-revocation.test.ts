// Фаза 45: отзыв сессий на сервере. «Выйти» отзывает текущую сессию (копия cookie больше не пускает), «Выйти на всех устройствах»
// поднимает эпоху входа (все cookie входа, включая доп. профили, отклоняются). requireUser и роуты на PGlite с настоящими cookie.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { b64urlEncode, createSessionTokenV2, readSessionToken, reissueSessionToken, sessionRevocationKey, SESSION_COOKIE, SESSION_TTL_SECONDS } from './session';
import { KIT_SECRET, kitRequest, setCookieToken } from './profile-test-kit';

let t: TestDb;
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => t.db }));
const { requireUser } = await import('./require-user');
const { revokeSession } = await import('./revocation');
const { POST: logout } = await import('@/app/api/auth/logout/route');
const { POST: logoutAll } = await import('@/app/api/auth/logout-all/route');
const { POST: switchProfile } = await import('@/app/api/me/profiles/active/route');

const client = () => (t.pg as unknown as { $client: import('@electric-sql/pglite').PGlite }).$client;
const enc = new TextEncoder();
async function forge(payload: object): Promise<string> {
  const p = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey('raw', enc.encode(KIT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${p}.${b64urlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(p))))}`;
}

const token = (uid: number, se = 0) => createSessionTokenV2(KIT_SECRET, { uid, role: uid === 1 ? 'owner' : 'member', amr: 'google', se });
const cookie = (tok: string) => `${SESSION_COOKIE}=${tok}`;
const auth = (tok: string) => requireUser(kitRequest('/api/x', { cookie: cookie(tok) }));
const post = (fn: (r: Request) => Promise<Response>, path: string, tok?: string, origin?: string | null) =>
  fn(kitRequest(path, { method: 'POST', cookie: tok ? cookie(tok) : undefined, body: {}, origin }));
const epoch = async (id: number) => (await client().query<{ e: number }>(`select session_epoch as e from allowed_users where id = $1`, [id])).rows[0].e;
const revokedCount = async () => (await client().query<{ n: number }>(`select count(*)::int as n from revoked_sessions`)).rows[0].n;

// 1 owner, 2 member, 3 = доп. профиль входа 2
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());
beforeEach(async () => {
  vi.stubEnv('SESSION_SECRET', KIT_SECRET);
  await client().exec(`
    TRUNCATE allowed_users, revoked_sessions RESTART IDENTITY CASCADE;
    insert into allowed_users (email, role, status, psn_online_id, psn_account_id) values ('a@x.com', 'owner', 'active', 'NickA', 'acc1');
    insert into allowed_users (email, role, status, psn_online_id, psn_account_id) values ('b@x.com', 'member', 'active', 'NickB', 'acc2');
    insert into allowed_users (email, role, status, primary_user_id, psn_online_id, psn_account_id) values ('b@x.com', 'member', 'active', 2, 'NickB2', 'acc3');
  `);
});

describe('токен: sid и эпоха', () => {
  it('новый токен несёт случайный sid; эпоха 0 не пишется, но читается как 0', async () => {
    const a = await readSessionToken(await token(2), KIT_SECRET);
    const b = await readSessionToken(await token(2), KIT_SECRET);
    expect(a!.sid).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a!.sid).not.toBe(b!.sid);
    expect(a!.se).toBe(0);
    expect((await readSessionToken(await token(2, 3), KIT_SECRET))!.se).toBe(3);
  });

  it('переключение профиля сохраняет sid и эпоху', async () => {
    const s = (await readSessionToken(await token(2, 4), KIT_SECRET))!;
    const r = (await readSessionToken(await reissueSessionToken(KIT_SECRET, s, 3), KIT_SECRET))!;
    expect([r.sid, r.se, r.pid, r.iat, r.exp]).toEqual([s.sid, 4, 3, s.iat, s.exp]);
  });

  it('старый токен без sid/se: эпоха 0, ключ отзыва uid+iat', async () => {
    const iat = Math.floor(Date.now() / 1000);
    const s = (await readSessionToken(await forge({ v: 2, uid: 2, role: 'member', amr: 'google', iat, exp: iat + SESSION_TTL_SECONDS }), KIT_SECRET))!;
    expect(s.se).toBe(0);
    expect(s.sid).toBeUndefined();
    expect(sessionRevocationKey(s)).toBe(`legacy-2-${iat}`);
  });

  it('некорректные sid/se с верной подписью отвергаются', async () => {
    const iat = Math.floor(Date.now() / 1000);
    const base = { v: 2, uid: 2, role: 'member', amr: 'google', iat, exp: iat + 60 };
    for (const extra of [{ sid: 'short' }, { sid: 7 }, { sid: 'a b'.repeat(10) }, { se: -1 }, { se: 1.5 }, { se: '1' }]) {
      expect(await readSessionToken(await forge({ ...base, ...extra }), KIT_SECRET), JSON.stringify(extra)).toBeNull();
    }
  });
});

describe('«Выйти»: текущая сессия отзывается на сервере', () => {
  it('после выхода та же cookie даёт 401 и очищается; другая сессия того же входа работает', async () => {
    const phone = await token(2);
    const laptop = await token(2);
    expect((await auth(phone)).ok).toBe(true);
    const res = await post(logout, '/api/auth/logout', phone);
    expect(res.status).toBe(200);
    expect(setCookieToken(res)).toBe('');
    expect(await res.json()).toMatchObject({ ok: true, data: { revoked: true } });
    const again = await auth(phone);
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.response.status).toBe(401);
      expect(setCookieToken(again.response)).toBe('');
    }
    expect((await auth(laptop)).ok).toBe(true);
  });

  it('отзыв переживает переключение профиля (sid тот же)', async () => {
    const tok = await token(2);
    const sw = await switchProfile(kitRequest('/api/me/profiles/active', { method: 'POST', cookie: cookie(tok), body: { profileId: 3 } }));
    expect(sw.status).toBe(200);
    const switched = setCookieToken(sw)!;
    expect((await auth(switched)).ok).toBe(true);
    await post(logout, '/api/auth/logout', tok);
    expect((await auth(switched)).ok).toBe(false);
  });

  it('старый токен без sid тоже отзывается', async () => {
    const iat = Math.floor(Date.now() / 1000);
    const legacy = await forge({ v: 2, uid: 2, role: 'member', amr: 'google', iat, exp: iat + SESSION_TTL_SECONDS });
    expect((await auth(legacy)).ok).toBe(true);
    await post(logout, '/api/auth/logout', legacy);
    expect((await auth(legacy)).ok).toBe(false);
  });

  it('повторный выход идемпотентен; без cookie и с мусором просто 200', async () => {
    const tok = await token(1);
    expect((await post(logout, '/api/auth/logout', tok)).status).toBe(200);
    expect((await post(logout, '/api/auth/logout', tok)).status).toBe(200);
    expect(await revokedCount()).toBe(1);
    expect((await post(logout, '/api/auth/logout')).status).toBe(200);
    expect((await post(logout, '/api/auth/logout', 'garbage.token')).status).toBe(200);
    expect(await revokedCount()).toBe(1);
  });

  it('просроченные записи отзыва удаляются при следующем выходе', async () => {
    const old = (await readSessionToken(await token(2), KIT_SECRET))!;
    await revokeSession(t.db, { ...old, exp: Math.floor(Date.now() / 1000) - 10 });
    expect(await revokedCount()).toBe(0); // сразу истёкшая запись удаляется тем же вызовом
    await revokeSession(t.db, { ...old, sid: 'x'.repeat(22), exp: Math.floor(Date.now() / 1000) + 100 });
    await client().exec(`update revoked_sessions set expires_at = now() - interval '1 second'`);
    await post(logout, '/api/auth/logout', await token(1));
    const rows = (await client().query<{ user_id: number }>(`select user_id from revoked_sessions`)).rows;
    expect(rows).toEqual([{ user_id: 1 }]);
  });

  it('чужой Origin: 400, сессия не отзывается', async () => {
    const tok = await token(2);
    expect((await post(logout, '/api/auth/logout', tok, 'https://evil.example')).status).toBe(400);
    expect((await auth(tok)).ok).toBe(true);
  });
});

describe('«Выйти на всех устройствах»', () => {
  it('member: эпоха +1, все его сессии (и доп. профиль) отклоняются, владелец не задет', async () => {
    const a = await token(2);
    const b = await token(2);
    const owner = await token(1);
    const sw = await switchProfile(kitRequest('/api/me/profiles/active', { method: 'POST', cookie: cookie(b), body: { profileId: 3 } }));
    const bProfile = setCookieToken(sw)!;
    const res = await post(logoutAll, '/api/auth/logout-all', a);
    expect(res.status).toBe(200);
    expect(setCookieToken(res)).toBe('');
    expect(await epoch(2)).toBe(1);
    expect(await epoch(3)).toBe(0); // эпоха только у строки входа
    for (const tok of [a, b, bProfile]) expect((await auth(tok)).ok).toBe(false);
    expect((await auth(owner)).ok).toBe(true);
  });

  it('новый вход после этого получает новую эпоху и работает', async () => {
    await post(logoutAll, '/api/auth/logout-all', await token(1));
    expect(await epoch(1)).toBe(1);
    expect((await auth(await token(1, 0))).ok).toBe(false);
    expect((await auth(await token(1, 1))).ok).toBe(true);
  });

  it('старые токены без эпохи тоже перестают действовать', async () => {
    const iat = Math.floor(Date.now() / 1000);
    const legacy = await forge({ v: 2, uid: 1, role: 'owner', amr: 'pwd', iat, exp: iat + SESSION_TTL_SECONDS });
    await post(logoutAll, '/api/auth/logout-all', await token(1));
    expect((await auth(legacy)).ok).toBe(false);
  });

  it('без сессии или с отозванной: 401, эпоха не меняется; чужой Origin: 400', async () => {
    expect((await post(logoutAll, '/api/auth/logout-all')).status).toBe(401);
    const tok = await token(2);
    expect((await post(logoutAll, '/api/auth/logout-all', tok, 'https://evil.example')).status).toBe(400);
    expect(await epoch(2)).toBe(0);
    await post(logout, '/api/auth/logout', tok);
    expect((await post(logoutAll, '/api/auth/logout-all', tok)).status).toBe(401);
    expect(await epoch(2)).toBe(0);
  });
});
