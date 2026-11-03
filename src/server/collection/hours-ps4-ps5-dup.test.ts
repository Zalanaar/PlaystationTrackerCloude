// QA Фаза 25-26: выражения effectiveSecondsSql в одно-табличных SELECT (drizzle печатает столбцы без префикса таблицы).
// Дубль PS4 (1 ч) к главной PS5 (10 ч): эффективные часы = 11 ч везде, где они показываются.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { createTestDb, TEST_USER, type TestDb } from '@/server/sync/test-helpers';
import { getCollectionSummary, listGames } from './query';
import { parseListQuery } from './validation';
import { getStats } from '@/server/stats/query';
import { getWrapped } from '@/server/wrapped/query';

const { games, gameStatus, playtimeSnapshots } = schema;
const NOW = new Date('2026-10-27T10:00:00Z');

describe('QA: дубль PS4+PS5 в SQL-выражениях часов', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function seed() {
    const base = { userId: TEST_USER, lastSeenAt: NOW, psnGenres: ['ACTION'] };
    const [a] = await t.db.insert(games).values({ ...base, titleId: 'P5', name: 'Dup', category: 'ps5_native_game', playDurationSeconds: 36000, playCount: 3, firstPlayedAt: new Date('2025-02-01T10:00:00Z'), lastPlayedAt: new Date('2026-10-01T10:00:00Z') }).returning({ id: games.id });
    await t.db.insert(games).values({ ...base, titleId: 'P4', name: 'Dup', category: 'ps4_game', playDurationSeconds: 3600, duplicateOfGameId: a.id, firstPlayedAt: new Date('2024-02-01T10:00:00Z') });
    await t.db.insert(games).values({ ...base, titleId: 'S', name: 'Single', category: 'ps5_native_game', playDurationSeconds: 7200 });
    await t.db.insert(gameStatus).values({ userId: TEST_USER, gameId: a.id, status: 'backlog' });
    await t.db.insert(playtimeSnapshots).values([{ userId: TEST_USER, gameId: a.id, snapshotDate: '2026-10-20', playDurationSeconds: 36000 }]);
    return a.id;
  }

  it('listGames: playSeconds карточки = 11 ч (многотабличный SELECT)', async () => {
    await seed();
    const p = parseListQuery(new URLSearchParams('status=backlog'));
    if (!p.ok) throw new Error('bad');
    const r = await listGames(t.db, TEST_USER, p.value, NOW);
    expect(r.items[0].playSeconds).toBe(39600);
  });

  it('getCollectionSummary.totals: сумма по видимым играм = 11 ч + 2 ч = 13 ч (одно-табличный SELECT)', async () => {
    await seed();
    const r = await getCollectionSummary(t.db, TEST_USER);
    expect(r.totals.playSeconds).toBe(39600 + 7200);
  });

  it('stats all: header.hours = 13 ч, инвариант byYear + unattributed', async () => {
    await seed();
    const r = await getStats(t.db, TEST_USER, { type: 'all', year: 2026, month: null }, NOW);
    expect(r.header.hours).toBe(13);
    const sum = r.hours.byYear?.reduce((a, y) => a + Math.round(y.hours * 10), 0) ?? 0;
    expect(sum + Math.round((r.hours.unattributed ?? 0) * 10)).toBe(130);
  });

  it('stats year/month и wrapped year/all не падают и не задваивают дубль', async () => {
    await seed();
    const y = await getStats(t.db, TEST_USER, { type: 'year', year: 2026, month: null }, NOW);
    const m = await getStats(t.db, TEST_USER, { type: 'month', year: 2026, month: 10 }, NOW);
    expect(y.header.hours === null || y.header.hours <= 13).toBe(true);
    expect(m.header.hours === null || m.header.hours <= 13).toBe(true);
    const w = await getWrapped(t.db, TEST_USER, 'all', null, NOW);
    expect(w.hours.total).toBe(13);
  });
});
