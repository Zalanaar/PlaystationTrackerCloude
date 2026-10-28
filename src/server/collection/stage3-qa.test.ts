// QA этапа 3: повторный откат после reset_all, вторая reset_all, массовая смена 1000, played.games при исключениях.
import { asc } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { setGameStatus, setGamesStatusBulk } from '@/server/sync/status-rules';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { getLatestResetBackup, resetAllStatuses, restoreStatuses } from './mutations';

const { games, gameStatus } = schema;
const NOW = new Date('2026-10-27T10:00:00Z');

describe('QA этап 3 (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(() => t.reset());
  const mk = async (n: number) => (await t.db.insert(games).values({ titleId: `Q${n}`, name: `Q${n}`, category: 'ps4_game', lastSeenAt: NOW }).returning())[0].id;
  const rows = () => t.db.select().from(gameStatus).orderBy(asc(gameStatus.gameId));

  it('reset -> restore -> restore повторно идемпотентен; вторая reset_all даёт новую «последнюю» копию', async () => {
    const a = await mk(1), b = await mk(2);
    await setGameStatus(t.db, a, 'backlog', NOW);
    await setGameStatus(t.db, b, 'playing', NOW);
    const r1 = await resetAllStatuses(t.db, NOW);
    expect((await getLatestResetBackup(t.db)).latest?.id).toBe(r1.backupId);
    await restoreStatuses(t.db, r1.backupId as number, NOW);
    const afterFirst = (await rows()).map((r) => [r.gameId, r.status]);
    const again = await restoreStatuses(t.db, r1.backupId as number, NOW);
    expect(again.restored).toBe(2);
    expect((await rows()).map((r) => [r.gameId, r.status])).toEqual(afterFirst);
    // сброс пустой коллекции не затирает «последнюю» копию
    await resetAllStatuses(t.db, NOW); // 2-й сброс (есть статусы)
    const latest2 = (await getLatestResetBackup(t.db)).latest;
    expect(latest2?.id).not.toBe(r1.backupId);
    expect((await resetAllStatuses(t.db, NOW)).backupId).toBeNull();
    expect((await getLatestResetBackup(t.db)).latest?.id).toBe(latest2?.id);
  });

  it('массовая смена: ровно 1000 за раз и 250+ атомарно', async () => {
    await t.db.insert(games).values(Array.from({ length: 1000 }, (_, i) => ({ titleId: `B${i}`, name: `b${i}`, category: 'ps4_game', lastSeenAt: NOW })));
    const ids = (await t.db.select({ id: games.id }).from(games)).map((g) => g.id);
    expect(await setGamesStatusBulk(t.db, ids, 'backlog', NOW)).toBe(1000);
    expect(await rows()).toHaveLength(1000);
    // один id не существует -> ничего не меняется
    await expect(setGamesStatusBulk(t.db, [...ids.slice(0, 300), 99999999], 'dropped', NOW)).rejects.toThrow();
    expect((await rows()).every((r) => r.status === 'backlog')).toBe(true);
  });
});
