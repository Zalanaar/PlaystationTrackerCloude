// П14.1: /api/me/profiles/compare на PGlite с настоящими cookie: свои профили — цифры и общие игры; чужой вход — 404 (IDOR), 400 на мусор.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { KIT_SECRET, kitRequest, sessionCookie } from '@/server/auth/profile-test-kit';
import { commonGames } from '@/server/profiles/compare';

let t: TestDb;
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => t.db }));
const { GET } = await import('./route');
const pg = () => (t.pg as unknown as { $client: PGlite }).$client;
const get = async (q: string, cookie?: string) => GET(kitRequest(`/api/me/profiles/compare${q}`, { method: 'GET', cookie }));

beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());
beforeEach(async () => {
  vi.stubEnv('SESSION_SECRET', KIT_SECRET);
  await t.reset();
  await pg().exec(`
    TRUNCATE allowed_users RESTART IDENTITY CASCADE;
    insert into allowed_users (email, role, status, google_sub, psn_online_id, psn_account_id, psn_access_status) values ('a@x.com', 'owner', 'active', 'sa', 'NickA', 'acc1', 'ok');
    insert into allowed_users (email, role, status, google_sub, psn_online_id, psn_account_id, psn_access_status) values ('b@x.com', 'member', 'active', 'sb', 'NickB', 'acc2', 'ok');
    insert into allowed_users (email, role, status, primary_user_id, psn_online_id, psn_account_id, psn_access_status) values ('a@x.com', 'member', 'active', 1, 'NickA2', 'acc3', 'ok');
    insert into games (user_id, title_id, concept_id, name, category, last_seen_at, play_duration_seconds) values
      (1, 'T1', 'C1', 'Elden Ring', 'ps5_native_game', now(), 36000),
      (1, 'T2', null, 'Astro Bot', 'ps5_native_game', now(), 7200),
      (1, 'T9', null, 'Только у A', 'ps5_native_game', now(), 3600),
      (3, 'T1x', 'C1', 'ELDEN RING', 'ps4_game', now(), 18000),
      (3, 'T2', null, 'Astro Bot', 'ps5_native_game', now(), 1800),
      (2, 'T1', 'C1', 'Elden Ring', 'ps5_native_game', now(), 99999);
    insert into game_status (game_id, user_id, status, completed_at) values (1, 1, 'completed', now()), (5, 3, 'playing', null);
  `);
});

describe('GET /api/me/profiles/compare', () => {
  it('свои профили: цифры и общие игры по concept/title, по часам', async () => {
    const r = await get('?a=1&b=3', await sessionCookie(1, { role: 'owner' }));
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    const { data } = await r.json();
    expect(data.a).toMatchObject({ id: 1, onlineId: 'NickA', isPrimary: true, values: { games: 3, completed: 1, hours: 13 } });
    expect(data.b).toMatchObject({ id: 3, onlineId: 'NickA2', isPrimary: false, values: { games: 2, completed: 0, hours: 5 } });
    expect(data.common.count).toBe(2);
    expect(data.common.items).toEqual([
      { name: 'Elden Ring', a: { hours: 10, status: 'completed' }, b: { hours: 5, status: null } },
      { name: 'Astro Bot', a: { hours: 2, status: null }, b: { hours: 0.5, status: 'playing' } },
    ]);
    expect(JSON.stringify(data)).not.toContain('NickB');
  });

  it('чужой вход — 404, мусор и одинаковые — 400, без сессии — 401', async () => {
    const a = await sessionCookie(1, { role: 'owner' });
    expect((await get('?a=1&b=2', a)).status).toBe(404);
    expect((await get('?a=2&b=1', await sessionCookie(2))).status).toBe(404);
    for (const q of ['', '?a=1', '?a=1&b=1', '?a=x&b=3', '?a=0&b=3', '?a=1&b=3e1']) expect((await get(q, a)).status, q).toBe(400);
    expect((await get('?a=1&b=3')).status).toBe(401);
  });

  it('архивный профиль — 404', async () => {
    await pg().exec(`update allowed_users set status = 'archived', archived_at = now() where id = 3`);
    expect((await get('?a=1&b=3', await sessionCookie(1, { role: 'owner' }))).status).toBe(404);
  });
});

describe('commonGames', () => {
  it('версии одной игры — одна строка с большими часами; лимит', () => {
    const row = (key: string, name: string, h: number) => ({ key, name, seconds: h * 3600, status: null });
    const r = commonGames([row('k', 'A', 1), row('k', 'A (PS5)', 3), row('z', 'Z', 1)], [row('k', 'A', 2), row('z', 'Z', 1)], 1);
    expect(r.count).toBe(2);
    expect(r.items).toEqual([{ name: 'A (PS5)', a: { hours: 3, status: null }, b: { hours: 2, status: null } }]);
  });
});
