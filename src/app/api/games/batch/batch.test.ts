// GET /api/games/batch (Фаза 48, контракт 48.1): валидация, порядок ответов = порядок `b`, равенство с одиночным 9.2, изоляция user_id.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { resetTestSession, testSession } from '@/server/auth/test-require-user';
import { createTestDb, TEST_USER, type TestDb } from '@/server/sync/test-helpers';

const holder: { db: TestDb['db'] | null } = { db: null };
vi.mock('@/db', async (orig) => ({
  ...(await orig<typeof import('@/db')>()),
  getDb: () => {
    if (!holder.db) throw new Error('no db');
    return holder.db;
  },
}));
vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);

import { GET as batchGet } from './route';
import { GET as listGet } from '../route';
import { countPlaying } from '@/server/collection/query';

const { games, gameStatus } = schema;
const url = (bs: string[]) => {
  const p = new URLSearchParams();
  for (const b of bs) p.append('b', b);
  return new Request(`http://x/api/games/batch?${p.toString()}`);
};
const body = async (r: Response) => (await r.json()) as { ok: boolean; data: { results: { ok: boolean; data?: { items: { title: string }[]; total: number } }[] }; error?: { code: string } };

describe('GET /api/games/batch: валидация (без БД)', () => {
  beforeEach(() => resetTestSession());

  it('нет b, больше 8 b, мусор в любом b = 400', async () => {
    expect((await batchGet(url([]))).status).toBe(400);
    expect((await batchGet(url(Array.from({ length: 9 }, () => 'status=backlog')))).status).toBe(400);
    const r = await batchGet(url(['status=backlog', 'status=zzz']));
    expect(r.status).toBe(400);
    expect((await body(r)).error?.code).toBe('invalid_request');
  });

  it('без сессии = 401', async () => {
    testSession.anonymous = true;
    expect((await batchGet(url(['status=backlog']))).status).toBe(401);
  });
});

describe('GET /api/games/batch (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    holder.db = t.db;
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    resetTestSession();
    await t.reset();
  });

  let n = 0;
  async function game(name: string, status: 'playing' | 'backlog' | 'completed' | null, userId: number = TEST_USER) {
    n += 1;
    const [g] = await t.db.insert(games).values({ userId, titleId: `CUSA${n}_00`, name, category: 'ps4_game', lastSeenAt: new Date('2026-10-01T00:00:00Z'), lastPlayedAt: new Date(Date.UTC(2026, 0, n)) }).returning();
    if (status) await t.db.insert(gameStatus).values({ userId, gameId: g.id, status, ...(status === 'completed' ? { completedAt: new Date('2026-05-01T00:00:00Z') } : {}) });
    return g.id;
  }

  it('ответы по порядку b и совпадают с одиночным GET /api/games', async () => {
    await game('Играю 1', 'playing');
    await game('Бэклог 1', 'backlog');
    await game('Бэклог 2', 'backlog');
    await game('Пройдено', 'completed');
    const qs = ['status=backlog&sort=last_played&limit=30&offset=0', 'status=playing&limit=12&offset=0', 'status=completed,dropped&sort=completed_at&limit=300&offset=0'];
    const r = await batchGet(url(qs));
    expect(r.status).toBe(200);
    const b = await body(r);
    expect(b.data.results.map((x) => x.ok)).toEqual([true, true, true]);
    for (let i = 0; i < qs.length; i++) {
      const single = await (await listGet(new Request(`http://x/api/games?${qs[i]}`))).json();
      expect(b.data.results[i].data).toEqual(single.data);
    }
    expect(b.data.results[0].data?.items.map((g) => g.title)).toEqual(['Бэклог 2', 'Бэклог 1']);
    expect(b.data.results[1].data?.total).toBe(1);
  });

  it('ETag: повтор с If-None-Match = 304', async () => {
    await game('Бэклог 1', 'backlog');
    const r1 = await batchGet(url(['status=backlog']));
    const etag = r1.headers.get('etag') as string;
    expect(etag).toBeTruthy();
    const r2 = await batchGet(new Request(url(['status=backlog']).url, { headers: { 'if-none-match': etag } }));
    expect(r2.status).toBe(304);
  });

  it('countPlaying: только видимые игры «Играю» своего user_id', async () => {
    const { asUserId } = await import('@/server/auth/user-id');
    await game('Играю 1', 'playing');
    await game('Бэклог', 'backlog');
    const hidden = await game('Играю скрытая', 'playing');
    await t.db.update(games).set({ hiddenAt: new Date() }).where((await import('drizzle-orm')).eq(games.id, hidden));
    expect(await countPlaying(t.db, asUserId(TEST_USER))).toBe(1);
  });
});
