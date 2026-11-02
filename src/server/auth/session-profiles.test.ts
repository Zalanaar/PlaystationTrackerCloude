// Фаза 41 (41.2, 41.6): pid в сессии и проверка принадлежности профиля на КАЖДОМ запросе (requireUser на PGlite с настоящими cookie).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { b64urlEncode, createSessionTokenV2, readSessionToken, reissueSessionToken, SESSION_TTL_SECONDS } from './session';
import { KIT_SECRET, sessionCookie, setCookieToken } from './profile-test-kit';
import { patchUser, resolveAuthContext } from './users';
import { kitRequest } from './profile-test-kit';

let t: TestDb;
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => t.db }));
const { requireUser, requireOwner } = await import('./require-user');
const { POST: switchProfile } = await import('@/app/api/me/profiles/active/route');

const enc = new TextEncoder();
async function forge(payload: object): Promise<string> {
  const p = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey('raw', enc.encode(KIT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `pst_session=${p}.${b64urlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(p))))}`;
}

// 1 owner (вход A), 2 member (вход B), 3 = доп. профиль входа A, 4 = доп. профиль входа B, 5 = архивный доп. профиль входа B
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());
beforeEach(async () => {
  vi.stubEnv('SESSION_SECRET', KIT_SECRET);
  const c = (t.pg as unknown as { $client: import('@electric-sql/pglite').PGlite }).$client;
  await c.exec(`
    TRUNCATE allowed_users RESTART IDENTITY CASCADE;
    insert into allowed_users (email, role, status, psn_online_id, psn_account_id) values ('a@x.com', 'owner', 'active', 'NickA', 'acc1');
    insert into allowed_users (email, role, status, psn_online_id, psn_account_id) values ('b@x.com', 'member', 'active', 'NickB', 'acc2');
    insert into allowed_users (email, role, status, primary_user_id, psn_online_id, psn_account_id) values ('a@x.com', 'member', 'active', 1, 'NickA2', 'acc3');
    insert into allowed_users (email, role, status, primary_user_id, psn_online_id, psn_account_id) values ('b@x.com', 'member', 'active', 2, 'NickB2', 'acc4');
    insert into allowed_users (email, role, status, primary_user_id, psn_online_id, psn_account_id, archived_at) values ('b@x.com', 'member', 'archived', 2, 'NickB3', 'acc5', now());
    update allowed_users set last_login_at = now() where id in (1, 2);
  `);
});

const auth = async (uid: number, pid?: number) => requireUser(kitRequest('/api/x', { cookie: await sessionCookie(uid, { pid, role: uid === 1 ? 'owner' : 'member' }) }));

describe('сессия: pid', () => {
  it('cookie без pid (все действующие) открывает основной профиль', async () => {
    const r = await auth(2);
    expect(r.ok && [r.user.id, r.user.loginId, r.user.profileRole]).toEqual([2, 2, 'member']);
  });

  it('свой дополнительный профиль: id = pid, loginId = вход, роль входа из БД', async () => {
    const r = await auth(1, 3);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect([r.user.id, r.user.loginId, r.user.role, r.user.profileRole, r.user.row.psnOnlineId]).toEqual([3, 1, 'owner', 'member', 'NickA2']);
    }
  });

  it('подмена pid на профиль чужого входа с валидной подписью: 401 и cookie очищена', async () => {
    for (const [uid, pid] of [[1, 4], [1, 2], [2, 3], [1, 5], [2, 1]]) {
      const res = await auth(uid, pid);
      expect(res.ok, `uid=${uid} pid=${pid}`).toBe(false);
      if (!res.ok) {
        expect(res.response.status).toBe(401);
        expect(setCookieToken(res.response)).toBe('');
      }
    }
  });

  it('uid указывает на дополнительную строку (не вход): 401', async () => {
    const res = await auth(3);
    expect(res.ok).toBe(false);
    expect((await auth(3, 3)).ok).toBe(false);
  });

  it('профиль архивирован или удалён при живой сессии: обслуживается основной, cookie не переписывается', async () => {
    for (const pid of [5, 999]) {
      const r = await auth(2, pid);
      expect(r.ok && [r.user.id, r.user.loginId]).toEqual([2, 2]);
    }
    const arch = await auth(2, 4);
    expect(arch.ok && arch.user.id).toBe(4);
    const c = (t.pg as unknown as { $client: import('@electric-sql/pglite').PGlite }).$client;
    await c.exec(`update allowed_users set status = 'archived', archived_at = now() where id = 4`);
    const after = await auth(2, 4);
    expect(after.ok && after.user.id).toBe(2);
  });

  it('блокировка входа: сессия с pid и без него = 401, все строки входа blocked', async () => {
    expect((await patchUser(t.db, 1, { status: 'blocked' }, 10)).ok).toBe(false); // owner защищён
    expect(await patchUser(t.db, 4, { status: 'blocked' }, 10)).toEqual({ ok: true }); // id ДОПОЛНИТЕЛЬНОЙ строки блокирует вход B целиком
    const rows = (await t.db.execute(`select id, status from allowed_users order by id`)) as unknown as { rows: { id: number; status: string }[] };
    expect(rows.rows.map((r) => [r.id, r.status])).toEqual([[1, 'active'], [2, 'blocked'], [3, 'active'], [4, 'blocked'], [5, 'archived']]);
    for (const pid of [undefined, 4]) {
      const res = await auth(2, pid);
      expect(res.ok).toBe(false);
      if (!res.ok) expect([res.response.status, setCookieToken(res.response)]).toEqual([401, '']);
    }
    expect((await auth(1, 3)).ok).toBe(true); // соседний вход жив
    expect(await patchUser(t.db, 2, { status: 'active' }, 10)).toEqual({ ok: true });
    const back = await auth(2, 4);
    expect(back.ok && back.user.id).toBe(4);
  });

  it('разблокировка не превышает MAX_USERS, профили считаются', async () => {
    await patchUser(t.db, 2, { status: 'blocked' }, 10);
    expect(await patchUser(t.db, 2, { status: 'active' }, 3)).toEqual({ ok: false, reason: 'limit' }); // 1,3 active + 2 (вход B с доп. профилем)
    expect(await patchUser(t.db, 2, { status: 'active' }, 4)).toEqual({ ok: true });
  });

  it('роль входа и права: доп. профиль владельца открывает «владельческие» роуты по роли входа', async () => {
    const ok = await requireOwner(kitRequest('/api/x', { cookie: await sessionCookie(1, { pid: 3, role: 'owner' }) }));
    expect(ok.ok).toBe(true);
    const no = await requireOwner(kitRequest('/api/x', { cookie: await sessionCookie(2, { pid: 4 }) }));
    expect(no.ok).toBe(false);
  });

  it('эскалация роли: cookie с role=owner у member игнорируется (роль из БД), в БД доп. профиль не может быть owner', async () => {
    const forged = await forge({ v: 2, uid: 2, pid: 4, role: 'owner', amr: 'google', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 1000 });
    const r = await requireOwner(kitRequest('/api/x', { cookie: forged }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(403);
    const c = (t.pg as unknown as { $client: import('@electric-sql/pglite').PGlite }).$client;
    await expect(c.exec(`update allowed_users set role = 'owner' where id = 4`)).rejects.toThrow();
    await expect(c.exec(`update allowed_users set google_sub = 'zzz' where id = 4`)).rejects.toThrow();
  });

  it('resolveAuthContext: вход удалён = null', async () => {
    const c = (t.pg as unknown as { $client: import('@electric-sql/pglite').PGlite }).$client;
    await c.exec(`delete from allowed_users where id = 2`);
    expect(await resolveAuthContext(t.db, 2, 4)).toBeNull();
    expect(await resolveAuthContext(t.db, 2, undefined)).toBeNull();
  });
});

describe('токен: форма pid и продление', () => {
  const NOW = 1_800_000_000_000;
  it('pid читается; pid = uid нормализуется; плохой pid с верной подписью отвергается', async () => {
    const t1 = await createSessionTokenV2(KIT_SECRET, { uid: 2, pid: 4, role: 'member', amr: 'google' }, NOW);
    expect(await readSessionToken(t1, KIT_SECRET, NOW)).toMatchObject({ uid: 2, pid: 4 });
    const t2 = await createSessionTokenV2(KIT_SECRET, { uid: 2, pid: 2, role: 'member', amr: 'google' }, NOW);
    expect((await readSessionToken(t2, KIT_SECRET, NOW))?.pid).toBeUndefined();
    await expect(createSessionTokenV2(KIT_SECRET, { uid: 2, pid: 0, role: 'member', amr: 'google' }, NOW)).rejects.toThrow();
    const base = { v: 2, uid: 2, role: 'member', amr: 'google', iat: NOW / 1000, exp: NOW / 1000 + 100 };
    for (const pid of [0, -1, 1.5, '4', null, true]) {
      const tok = (await forge({ ...base, pid })).slice('pst_session='.length);
      expect(await readSessionToken(tok, KIT_SECRET, NOW), String(pid)).toBeNull();
    }
  });

  it('переключение не продлевает срок: те же iat/exp', async () => {
    const tok = await createSessionTokenV2(KIT_SECRET, { uid: 2, role: 'member', amr: 'google' }, NOW);
    const s = (await readSessionToken(tok, KIT_SECRET, NOW + 5 * 86_400_000))!;
    const re = await readSessionToken(await reissueSessionToken(KIT_SECRET, s, 4), KIT_SECRET, NOW + 5 * 86_400_000);
    expect(re).toMatchObject({ uid: 2, pid: 4, iat: s.iat, exp: s.exp });
    expect(re!.exp - re!.iat).toBe(SESSION_TTL_SECONDS);
    const back = await readSessionToken(await reissueSessionToken(KIT_SECRET, re!, 2), KIT_SECRET, NOW);
    expect(back?.pid).toBeUndefined();
    expect(back?.exp).toBe(s.exp);
  });

  it('POST /api/me/profiles/active: Set-Cookie с тем же сроком, новый токен читается как pid', async () => {
    const nowMs = Date.now() - 3 * 86_400_000;
    const cookie = await sessionCookie(2, { nowMs });
    const orig = (await readSessionToken(cookie.split('=')[1], KIT_SECRET))!;
    const res = await switchProfile(kitRequest('/api/me/profiles/active', { method: 'POST', cookie, body: { profileId: 4 } }));
    expect(res.status).toBe(200);
    const s = (await readSessionToken(setCookieToken(res), KIT_SECRET))!;
    expect(s).toMatchObject({ uid: 2, pid: 4, iat: orig.iat, exp: orig.exp });
    expect(res.headers.getSetCookie()[0]).toMatch(/Max-Age=(\d+)/);
    const maxAge = Number(/Max-Age=(\d+)/.exec(res.headers.getSetCookie()[0])![1]);
    expect(maxAge).toBeLessThan(SESSION_TTL_SECONDS - 2 * 86_400);
  });
});

describe('Фаза 48: подсказка hero при смене профиля', () => {
  const hero = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith('ps-hero='));
  it('ставит ps-hero по играм «Играю» нового профиля (не httpOnly, на весь сайт)', async () => {
    const c = (t.pg as unknown as { $client: import('@electric-sql/pglite').PGlite }).$client;
    await c.exec(`
      insert into games (user_id, title_id, name, category, last_seen_at) values (4, 'CUSA1_00', 'Игра B2', 'ps4_game', now());
      insert into game_status (user_id, game_id, status) select 4, id, 'playing' from games where user_id = 4;
    `);
    const cookie = await sessionCookie(2);
    const on = await switchProfile(kitRequest('/api/me/profiles/active', { method: 'POST', cookie, body: { profileId: 4 } }));
    expect(on.status).toBe(200);
    expect(hero(on)).toMatch(/^ps-hero=1;/);
    expect(hero(on)).toMatch(/Path=\//);
    expect(hero(on)).not.toMatch(/HttpOnly/i);
    const off = await switchProfile(kitRequest('/api/me/profiles/active', { method: 'POST', cookie, body: { profileId: 2 } }));
    expect(hero(off)).toMatch(/^ps-hero=0;/);
  });
});
