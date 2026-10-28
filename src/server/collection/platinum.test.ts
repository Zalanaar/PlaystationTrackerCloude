// Фаза 15.3 «Прогноз платины» (контракт 14.2): чистые функции + /api/games/{id} и сводка на PGlite.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { setGameStatus } from '@/server/sync/status-rules';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { getGameDetails } from './details';
import { platinumForecast, rankNearPlatinum, setAggsFromTrophies, type NearPlatinumCandidate } from './platinum';
import { getCollectionSummary } from './query';
import type { GameTrophyItem } from './types';

const { games, trophySets, gameTrophySets, trophies } = schema;
const NOW = new Date('2026-10-27T10:00:00Z');

type T = Pick<GameTrophyItem, 'setId' | 'type' | 'earned' | 'hidden' | 'earnedRate'>;
const tr = (type: T['type'], earned: boolean, earnedRate: number | null = null, o: Partial<T> = {}): T => ({ setId: 1, type, earned, hidden: false, earnedRate, ...o });

describe('platinumForecast (чистая)', () => {
  it('нет трофеев / нет платины: null', () => {
    expect(platinumForecast(setAggsFromTrophies([]))).toBeNull();
    expect(platinumForecast(setAggsFromTrophies([tr('gold', false), tr('bronze', true)]))).toBeNull();
  });
  it('платина получена: null (даже если в другом сете не получена)', () => {
    expect(platinumForecast(setAggsFromTrophies([tr('platinum', true), tr('gold', true)]))).toBeNull();
    const two = [tr('platinum', true, 5, { setId: 1 }), tr('platinum', false, 2, { setId: 2 }), tr('gold', false, 3, { setId: 2 })];
    expect(platinumForecast(setAggsFromTrophies(two))).toBeNull();
  });
  it('считает остаток по грейдам, скрытые, среднюю и минимальную редкость, floor прогресса', () => {
    const list: T[] = [
      tr('platinum', false, 4.3),
      ...Array.from({ length: 196 }, () => tr('bronze', true, 50)),
      tr('gold', false, 1.2),
      tr('silver', false, 10.5, { hidden: true }),
      tr('bronze', false, null),
      tr('bronze', true, 70),
    ];
    const f = platinumForecast(setAggsFromTrophies(list));
    expect(f).toEqual({
      setId: 1, required: 200, earned: 197, progress: 98, // 98.5 -> floor
      remaining: { gold: 1, silver: 1, bronze: 1, total: 3 }, remainingHidden: 1,
      avgEarnedRate: 5.85, minEarnedRate: 1.2, ratesKnown: 2, platinumEarnedRate: 4.3, approximate: true, dlc: null,
    });
  });
  it('99.6% не округляется до 100; все получены, а платины нет: 100 и remaining 0', () => {
    const list: T[] = [tr('platinum', false), ...Array.from({ length: 249 }, () => tr('bronze', true)), tr('bronze', false)];
    expect(platinumForecast(setAggsFromTrophies(list))?.progress).toBe(99);
    const done = platinumForecast(setAggsFromTrophies([tr('platinum', false), tr('gold', true)]));
    expect(done).toMatchObject({ progress: 100, remaining: { total: 0 }, avgEarnedRate: null, minEarnedRate: null, ratesKnown: 0 });
  });
  it('несколько сетов: сет с платиной и лучшим прогрессом, ничья = меньший setId; сет без платины не участвует', () => {
    const list: T[] = [
      tr('platinum', false, null, { setId: 5 }), tr('gold', true, null, { setId: 5 }), tr('gold', false, null, { setId: 5 }),
      tr('platinum', false, null, { setId: 3 }), tr('gold', true, null, { setId: 3 }), tr('gold', false, null, { setId: 3 }),
      tr('gold', true, null, { setId: 9 }), // без платины, 100%
      tr('platinum', false, null, { setId: 8 }), tr('gold', false, null, { setId: 8 }),
    ];
    expect(platinumForecast(setAggsFromTrophies(list))?.setId).toBe(3);
  });
});

describe('rankNearPlatinum (чистая)', () => {
  const c = (gameId: number, title: string, earned: number, required: number): NearPlatinumCandidate => ({
    gameId, title, forecast: { setId: gameId, required, earned, progress: Math.floor((earned / required) * 100), remaining: { gold: 0, silver: 0, bronze: required - earned, total: required - earned }, remainingHidden: 0, avgEarnedRate: null, minEarnedRate: null, ratesKnown: 0, platinumEarnedRate: null },
  });
  it('earned = 0 отпадает; точный прогресс desc, остаток asc, title, id; лимит 5', () => {
    const r = rankNearPlatinum([c(1, 'b', 0, 10), c(2, 'a', 9, 10), c(3, 'c', 18, 20), c(4, 'B', 18, 20), c(5, 'z', 991, 1000), c(6, 'x', 1, 10), c(7, 'y', 2, 10), c(8, 'w', 3, 10)]);
    expect(r.map((x) => x.gameId)).toEqual([5, 2, 4, 3, 8]);
  });
});

describe('прогноз платины на PGlite', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  let n = 0;
  async function gameWithSet(name: string, earned: number, total: number, o: { platinumEarned?: boolean; hidden?: boolean; noPlatinum?: boolean } = {}) {
    n++;
    const [g] = await t.db.insert(games).values({ titleId: `CUSA${n}`, name, category: 'ps5_native_game', lastSeenAt: NOW, hiddenAt: o.hidden ? NOW : null }).returning();
    const [s] = await t.db.insert(trophySets).values({ npCommunicationId: `NPWR${n}`, npServiceName: 'trophy2', name, definedBronze: total, earnedBronze: earned, definedPlatinum: o.noPlatinum ? 0 : 1, earnedPlatinum: o.platinumEarned ? 1 : 0 }).returning();
    await t.db.insert(gameTrophySets).values({ gameId: g.id, trophySetId: s.id, source: 'title_id' });
    const rows: (typeof trophies.$inferInsert)[] = [];
    if (!o.noPlatinum) rows.push({ trophySetId: s.id, trophyId: 0, type: 'platinum', earned: !!o.platinumEarned, earnedAt: o.platinumEarned ? NOW : null, earnedRate: '3.00' });
    for (let i = 1; i <= total; i++) {
      const got = i <= earned;
      rows.push({ trophySetId: s.id, trophyId: i, type: 'bronze', earned: got, earnedAt: got ? NOW : null, earnedRate: got ? '60.00' : `${i}.50`, hidden: !got && i === total });
    }
    await t.db.insert(trophies).values(rows);
    return g.id;
  }

  it('GET /api/games/{id}: прогноз, null без платины и при полученной платине; скрытая игра тоже получает', async () => {
    const a = await gameWithSet('A', 8, 10);
    const noPlat = await gameWithSet('N', 1, 2, { noPlatinum: true });
    const got = await gameWithSet('P', 10, 10, { platinumEarned: true });
    const hid = await gameWithSet('H', 1, 2, { hidden: true });
    const d = await getGameDetails(t.db, a);
    expect(d?.platinumForecast).toEqual({
      setId: 1, required: 10, earned: 8, progress: 80, remaining: { gold: 0, silver: 0, bronze: 2, total: 2 }, remainingHidden: 1,
      avgEarnedRate: 10, minEarnedRate: 9.5, ratesKnown: 2, platinumEarnedRate: 3, approximate: true, dlc: null,
    });
    expect((await getGameDetails(t.db, noPlat))?.platinumForecast).toBeNull();
    expect((await getGameDetails(t.db, got))?.platinumForecast).toBeNull();
    expect((await getGameDetails(t.db, hid))?.platinumForecast).not.toBeNull();
  });

  it('сводка nearPlatinum: без dropped/скрытых/0 полученных/полученной платины; порядок; совпадает с окном игры', async () => {
    const a = await gameWithSet('A', 5, 10);
    const b = await gameWithSet('B', 9, 10);
    const dropped = await gameWithSet('D', 9, 10);
    await gameWithSet('H', 9, 10, { hidden: true });
    await gameWithSet('Z', 0, 10);
    await gameWithSet('P', 10, 10, { platinumEarned: true });
    const done = await gameWithSet('C', 1, 1);
    await setGameStatus(t.db, dropped, 'dropped', NOW);
    await setGameStatus(t.db, a, 'completed', NOW);
    const s = await getCollectionSummary(t.db);
    expect(s.nearPlatinum.map((x) => x.game.id)).toEqual([done, b, a]);
    const fromDetails = (await getGameDetails(t.db, b))?.platinumForecast;
    expect(s.nearPlatinum[1].forecast).toEqual(fromDetails);
  });

  it('пустая БД: nearPlatinum = []', async () => {
    expect((await getCollectionSummary(t.db)).nearPlatinum).toEqual([]);
  });
});
