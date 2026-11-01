// Фаза 41 (41.3, 41.6): /api/me/profiles, /active, /{id}, /api/auth/me на PGlite с настоящими cookie.
// Два входа (A: owner + доп. профили, B: member) — IDOR, подмена pid, лимиты, архив/восстановление, гонки.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import type { AccessCheck } from '@/server/psn/access';
import { KIT_SECRET, kitRequest, sessionCookie, setCookieToken } from '@/server/auth/profile-test-kit';
import { readSessionToken } from '@/server/auth/session';
import { resetAddProfileThrottle } from '@/server/auth/profiles';

let t: TestDb;
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => t.db }));
const check = vi.fn<(id: string) => Promise<AccessCheck>>();
vi.mock('@/server/psn/access', async (orig) => ({ ...(await orig<typeof import('@/server/psn/access')>()), checkProfileAccess: (_d: unknown, id: string) => check(id) }));

const list = await import('./route');
const { POST: switchTo } = await import('./active/route');
const { DELETE: delRoute } = await import('./[id]/route');
const { GET: me } = await import('@/app/api/auth/me/route');

const del = (path: string, cookie: string | undefined, _m: string, body?: unknown) => delRoute(kitRequest(path, { method: 'DELETE', cookie, body }), { params: Promise.resolve({ id: path.split('/').pop() as string }) });
const pg = () => (t.pg as unknown as { $client: PGlite }).$client;
const rows = async <T>(sql: string) => (await pg().query<T>(sql)).rows;
const ok = (id: string): AccessCheck => ({ status: 'ok', accountId: `acc-${id.toLowerCase()}` });

// 1 owner (вход A), 2 member (вход B), 3 доп. профиль A (NickA2), 4 доп. профиль B (NickB2); игры у каждого
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());
beforeEach(async () => {
  vi.stubEnv('SESSION_SECRET', KIT_SECRET);
  vi.stubEnv('PSN_TARGET_ONLINE_ID', 'TargetOwner');
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 1).toString('base64'));
  vi.stubEnv('MAX_USERS', '10');
  vi.stubEnv('PSN_NEW_USER_MODE', 'public');
  vi.stubEnv('MAX_PROFILES_PER_LOGIN', '');
  resetAddProfileThrottle();
  check.mockReset();
  check.mockImplementation(async (id) => ok(id));
  await pg().exec(`
    TRUNCATE allowed_users RESTART IDENTITY CASCADE;
    insert into allowed_users (email, role, status, google_sub, last_login_at, psn_online_id, psn_account_id, psn_access_status) values ('a@x.com', 'owner', 'active', 'sa', now(), 'NickA', 'acc1', 'ok');
    insert into allowed_users (email, role, status, google_sub, last_login_at, psn_online_id, psn_account_id, psn_access_status) values ('b@x.com', 'member', 'active', 'sb', now(), 'NickB', 'acc2', 'ok');
    insert into allowed_users (email, role, status, primary_user_id, psn_online_id, psn_account_id, psn_access_status, created_at) values ('a@x.com', 'member', 'active', 1, 'NickA2', 'acc3', 'ok', now() - interval '1 hour');
    insert into allowed_users (email, role, status, primary_user_id, psn_online_id, psn_account_id, psn_access_status, created_at) values ('b@x.com', 'member', 'active', 2, 'NickB2', 'acc4', 'ok', now() - interval '1 hour');
    insert into games (user_id, title_id, name, category, last_seen_at) values (1, 'G1', 'GameA', 'ps4_game', now()), (3, 'G3', 'GameA2', 'ps4_game', now()), (2, 'G2', 'GameB', 'ps4_game', now()), (4, 'G4', 'GameB2', 'ps4_game', now());
  `);
});

const A = () => sessionCookie(1, { role: 'owner' });
const B = () => sessionCookie(2);
const B2 = () => sessionCookie(2, { pid: 4 });
const call = async (fn: (r: Request) => Promise<Response>, path: string, cookie: string | undefined, method: string, body?: unknown, extra: { origin?: string | null } = {}) =>
  fn(kitRequest(path, { method, cookie, body, origin: extra.origin }));
const json = async (r: Response) => (await r.json()) as { ok: boolean; data?: any; error?: { code: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any -- форма ответов проверяется точечно
const ageProfiles = () => pg().exec(`update allowed_users set created_at = now() - interval '1 hour' where primary_user_id is not null`);
const add = async (cookie: string, onlineId: string, extra: Record<string, unknown> = {}) => {
  const r = await call(list.POST, '/api/me/profiles', cookie, 'POST', { onlineId, ...extra });
  await ageProfiles();
  resetAddProfileThrottle();
  return r;
};

describe('GET /api/me/profiles', () => {
  it('только профили своего входа, основной первым, счётчики игр; чужие не попадают', async () => {
    const r = await json(await call(list.GET, '/api/me/profiles', await B2(), 'GET'));
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ loginId: 2, activeProfileId: 4, limit: 3, canAdd: true, archived: [] });
    expect(r.data.profiles.map((p: { id: number; isPrimary: boolean; onlineId: string; gamesCount: number }) => [p.id, p.isPrimary, p.onlineId, p.gamesCount])).toEqual([[2, true, 'NickB', 1], [4, false, 'NickB2', 1]]);
    expect(JSON.stringify(r)).not.toMatch(/NickA|GameA/);
    expect(r.data.profiles[0]).toHaveProperty('canStartSync', true);
  });

  it('без сессии 401; подмена pid чужого входа 401', async () => {
    expect((await call(list.GET, '/api/me/profiles', undefined, 'GET')).status).toBe(401);
    expect((await call(list.GET, '/api/me/profiles', await sessionCookie(2, { pid: 3 }), 'GET')).status).toBe(401);
  });

  it('canAdd = false на лимите профилей и на MAX_USERS', async () => {
    await add(await B(), 'NickB3');
    const full = await json(await call(list.GET, '/api/me/profiles', await B(), 'GET'));
    expect(full.data).toMatchObject({ canAdd: false });
    vi.stubEnv('MAX_PROFILES_PER_LOGIN', '5');
    vi.stubEnv('MAX_USERS', '5');
    expect((await json(await call(list.GET, '/api/me/profiles', await B(), 'GET'))).data.canAdd).toBe(false); // 5 профилей всего = потолок
    vi.stubEnv('MAX_USERS', '6');
    expect((await json(await call(list.GET, '/api/me/profiles', await B(), 'GET'))).data.canAdd).toBe(true);
  });
});

describe('GET /api/auth/me', () => {
  it('id = активный профиль, loginId, activeProfileId, role входа, лёгкий список', async () => {
    const r = await json(await call(me, '/api/auth/me', await sessionCookie(1, { pid: 3, role: 'owner' }), 'GET'));
    expect(r.data).toMatchObject({ id: 3, loginId: 1, activeProfileId: 3, role: 'owner', psn: { onlineId: 'NickA2' } });
    expect(r.data.profiles).toEqual([{ id: 1, onlineId: 'NickA', isPrimary: true }, { id: 3, onlineId: 'NickA2', isPrimary: false }]);
    const plain = await json(await call(me, '/api/auth/me', await B(), 'GET'));
    expect(plain.data).toMatchObject({ id: 2, loginId: 2, activeProfileId: 2, role: 'member' });
  });
});

describe('POST /api/me/profiles/active', () => {
  it('переключает на свой профиль, идемпотентно, cookie с pid', async () => {
    for (let i = 0; i < 2; i++) {
      const res = await call(switchTo, '/api/me/profiles/active', await B(), 'POST', { profileId: 4 });
      expect(res.status).toBe(200);
      const r = await json(res);
      expect(r.data).toMatchObject({ activeProfileId: 4, profile: { id: 4, onlineId: 'NickB2' } });
      expect(await readSessionToken(setCookieToken(res), KIT_SECRET)).toMatchObject({ uid: 2, pid: 4 });
    }
    const back = await call(switchTo, '/api/me/profiles/active', await B2(), 'POST', { profileId: 2 });
    expect((await readSessionToken(setCookieToken(back), KIT_SECRET))?.pid).toBeUndefined();
  });

  it('чужой, архивный, несуществующий профиль: одинаковый 404; cookie не меняется', async () => {
    await pg().exec(`insert into allowed_users (email, role, status, primary_user_id, psn_online_id, archived_at) values ('b@x.com', 'member', 'archived', 2, 'NickB9', now())`); // id 5
    const bodies: unknown[] = [];
    for (const id of [3, 1, 5, 999]) {
      const res = await call(switchTo, '/api/me/profiles/active', await B(), 'POST', { profileId: id });
      expect(res.status, String(id)).toBe(404);
      expect(setCookieToken(res)).toBeUndefined();
      bodies.push(await res.json());
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
  });

  it('валидация, Origin, JSON, 401', async () => {
    for (const body of [{}, { profileId: '4' }, { profileId: 0 }, { profileId: -1 }, { profileId: 1.5 }, { profileId: 4, pid: 1 }, [4]]) {
      expect((await call(switchTo, '/api/me/profiles/active', await B(), 'POST', body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await call(switchTo, '/api/me/profiles/active', await B(), 'POST', { profileId: 4 }, { origin: 'https://evil.example' })).status).toBe(400);
    const noJson = await switchTo(new Request('https://app.example/x', { method: 'POST', headers: { cookie: await B(), host: 'app.example' }, body: 'profileId=4' }));
    expect(noJson.status).toBe(400);
    expect((await call(switchTo, '/api/me/profiles/active', undefined, 'POST', { profileId: 4 })).status).toBe(401);
  });
});

describe('POST /api/me/profiles', () => {
  it('создаёт профиль входа, активирует по умолчанию; строка: email входа, member, active, без google_sub', async () => {
    const res = await call(list.POST, '/api/me/profiles', await A(), 'POST', { onlineId: 'NewNick' });
    expect(res.status).toBe(201);
    const r = await json(res);
    expect(r.data.profile).toMatchObject({ isPrimary: false, onlineId: 'NewNick', accessStatus: 'ok', canStartSync: true, gamesCount: 0, onboardedAt: null });
    expect(r.data.activeProfileId).toBe(r.data.profile.id);
    expect(await readSessionToken(setCookieToken(res), KIT_SECRET)).toMatchObject({ uid: 1, pid: r.data.profile.id });
    const row = (await rows<Record<string, unknown>>(`select * from allowed_users where id = ${r.data.profile.id}`))[0];
    expect(row).toMatchObject({ email: 'a@x.com', role: 'member', status: 'active', primary_user_id: 1, google_sub: null, psn_account_id: 'acc-newnick' });
  });

  it('activate:false не меняет cookie', async () => {
    const res = await call(list.POST, '/api/me/profiles', await B(), 'POST', { onlineId: 'NewNick', activate: false });
    expect(res.status).toBe(201);
    expect(setCookieToken(res)).toBeUndefined();
    expect((await json(res)).data.activeProfileId).toBe(2);
  });

  it('лимит 3 профиля на вход: четвёртый = 409 profile_limit, строка не создаётся', async () => {
    expect((await add(await B(), 'NickB3')).status).toBe(201);
    const res = await call(list.POST, '/api/me/profiles', await B(), 'POST', { onlineId: 'NickB4' });
    expect([res.status, (await json(res)).error?.code]).toEqual([409, 'profile_limit']);
    expect((await rows<{ n: number }>(`select count(*)::int as n from allowed_users where primary_user_id = 2`))[0].n).toBe(2); // NickB2 и NickB3, четвёртого нет
    expect(check).toHaveBeenCalledTimes(1); // до проверки PSN лимит отсекает
  });

  it('MAX_USERS считает профили: user_limit', async () => {
    vi.stubEnv('MAX_USERS', '4');
    const res = await call(list.POST, '/api/me/profiles', await A(), 'POST', { onlineId: 'NewNick' });
    expect([res.status, (await json(res)).error?.code]).toEqual([409, 'user_limit']);
    expect(check).not.toHaveBeenCalled();
  });

  it('MAX_PROFILES_PER_LOGIN из env (1..5)', async () => {
    vi.stubEnv('MAX_PROFILES_PER_LOGIN', '2');
    const res = await call(list.POST, '/api/me/profiles', await B(), 'POST', { onlineId: 'NickB3' });
    expect((await json(res)).error?.code).toBe('profile_limit');
  });

  it('ник и аккаунт уже заняты: свой вход, чужой вход, ник владельца из env; регистр не важен', async () => {
    for (const nick of ['NickB2', 'nickb2', 'NickA', 'NICKA2', 'TargetOwner', 'targetowner']) {
      const res = await call(list.POST, '/api/me/profiles', await B(), 'POST', { onlineId: nick });
      expect([nick, res.status, (await json(res)).error?.code]).toEqual([nick, 409, 'psn_id_taken']);
    }
    // тот же аккаунт PSN под другим ником (смена ника в PSN)
    check.mockResolvedValueOnce({ status: 'ok', accountId: 'acc1' });
    const res = await call(list.POST, '/api/me/profiles', await B(), 'POST', { onlineId: 'SomethingNew' });
    expect([res.status, (await json(res)).error?.code]).toEqual([409, 'psn_id_taken']);
    expect((await rows<{ n: number }>(`select count(*)::int as n from allowed_users`))[0].n).toBe(4);
  });

  it('ошибки PSN: не найден 422, закрыт 422, недоступен 503; «полупрофилей» не остаётся', async () => {
    const cases: [AccessCheck, number, string][] = [
      [{ status: 'not_found' }, 422, 'psn_not_found'],
      [{ status: 'private' }, 422, 'psn_private'],
      [{ status: 'unavailable', reason: 'rate_limited' }, 503, 'psn_unavailable'],
    ];
    for (const [c, status, code] of cases) {
      check.mockResolvedValueOnce(c);
      const res = await call(list.POST, '/api/me/profiles', await B(), 'POST', { onlineId: 'NickB3' });
      expect([res.status, (await json(res)).error?.code]).toEqual([status, code]);
      resetAddProfileThrottle();
    }
    check.mockRejectedValueOnce(new Error('boom'));
    expect((await call(list.POST, '/api/me/profiles', await B(), 'POST', { onlineId: 'NickB3' })).status).toBe(503);
    expect((await rows<{ n: number }>(`select count(*)::int as n from allowed_users`))[0].n).toBe(4);
  });

  it('PSN_NEW_USER_MODE=friend: закрытый профиль создаётся как friend_required', async () => {
    vi.stubEnv('PSN_NEW_USER_MODE', 'friend');
    check.mockResolvedValueOnce({ status: 'private' });
    const res = await call(list.POST, '/api/me/profiles', await B(), 'POST', { onlineId: 'NickB3' });
    expect(res.status).toBe(201);
    expect((await json(res)).data.profile).toMatchObject({ accessStatus: 'friend_required', canStartSync: false });
  });

  it('формат ника, лишние поля, Origin, JSON, 401', async () => {
    for (const body of [{ onlineId: 'ab' }, { onlineId: '1abc' }, { onlineId: 'a b c' }, { onlineId: 'x'.repeat(17) }, { onlineId: 5 }, {}, { onlineId: 'NickB3', primaryUserId: 1 }, { onlineId: 'NickB3', role: 'owner' }]) {
      expect((await call(list.POST, '/api/me/profiles', await B(), 'POST', body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(check).not.toHaveBeenCalled();
    expect((await call(list.POST, '/api/me/profiles', await B(), 'POST', { onlineId: 'NickB3' }, { origin: 'https://evil.example' })).status).toBe(400);
    expect((await call(list.POST, '/api/me/profiles', undefined, 'POST', { onlineId: 'NickB3' })).status).toBe(401);
  });

  it('пауза 30 с на вход: второе добавление подряд = 429 Retry-After', async () => {
    expect((await call(list.POST, '/api/me/profiles', await A(), 'POST', { onlineId: 'NewNick' })).status).toBe(201);
    resetAddProfileThrottle(); // in-memory сброшен: срабатывает ограничение по created_at в БД
    const res = await call(list.POST, '/api/me/profiles', await A(), 'POST', { onlineId: 'NewNick2' });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('чужие входы не влияют друг на друга: профиль добавляется только к входу из сессии', async () => {
    await add(await A(), 'NewNick');
    const bs = await rows<{ id: number }>(`select id from allowed_users where primary_user_id = 2 order by id`);
    expect(bs.map((r) => r.id)).toEqual([4]);
    expect((await rows<{ n: number }>(`select count(*)::int as n from allowed_users where primary_user_id = 1`))[0].n).toBe(2);
  });

  it('восстановление из архива: те же данные, 200 restored, слот и аккаунт заняты снова', async () => {
    const created = await json(await add(await B(), 'NickB3'));
    await pg().exec(`insert into games (user_id, title_id, name, category, last_seen_at) values (${created.data.profile.id}, 'GX', 'GameB3', 'ps4_game', now())`);
    const d = await del(`/api/me/profiles/${created.data.profile.id}`, await B(), 'DELETE', { confirmOnlineId: 'nickb3' });
    expect(d.status).toBe(200);
    resetAddProfileThrottle();
    const listed = await json(await call(list.GET, '/api/me/profiles', await B(), 'GET'));
    expect(listed.data.archived).toHaveLength(1);
    expect(listed.data.archived[0]).toMatchObject({ id: created.data.profile.id, onlineId: 'NickB3' });
    expect(Date.parse(listed.data.archived[0].purgeAt) - Date.parse(listed.data.archived[0].archivedAt)).toBe(30 * 86_400_000);
    const res = await call(list.POST, '/api/me/profiles', await B(), 'POST', { onlineId: 'NickB3' });
    expect(res.status).toBe(200);
    const r = await json(res);
    expect(r.data).toMatchObject({ restored: true, profile: { id: created.data.profile.id, onlineId: 'NickB3', gamesCount: 1 } });
    expect((await rows<{ n: number }>(`select count(*)::int as n from allowed_users where primary_user_id = 2 and status = 'archived'`))[0].n).toBe(0);
  });

  it('архив чужого входа аккаунт не блокирует: тот же ник можно подключить в своём входе', async () => {
    const created = await json(await add(await A(), 'SharedNick'));
    await del(`/api/me/profiles/${created.data.profile.id}`, await A(), 'DELETE', { confirmOnlineId: 'SharedNick' });
    resetAddProfileThrottle();
    const res = await call(list.POST, '/api/me/profiles', await B(), 'POST', { onlineId: 'SharedNick' });
    expect(res.status).toBe(201); // создан новый, не восстановление архива входа A
    expect((await json(res)).data.profile.id).not.toBe(created.data.profile.id);
  });

  it('гонка: два одинаковых ника параллельно = один профиль', async () => {
    const [x, y] = await Promise.all([
      call(list.POST, '/api/me/profiles', await B(), 'POST', { onlineId: 'RaceNick' }),
      call(list.POST, '/api/me/profiles', await A(), 'POST', { onlineId: 'RaceNick' }),
    ]);
    expect([x.status, y.status].filter((s) => s === 201)).toHaveLength(1);
    expect([x.status, y.status].filter((s) => s !== 201)[0]).toBe(409);
    expect((await rows<{ n: number }>(`select count(*)::int as n from allowed_users where lower(psn_online_id) = 'racenick'`))[0].n).toBe(1);
  });

  it('гонка: параллельные добавления не обходят лимит профилей входа', async () => {
    vi.stubEnv('MAX_PROFILES_PER_LOGIN', '3');
    const results = await Promise.all(['RaceOne', 'RaceTwo', 'RaceThree', 'RaceFour'].map(async (n) => call(list.POST, '/api/me/profiles', await B(), 'POST', { onlineId: n })));
    const created = results.filter((r) => r.status === 201).length;
    expect(created).toBeLessThanOrEqual(1); // слотов остаётся 1 (основной + NickB2)
    expect((await rows<{ n: number }>(`select count(*)::int as n from allowed_users where primary_user_id = 2 and status = 'active'`))[0].n).toBeLessThanOrEqual(2);
  });
});

describe('DELETE /api/me/profiles/{id}', () => {
  const del2 = (id: number | string, cookie: string | undefined, body: unknown) => del(`/api/me/profiles/${id}`, cookie, 'DELETE', body);

  it('архив по умолчанию: данные на месте, профиль исчез из списка, слот и аккаунт свободны', async () => {
    const res = await del2(4, await B(), { confirmOnlineId: 'nickb2' });
    expect(res.status).toBe(200);
    expect((await json(res)).data).toEqual({ archived: true, activeProfileId: 2 });
    expect(setCookieToken(res)).toBeUndefined(); // активным был основной
    const row = (await rows<{ status: string; archived_at: string | null }>(`select status, archived_at from allowed_users where id = 4`))[0];
    expect(row.status).toBe('archived');
    expect(row.archived_at).not.toBeNull();
    expect((await rows<{ n: number }>(`select count(*)::int as n from games where user_id = 4`))[0].n).toBe(1);
    const l = await json(await call(list.GET, '/api/me/profiles', await B(), 'GET'));
    expect(l.data.profiles.map((p: { id: number }) => p.id)).toEqual([2]);
    expect((await call(switchTo, '/api/me/profiles/active', await B(), 'POST', { profileId: 4 })).status).toBe(404);
    // слот свободен: можно добавить другой, аккаунт acc4 свободен для другого входа
    check.mockResolvedValueOnce({ status: 'ok', accountId: 'acc4' });
    expect((await call(list.POST, '/api/me/profiles', await A(), 'POST', { onlineId: 'TakeOver' })).status).toBe(201);
  });

  it('удаление активного профиля: activeProfileId = основной и новая cookie без pid', async () => {
    const res = await del2(4, await B2(), { confirmOnlineId: 'NickB2' });
    expect((await json(res)).data.activeProfileId).toBe(2);
    expect((await readSessionToken(setCookieToken(res), KIT_SECRET))?.pid).toBeUndefined();
    expect(setCookieToken(res)).toBeTruthy();
  });

  it('purge:true удаляет безвозвратно каскадом; соседний профиль и чужой вход целы; допустимо и для архивного', async () => {
    const res = await del2(4, await B(), { confirmOnlineId: 'NickB2', purge: true });
    expect((await json(res)).data).toEqual({ purged: true, activeProfileId: 2 });
    expect((await rows<{ id: number }>(`select id from allowed_users order by id`)).map((r) => r.id)).toEqual([1, 2, 3]);
    expect((await rows<{ user_id: number }>(`select user_id from games order by user_id`)).map((r) => r.user_id)).toEqual([1, 2, 3]);
    const created = await json(await add(await B(), 'NickB5'));
    await del2(created.data.profile.id, await B(), { confirmOnlineId: 'NickB5' });
    expect((await del2(created.data.profile.id, await B(), { confirmOnlineId: 'NickB5', purge: true })).status).toBe(200);
    expect((await rows<{ n: number }>(`select count(*)::int as n from allowed_users where id = ${created.data.profile.id}`))[0].n).toBe(0);
  });

  it('IDOR: чужой профиль и несуществующий = 404 без изменений; основной = 409 primary_protected', async () => {
    for (const id of [3, 1, 999]) {
      const res = await del2(id, await B(), { confirmOnlineId: id === 3 ? 'NickA2' : 'x', purge: true });
      expect([id, res.status, (await json(res)).error?.code]).toEqual([id, 404, 'not_found']);
    }
    expect((await rows<{ n: number }>(`select count(*)::int as n from allowed_users`))[0].n).toBe(4);
    const own = await del2(2, await B(), { confirmOnlineId: 'NickB', purge: true });
    expect([own.status, (await json(own)).error?.code]).toEqual([409, 'primary_protected']);
    // owner тоже не может снести чужой профиль через эту ручку
    expect((await del2(4, await A(), { confirmOnlineId: 'NickB2' })).status).toBe(404);
    expect((await rows<{ status: string }>(`select status from allowed_users where id = 4`))[0].status).toBe('active');
  });

  it('подмена pid при удалении: сессия с чужим pid = 401', async () => {
    expect((await del2(4, await sessionCookie(2, { pid: 3 }), { confirmOnlineId: 'NickB2' })).status).toBe(401);
  });

  it('confirm_mismatch 400, идёт синк 409 sync_in_progress, 401, валидация, Origin', async () => {
    expect((await json(await del2(4, await B(), { confirmOnlineId: 'wrong' }))).error?.code).toBe('confirm_mismatch');
    await pg().exec(`insert into sync_runs (user_id, kind, status, started_at, snapshot_date) values (4, 'daily', 'running', now(), current_date)`);
    const busy = await del2(4, await B(), { confirmOnlineId: 'NickB2' });
    expect([busy.status, (await json(busy)).error?.code]).toEqual([409, 'sync_in_progress']);
    expect((await rows<{ status: string }>(`select status from allowed_users where id = 4`))[0].status).toBe('active');
    expect((await del2(4, undefined, { confirmOnlineId: 'NickB2' })).status).toBe(401);
    expect((await del2('abc', await B(), { confirmOnlineId: 'NickB2' })).status).toBe(400);
    expect((await del2(4, await B(), { purge: true })).status).toBe(400);
    expect((await del2(4, await B(), { confirmOnlineId: 'NickB2', extra: 1 })).status).toBe(400);
    expect((await delRoute(kitRequest('/api/me/profiles/4', { method: 'DELETE', cookie: await B(), body: { confirmOnlineId: 'NickB2' }, origin: 'https://evil.example' }), { params: Promise.resolve({ id: '4' }) })).status).toBe(400);
  });
});
