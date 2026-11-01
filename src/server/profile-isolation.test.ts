// Фаза 41 (41.6): изоляция профилей одного входа и между входами (по образцу user-isolation.test.ts, но через настоящие роуты и cookie).
// Профили: 1 (вход A, owner), 3 (доп. профиль входа A), 2 (вход B). Свои маркеры в названиях игр, трофеях, плане, нике.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { KIT_SECRET, kitRequest, sessionCookie } from '@/server/auth/profile-test-kit';

let t: TestDb;
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => t.db }));

import { GET as gamesGet } from '@/app/api/games/route';
import { GET as summaryGet } from '@/app/api/collection/summary/route';
import { GET as backupGet } from '@/app/api/backup/route';
import { POST as restorePost } from '@/app/api/backup/restore/route';
import { GET as statsGet } from '@/app/api/stats/route';
import { GET as roadmapGet } from '@/app/api/roadmap/route';
import { GET as wrappedGet } from '@/app/api/wrapped/route';
import { GET as syncStatusGet } from '@/app/api/sync/status/route';
import { GET as psnGet } from '@/app/api/me/psn/route';
import { GET as meGet } from '@/app/api/auth/me/route';

const pg = () => (t.pg as unknown as { $client: PGlite }).$client;
const NOW = new Date().toISOString();
const MARK: Record<number, string> = { 1: 'MARKONE', 3: 'MARKTHREE', 2: 'MARKTWO' };

beforeAll(async () => {
  t = await createTestDb();
  vi.stubEnv('SESSION_SECRET', KIT_SECRET);
  await pg().exec(`
    TRUNCATE allowed_users RESTART IDENTITY CASCADE;
    insert into allowed_users (email, role, status, google_sub, last_login_at, psn_online_id, psn_account_id, psn_access_status) values ('a@x.com', 'owner', 'active', 'sa', now(), 'NickMARKONE', 'acc1', 'ok');
    insert into allowed_users (email, role, status, google_sub, last_login_at, psn_online_id, psn_account_id, psn_access_status) values ('b@x.com', 'member', 'active', 'sb', now(), 'NickMARKTWO', 'acc2', 'ok');
    insert into allowed_users (email, role, status, primary_user_id, psn_online_id, psn_account_id, psn_access_status) values ('a@x.com', 'member', 'active', 1, 'NickMARKTHREE', 'acc3', 'ok');
  `);
  for (const u of [1, 3, 2]) {
    const m = MARK[u];
    const { rows } = await pg().query<{ id: number }>(`insert into games (user_id, title_id, name, category, last_seen_at, play_duration_seconds, last_played_at, psn_genres) values (${u}, 'SAME', 'Same ${m}', 'ps5_native_game', now(), 7200, '2026-10-01T10:00:00Z', '{ACTION}') returning id`);
    await pg().exec(`
      insert into game_status (game_id, user_id, status) values (${rows[0].id}, ${u}, '${u === 3 ? 'playing' : 'backlog'}');
      insert into playtime_snapshots (user_id, game_id, snapshot_date, play_duration_seconds) values (${u}, ${rows[0].id}, '2026-10-10', 7200);
      insert into trophy_sets (user_id, np_communication_id, np_service_name, name, defined_bronze, earned_bronze) values (${u}, 'NPWR_SAME', 'trophy', 'Set ${m}', 2, 1);
      insert into planned_games (user_id, title, external_source, external_id, release_date, status) values (${u}, 'Plan ${m}', 'rawg', '777', '2027-03-03', 'planned');
      insert into psn_profile (user_id, online_id) values (${u}, 'Nick${m}');
      insert into sync_runs (user_id, kind, status, snapshot_date, started_at, finished_at, games_seen) values (${u}, 'daily', 'success', '2026-10-26', '${NOW}', '${NOW}', ${u * 11});
    `);
  }
});
afterAll(() => t.close());

const as = async (uid: number, pid: number | undefined) => sessionCookie(uid, { pid, role: uid === 1 ? 'owner' : 'member' });
const sessions: [string, number, number | undefined, number][] = [
  ['основной профиль входа A', 1, undefined, 1],
  ['дополнительный профиль входа A', 1, 3, 3],
  ['профиль входа B', 2, undefined, 2],
];
const GETS: [string, (r: Request) => Promise<Response>, string][] = [
  ['games', gamesGet, '/api/games'],
  ['summary', summaryGet, '/api/collection/summary'],
  ['backup', backupGet, '/api/backup'],
  ['stats', statsGet, '/api/stats?type=year&year=2026'],
  ['roadmap', roadmapGet, '/api/roadmap'],
  ['wrapped', wrappedGet, '/api/wrapped?year=2026'],
  ['syncStatus', syncStatusGet, '/api/sync/status'],
  ['psn', psnGet, '/api/me/psn'],
];

describe('профили: GET-роуты видят только активный профиль', () => {
  for (const [label, uid, pid, active] of sessions) {
    it(`${label}: ни байта чужих маркеров`, async () => {
      const others = Object.entries(MARK).filter(([k]) => Number(k) !== active).map(([, v]) => v);
      let own = 0;
      for (const [name, fn, path] of GETS) {
        const res = await fn(kitRequest(path, { cookie: await as(uid, pid) }));
        expect(res.status, `${name} ${res.status}`).toBeLessThan(500);
        const text = await res.text();
        for (const o of others) expect(text, `${name} утёк ${o}`).not.toContain(o);
        if (text.includes(MARK[active])) own++;
      }
      expect(own, 'свои данные видны хотя бы в нескольких роутах').toBeGreaterThanOrEqual(3);
    });
  }

  it('/api/auth/me: профиль и список только своего входа', async () => {
    const r = await (await meGet(kitRequest('/api/auth/me', { cookie: await as(1, 3) }))).json();
    expect(r.data.profiles.map((p: { id: number }) => p.id)).toEqual([1, 3]);
    expect(JSON.stringify(r)).not.toContain('MARKTWO');
  });
});

describe('копия разметки привязана к активному профилю', () => {
  const restore = async (cookie: string, backup: unknown, mode: 'preview' | 'apply') =>
    restorePost(kitRequest('/api/backup/restore', { method: 'POST', cookie, body: { mode, backup } }));
  const statusOf = async (uid: number) => (await pg().query<{ status: string }>(`select status from game_status where user_id = ${uid}`)).rows[0].status;

  it('выгрузка профиля 3 применяется только к активному профилю; профиль 3 и вход B не меняются', async () => {
    const file = await (await backupGet(kitRequest('/api/backup', { cookie: await as(1, 3) }))).json();
    expect(JSON.stringify(file)).toContain('playing');
    // у профиля 1 статус backlog; применяем копию профиля 3 под профилем 1
    const res = await restore(await as(1, undefined), file, 'apply');
    expect(res.status).toBe(200);
    expect(await statusOf(1)).toBe('playing');
    expect(await statusOf(2)).toBe('backlog');
    expect(await statusOf(3)).toBe('playing');
    // и обратно: под профилем 3 копия профиля 1 (теперь тоже playing) ничего не меняет у чужих
    await pg().exec(`update game_status set status = 'dropped' where user_id = 3`);
    await restore(await as(2, undefined), file, 'apply');
    expect(await statusOf(3)).toBe('dropped'); // вход B не может затронуть профиль 3
    expect(await statusOf(2)).toBe('playing'); // применилось к B как к активному
  });
});
