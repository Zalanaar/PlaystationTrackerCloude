// item 4: серверный первый экран `/` отдаёт ровно то, что отдали бы GET /api/collection/summary и GET /api/games/batch.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import type { UserId } from '@/server/auth/user-id';
import { resetTestSession, testSession } from '@/server/auth/test-require-user';
import { createTestDb, TEST_USER, TEST_USER_2, type TestDb } from '@/server/sync/test-helpers';
import { sql } from 'drizzle-orm';

const holder: { db: TestDb['db'] | null } = { db: null };
vi.mock('@/db', async (orig) => ({
  ...(await orig<typeof import('@/db')>()),
  getDb: () => {
    if (!holder.db) throw new Error('no db');
    return holder.db;
  },
}));
vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);

import { GET as summaryGet } from '@/app/api/collection/summary/route';
import { GET as batchGet } from '@/app/api/games/batch/route';
import { GET as inboxGet } from '@/app/api/inbox/route';
import { loadCollectionInitial, SUMMARY_URL } from './initial';
import { buildPlan } from '@/ui/collection/blocks';
import { gamesBatchUrl } from '@/ui/collection/api';

const { games, gameStatus, psnProfile } = schema;
const NOW = new Date('2026-10-27T10:00:00Z');
const URL_ = gamesBatchUrl(buildPlan('all', '', false).map((p) => p.query));
const req = (u: string) => new Request(`http://localhost${u}`, { headers: { cookie: 'ps_session=x' } });

describe('loadCollectionInitial', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.db.execute(sql.raw(`insert into allowed_users (email, role, status, psn_online_id) values ('b@example.com', 'member', 'active', 'psnB')`));
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    resetTestSession();
    holder.db = t.db;
    for (const u of [TEST_USER, TEST_USER_2] as UserId[]) {
      const m = u === TEST_USER ? 'MARK_A' : 'MARK_B';
      const rows = await t.db.insert(games).values([
        { userId: u, titleId: `P_${m}`, name: `Playing ${m}`, category: 'ps5_native_game', lastSeenAt: NOW, lastPlayedAt: new Date('2026-10-20T10:00:00Z'), playDurationSeconds: 3600 },
        { userId: u, titleId: `C_${m}`, name: `Done ${m}`, category: 'ps4_game', lastSeenAt: NOW, lastPlayedAt: new Date('2026-09-01T10:00:00Z') },
        { userId: u, titleId: `B_${m}`, name: `Later ${m}`, category: 'ps4_game', lastSeenAt: NOW },
      ]).returning({ id: games.id });
      await t.db.insert(gameStatus).values([
        { userId: u, gameId: rows[0].id, status: 'playing' },
        { userId: u, gameId: rows[1].id, status: 'completed', completedAt: new Date('2026-09-02T10:00:00Z') },
        { userId: u, gameId: rows[2].id, status: 'backlog' },
      ]);
      await t.db.insert(psnProfile).values({ userId: u, onlineId: `Nick ${m}` });
    }
  });

  async function apiData(u: string): Promise<unknown> {
    const res = u === SUMMARY_URL ? await summaryGet(req(u)) : await batchGet(req(u));
    expect(res.status).toBe(200);
    return ((await res.json()) as { data: unknown }).data;
  }

  it('тела совпадают с ответами API (summary и batch по плану клиента)', async () => {
    const init = await loadCollectionInitial('ps_session=x', URL_);
    expect(init).not.toBeNull();
    expect(init!.summaryUrl).toBe(SUMMARY_URL);
    expect(init!.batchUrl).toBe(URL_);
    expect(init!.summary).toEqual(await apiData(SUMMARY_URL));
    expect(init!.batch).toEqual(await apiData(URL_));
    expect(init!.now % 60_000).toBe(0);
    // полоса: те же части, что у GET /api/inbox (now ответа свой, сравниваем без него)
    const inboxRes = await inboxGet(req('/api/inbox'));
    const inbox = ((await inboxRes.json()) as { data: Record<string, unknown> }).data;
    expect({ ...init!.inbox, now: null }).toEqual({ ...inbox, now: null });
    expect(JSON.stringify(init)).toContain('MARK_A');
    expect(JSON.stringify(init)).not.toContain('MARK_B');
  });

  it('данные активного пользователя (изоляция)', async () => {
    testSession.userId = 2;
    testSession.role = 'member';
    const s = JSON.stringify(await loadCollectionInitial('ps_session=x', URL_));
    expect(s).toContain('MARK_B');
    expect(s).not.toContain('MARK_A');
  });

  it('без входа, без cookie, с битым URL или без БД: null (клиент грузит сам)', async () => {
    expect(await loadCollectionInitial(null, URL_)).toBeNull();
    expect(await loadCollectionInitial('ps_session=x', '/api/games/batch')).toBeNull();
    expect(await loadCollectionInitial('ps_session=x', '/api/games/batch?b=limit%3D-5')).toBeNull();
    testSession.anonymous = true;
    expect(await loadCollectionInitial('ps_session=x', URL_)).toBeNull();
    testSession.anonymous = false;
    holder.db = null;
    expect(await loadCollectionInitial('ps_session=x', URL_)).toBeNull();
  });
});
