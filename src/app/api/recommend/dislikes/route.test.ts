// GET /api/recommend/dislikes (18.9) и продление срока через POST /api/recommend/dislike.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';

const holder: { db: TestDb['db'] | null } = { db: null };
vi.mock('@/db', async (orig) => ({
  ...(await orig<typeof import('@/db')>()),
  getDb: () => {
    if (!holder.db) throw new Error('postgres://user:SECRETPASS@host/db unreachable');
    return holder.db;
  },
}));

import { POST } from '../dislike/route';
import { GET } from './route';

describe('GET /api/recommend/dislikes', () => {
  let t: TestDb;
  let gid = 0;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    holder.db = t.db;
    const [g] = await t.db.insert(schema.games).values({ category: 'ps5_native_game', lastSeenAt: new Date(), titleId: 'A', name: 'Alpha', psnGenres: ['ACTION'] }).returning({ id: schema.games.id });
    gid = g.id;
    await t.db.insert(schema.gameStatus).values({ gameId: gid, status: 'backlog', statusChangedAt: new Date() });
  });

  it('пусто: 200 и items []', async () => {
    const r = await GET();
    expect(r.status).toBe(200);
    expect((await r.json()).data).toEqual({ items: [], ttlDays: 30 });
  });

  it('после POST игра в списке, повтор POST продлевает hiddenAt', async () => {
    const post = () => POST(new Request('http://x/api/recommend/dislike', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: gid }) }));
    expect((await post()).status).toBe(200);
    await t.db.update(schema.recommendDislikes).set({ createdAt: new Date(Date.now() - 10 * 86_400_000) });
    const before = (await (await GET()).json()).data.items[0];
    expect(before.game).toMatchObject({ id: gid, name: 'Alpha', genres: ['ACTION'] });
    await post();
    const after = (await (await GET()).json()).data.items;
    expect(after).toHaveLength(1);
    expect(Date.parse(after[0].hiddenAt)).toBeGreaterThan(Date.parse(before.hiddenAt) + 9 * 86_400_000);
    expect(Date.parse(after[0].expiresAt) - Date.parse(after[0].hiddenAt)).toBe(30 * 86_400_000);
  });

  it('503 без БД, текст ошибки не утекает', async () => {
    holder.db = null;
    const r = await GET();
    expect(r.status).toBe(503);
    const text = JSON.stringify(await r.json());
    expect(text).toContain('db_unavailable');
    expect(text).not.toMatch(/SECRETPASS|postgres:/);
  });
});
