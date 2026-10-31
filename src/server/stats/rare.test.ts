// Фаза 15.2 «Редкие трофеи» (контракт 14.1): чистые функции + выборка на PGlite.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { createTestDb, type TestDb, TEST_USER } from '@/server/sync/test-helpers';
import { getWrapped } from '@/server/wrapped/query';
import { getStats } from './query';
import { compareRare, pickRare, type RareRow } from './rare';
import { getRareTrophies } from './rare-query';

const { games, trophySets, gameTrophySets, trophies } = schema;
const NOW = new Date('2026-10-27T10:00:00Z');

const row = (o: Partial<RareRow> = {}): RareRow => ({
  setId: 1, trophyId: 1, type: 'gold', name: 'T', detail: 'D', iconUrl: 'https://i', earnedAt: new Date('2026-05-01T10:00:00Z'),
  earnedRate: '5.00', rarity: 1, setName: 'Set', gameId: 7, gameTitle: 'Game', gameCoverUrl: null, ...o,
});

describe('pickRare / compareRare (чистые)', () => {
  it('порядок: earned_rate, затем earned_at (null в конце), затем setId, trophyId', () => {
    const rows = [
      row({ trophyId: 1, earnedRate: '3.10' }),
      row({ trophyId: 2, earnedRate: '0.50' }),
      row({ trophyId: 3, earnedRate: '3.10', earnedAt: new Date('2026-01-01T00:00:00Z') }),
      row({ trophyId: 4, earnedRate: '3.10', earnedAt: null }),
      row({ setId: 0, trophyId: 9, earnedRate: '3.10', earnedAt: null }),
    ];
    expect(rows.slice().sort(compareRare).map((r) => `${r.setId}:${r.trophyId}`)).toEqual(['1:2', '1:3', '1:1', '0:9', '1:4']);
  });
  it('без процента не попадает, лимит 5, маппинг', () => {
    const rows = [row({ earnedRate: null, trophyId: 99 }), ...[1, 2, 3, 4, 5, 6].map((i) => row({ trophyId: i, earnedRate: `${i}.00` }))];
    const r = pickRare(rows);
    expect(r.map((x) => x.trophyId)).toEqual([1, 2, 3, 4, 5]);
    expect(r[0]).toEqual({
      setId: 1, trophyId: 1, type: 'gold', name: 'T', detail: 'D', iconUrl: 'https://i', earnedAt: '2026-05-01T10:00:00.000Z',
      earnedRate: 1, rarity: 1, setName: 'Set', game: { id: 7, title: 'Game', coverUrl: null },
    });
  });
  it('сирота: game = null; пусто = []', () => {
    expect(pickRare([row({ gameId: null, gameTitle: null })])[0].game).toBeNull();
    expect(pickRare([])).toEqual([]);
  });
});

describe('getRareTrophies на PGlite', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  let n = 0;
  async function game(o: Partial<typeof games.$inferInsert> = {}) {
    n++;
    const [g] = await t.db.insert(games).values({ userId: 1, titleId: `CUSA${n}`, name: `G${n}`, category: 'ps5_native_game', lastSeenAt: NOW, ...o }).returning();
    return g.id;
  }
  async function set(gameIds: number[], name = 'Set') {
    n++;
    const [s] = await t.db.insert(trophySets).values({ userId: 1, npCommunicationId: `NPWR${n}`, npServiceName: 'trophy2', name }).returning();
    for (const id of gameIds) await t.db.insert(gameTrophySets).values({ userId: 1, gameId: id, trophySetId: s.id, source: 'title_id' });
    return s.id;
  }
  async function trophy(setId: number, trophyId: number, earnedAt: string | null, rate: string | null, o: Partial<typeof trophies.$inferInsert> = {}) {
    await t.db.insert(trophies).values({ userId: 1, trophySetId: setId, trophyId, type: 'gold', name: `T${trophyId}`, earned: true, earnedAt: earnedAt ? new Date(earnedAt) : null, earnedRate: rate, ...o });
  }

  it('граница года по МСК, сирота, скрытый сет, без процента, без даты, не полученный', async () => {
    const a = await game();
    const b = await game();
    const hidden = await game({ hiddenAt: NOW });
    const sAB = await set([b, a], 'AB'); // игра сета = min id = a
    const sHidden = await set([hidden], 'H');
    const sOrphan = await set([], 'O');
    await trophy(sAB, 1, '2025-12-31T21:00:00Z', '0.30'); // 00:00 МСК 1 января 2026: 2026
    await trophy(sAB, 2, '2025-12-31T20:59:59Z', '0.10'); // 23:59 МСК 31 декабря: 2025
    await trophy(sAB, 3, '2026-06-01T00:00:00Z', null); // без процента: никуда
    await trophy(sAB, 4, null, '0.05'); // без даты: только «всё время»
    await trophy(sAB, 5, null, '0.01', { earned: false }); // не получен
    await trophy(sHidden, 1, '2026-03-01T00:00:00Z', '0.01'); // сет только скрытой игры: не учитывается
    await trophy(sOrphan, 1, '2026-04-01T00:00:00Z', '1.50'); // сирота учитывается

    const y2026 = await getRareTrophies(t.db, TEST_USER, { fromUtc: new Date('2025-12-31T21:00:00Z'), toUtc: new Date('2026-12-31T21:00:00Z') });
    expect(y2026.map((r) => `${r.setName}:${r.trophyId}`)).toEqual(['AB:1', 'O:1']);
    expect(y2026[0].game).toEqual({ id: a, title: 'G1', coverUrl: null });
    expect(y2026[1].game).toBeNull();

    const all = await getRareTrophies(t.db, TEST_USER, null);
    expect(all.map((r) => `${r.setName}:${r.trophyId}`)).toEqual(['AB:4', 'AB:2', 'AB:1', 'O:1']);
    expect(all[0].earnedAt).toBeNull();

    // скрыли a: игра сета становится b
    await t.db.update(games).set({ hiddenAt: NOW }).where(eq(games.id, a));
    expect((await getRareTrophies(t.db, TEST_USER, null))[0].game?.id).toBe(b);
  });

  it('LIMIT 5 и встраивание в /api/stats и /api/wrapped', async () => {
    const a = await game();
    const s = await set([a]);
    for (let i = 1; i <= 7; i++) await trophy(s, i, `2026-0${i}-10T12:00:00Z`, `${10 - i}.00`);
    await trophy(s, 8, '2025-05-05T12:00:00Z', '0.20');
    const st = await getStats(t.db, TEST_USER, { type: 'year', year: 2026, month: null }, NOW);
    expect(st.rareTrophies.period.map((r) => r.trophyId)).toEqual([7, 6, 5, 4, 3]);
    expect(st.rareTrophies.allTime.map((r) => r.trophyId)).toEqual([8, 7, 6, 5, 4]);
    const month = await getStats(t.db, TEST_USER, { type: 'month', year: 2026, month: 3 }, NOW);
    expect(month.rareTrophies.period.map((r) => r.trophyId)).toEqual([3]);
    const w = await getWrapped(t.db, TEST_USER, 2026, null, NOW);
    expect(w.trophies.rare.map((r) => r.trophyId)).toEqual([7, 6, 5, 4, 3]);
    const empty = await getWrapped(t.db, TEST_USER, 2024, null, NOW);
    expect(empty.mode).toBe('empty');
    expect(empty.trophies.rare).toEqual([]);
  });
});
