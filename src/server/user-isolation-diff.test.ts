// QA 20.3, п. 6: дифференциальный тест изоляции. user-isolation.test.ts ловит только утечку МАРКЕРОВ в тексте; утечка чисел
// (часы, счётчики, трофеи) без названий чужих игр им не видна. Здесь вывод читающих функций пользователя X в БД, где есть данные
// и другого пользователя, должен ПОБАЙТОВО совпадать с выводом в БД, где есть только X (те же id благодаря порядку засева).
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import type { UserId } from '@/server/auth/user-id';
import { buildBackup } from '@/server/backup/export';
import { getCollectionSummary, listGames } from '@/server/collection/query';
import { parseListQuery } from '@/server/collection/validation';
import { getRecommendations } from '@/server/recommend/db';
import { getRoadmap } from '@/server/roadmap/db';
import { getActivity } from '@/server/stats/activity-query';
import { getEstimateInputs } from '@/server/stats/estimate-query';
import { getMonthExclusions } from '@/server/stats/exclusions';
import { getStats } from '@/server/stats/query';
import { getRareTrophies } from '@/server/stats/rare-query';
import { getSyncStatus } from '@/server/sync/status';
import { createTestDb, TEST_USER, TEST_USER_2, type TestDb } from '@/server/sync/test-helpers';
import { getWrapped } from '@/server/wrapped/query';

const { games, gameStatus, playtimeSnapshots, trophySets, trophies, gameTrophySets, plannedGames, roadmapSettings, roadmapOrder, syncRuns, gameMonthExclusions } = schema;
const NOW = new Date('2026-10-27T10:00:00Z');
const A = TEST_USER;
const B = TEST_USER_2;

async function prepare(): Promise<TestDb> {
  const t = await createTestDb();
  await t.db.execute(sql.raw(`insert into allowed_users (email, role, status, psn_online_id) values ('b@example.com', 'member', 'active', 'psnB')`));
  return t;
}

/** Данные с числами, заметно различающимися у A и B: часы, трофеи, завершённые/брошенные, исключённый месяц, план, запуск синка. */
async function seed(t: TestDb, u: UserId): Promise<void> {
  const k = u === A ? 1 : 7;
  const mk = async (titleId: string, name: string, secs: number) =>
    (await t.db.insert(games).values({ userId: u, titleId, name: `${name} ${u}`, category: 'ps5_native_game', lastSeenAt: NOW, psnGenres: [u === A ? 'ACTION' : 'RPG'], playDurationSeconds: secs, lastPlayedAt: new Date('2026-09-01T10:00:00Z'), firstPlayedAt: new Date('2026-02-01T10:00:00Z'), hltbMainHours: 10 + k }).returning({ id: games.id }))[0].id;
  const g1 = await mk('SAME', 'One', 3600 * 20 * k);
  const g2 = await mk('SAME2', 'Two', 3600 * 5 * k);
  const g3 = await mk('ONLY' + u, 'Three', 3600 * k);
  await t.db.insert(gameStatus).values([
    { userId: u, gameId: g1, status: 'completed', completedAt: new Date(`2026-0${2 + k % 3}-05T10:00:00Z`) },
    { userId: u, gameId: g2, status: 'dropped', droppedAt: new Date('2026-04-05T10:00:00Z') },
    { userId: u, gameId: g3, status: 'backlog' },
  ]);
  await t.db.insert(playtimeSnapshots).values([
    { userId: u, gameId: g1, snapshotDate: '2025-12-20', playDurationSeconds: 50 * k },
    { userId: u, gameId: g1, snapshotDate: '2026-01-10', playDurationSeconds: 100 * k },
    { userId: u, gameId: g1, snapshotDate: '2026-03-10', playDurationSeconds: 3600 * 10 * k },
    { userId: u, gameId: g1, snapshotDate: '2026-10-10', playDurationSeconds: 3600 * 20 * k },
    { userId: u, gameId: g2, snapshotDate: '2026-05-10', playDurationSeconds: 3600 * k },
    { userId: u, gameId: g2, snapshotDate: '2026-10-10', playDurationSeconds: 3600 * 5 * k },
  ]);
  const [set] = await t.db.insert(trophySets).values({ userId: u, npCommunicationId: 'NPWR_SAME', npServiceName: 'trophy', name: `Set ${u}`, definedBronze: 2 + k, earnedBronze: k, definedPlatinum: 1 }).returning({ id: trophySets.id });
  await t.db.insert(gameTrophySets).values({ userId: u, gameId: g1, trophySetId: set.id, source: 'title_id' });
  await t.db.insert(trophies).values(
    Array.from({ length: 2 + k }, (_, i) => ({ userId: u, trophySetId: set.id, trophyId: i, type: 'bronze' as const, name: `T${i}`, earned: i < k, earnedAt: i < k ? new Date(`2026-0${3 + (i % 5)}-05T10:00:00Z`) : null, earnedRate: String(1 + i) })),
  );
  await t.db.insert(plannedGames).values({ userId: u, title: `Plan ${u}`, externalSource: 'rawg', externalId: '777', releaseDate: '2027-03-03', status: 'planned', hoursManual: 5 * k });
  await t.db.insert(roadmapSettings).values({ userId: u, year: 2026, hoursPerWeek: 3 * k });
  await t.db.insert(roadmapOrder).values({ userId: u, gameId: g3, position: 0 });
  await t.db.insert(syncRuns).values({ userId: u, kind: 'daily', status: 'success', snapshotDate: '2026-10-26', startedAt: NOW, finishedAt: NOW, gamesSeen: 11 * k });
  await t.db.insert(gameMonthExclusions).values({ userId: u, gameId: g1, month: '2026-02' });
}

function readers(t: TestDb, u: UserId): Record<string, () => Promise<unknown>> {
  const lq = () => {
    const p = parseListQuery(new URLSearchParams());
    if (!p.ok) throw new Error(p.message);
    return p.value;
  };
  return {
    statsYear: () => getStats(t.db, u, { type: 'year', year: 2026, month: null }, NOW),
    statsMarch: () => getStats(t.db, u, { type: 'month', year: 2026, month: 3 }, NOW),
    statsApril: () => getStats(t.db, u, { type: 'month', year: 2026, month: 4 }, NOW),
    wrapped: () => getWrapped(t.db, u, 2026, null, NOW),
    activity: () => getActivity(t.db, u, 2026, NOW),
    rare: () => getRareTrophies(t.db, u, null),
    estimates: () => getEstimateInputs(t.db, u),
    exclusions: async () => [...(await getMonthExclusions(t.db, u))].map(([a, v]) => [a, [...v]]),
    summary: () => getCollectionSummary(t.db, u),
    list: () => listGames(t.db, u, lq(), NOW),
    roadmap: () => getRoadmap(t.db, u, NOW),
    recommend: () => getRecommendations(t.db, u, 'any', NOW, { llm: null }),
    syncStatus: () => getSyncStatus(t.db, u, NOW),
    backup: () => buildBackup(t.db, u, NOW),
  };
}

// statusChangedAt = now() БД при вставке (отличается между БД), на сравнение не влияет
const dump = (v: unknown) => JSON.stringify(v, (_k, x) => (x instanceof Set ? [...x] : x)).replace(/"statusChangedAt":"[^"]*"/g, '"statusChangedAt":"-"');

describe('дифференциальная изоляция: вывод пользователя не зависит от данных другого', () => {
  const dbs: Partial<Record<'mixedBA' | 'onlyB' | 'mixedAB' | 'onlyA', TestDb>> = {};

  beforeAll(async () => {
    dbs.mixedBA = await prepare();
    await seed(dbs.mixedBA, B);
    await seed(dbs.mixedBA, A);
    dbs.onlyB = await prepare();
    await seed(dbs.onlyB, B);
    dbs.mixedAB = await prepare();
    await seed(dbs.mixedAB, A);
    await seed(dbs.mixedAB, B);
    dbs.onlyA = await prepare();
    await seed(dbs.onlyA, A);
  });
  afterAll(async () => {
    for (const d of Object.values(dbs)) await d?.close();
  });

  for (const [u, mixed, only] of [[B, 'mixedBA', 'onlyB'], [A, 'mixedAB', 'onlyA']] as const) {
    it(`пользователь ${u === A ? 'A' : 'B'}: все читающие функции дают тот же результат с чужими данными и без них`, async () => {
      const m = readers(dbs[mixed]!, u);
      const o = readers(dbs[only]!, u);
      const diffs: string[] = [];
      for (const name of Object.keys(m)) {
        if (dump(await m[name]()) !== dump(await o[name]())) diffs.push(name);
      }
      expect(diffs, 'чужие данные повлияли на результат').toEqual([]);
    });
  }

  it('тест не пустой: у A и B данные заметно различаются', async () => {
    const a = await getStats(dbs.onlyA!.db, A, { type: 'year', year: 2026, month: null }, NOW);
    const b = await getStats(dbs.onlyB!.db, B, { type: 'year', year: 2026, month: null }, NOW);
    expect(dump(a)).not.toBe(dump(b));
    expect(dump(await getActivity(dbs.onlyA!.db, A, 2026, NOW))).not.toBe(dump(await getActivity(dbs.onlyB!.db, B, 2026, NOW)));
  });
});
