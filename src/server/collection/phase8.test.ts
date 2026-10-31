// Фаза 8 на PGlite: скрытие игр (9.7, 9.10), сброс всей коллекции (9.8), откат (9.9), видимость в статистике и Итогах.
import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { connectPsn } from '@/server/psn/client';
import { getStats } from '@/server/stats/query';
import { runChunk } from '@/server/sync/engine';
import { startRun } from '@/server/sync/runs';
import { BulkMissingError, setGameStatus, setGamesStatusBulk } from '@/server/sync/status-rules';
import { createTestDb, fakeApi, freshState, type TestDb, TEST_USER } from '@/server/sync/test-helpers';
import { getWrapped } from '@/server/wrapped/query';
import { BACKUPS_KEEP, getLatestResetBackup, NotFoundError, resetAllStatuses, restoreStatuses, setGameHidden } from './mutations';
import { getCollectionSummary, getGamesByIds, listGames } from './query';
import { parseListQuery } from './validation';

const { games, gameStatus, gameTrophySets, playtimeSnapshots, statusBackups, trophies, trophySets } = schema;
const NOW = new Date('2026-10-27T10:00:00Z');
const lq = (s = '') => {
  const p = parseListQuery(new URLSearchParams(s));
  if (!p.ok) throw new Error(p.message);
  return p.value;
};

describe('Фаза 8 (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function game(n: number, o: Partial<typeof games.$inferInsert> = {}) {
    const [g] = await t.db
      .insert(games)
      .values({ titleId: `CUSA${n}_00`, name: `G${n}`, category: 'ps5_native_game', lastSeenAt: NOW, ...o })
      .returning();
    return g.id;
  }
  async function trophySet(n: number, gameIds: number[], earned: { type: 'platinum' | 'gold'; at: string }[]) {
    const [s] = await t.db.insert(trophySets).values({ npCommunicationId: `NPWR${n}`, npServiceName: 'trophy2', name: `S${n}` }).returning();
    for (const gameId of gameIds) await t.db.insert(gameTrophySets).values({ gameId, trophySetId: s.id, source: 'title_id' });
    if (earned.length) {
      await t.db.insert(trophies).values(earned.map((e, i) => ({ trophySetId: s.id, trophyId: i, type: e.type, earned: true, earnedAt: new Date(e.at) })));
    }
    return s.id;
  }
  const statusRows = () => t.db.select().from(gameStatus).orderBy(asc(gameStatus.gameId));

  describe('скрытие (9.7, 9.10)', () => {
    it('скрытая игра исключена из списка, counts, years, summary; hidden=only отдаёт только скрытые; статус сохраняется', async () => {
      const a = await game(1, { playDurationSeconds: 3600, lastPlayedAt: new Date('2026-10-01T10:00:00Z') });
      const b = await game(2, { playDurationSeconds: 7200, lastPlayedAt: new Date('2026-10-02T10:00:00Z') });
      await setGameStatus(t.db, TEST_USER, a, 'playing', NOW);
      await setGameStatus(t.db, TEST_USER, b, 'completed', NOW);
      // трофеи: сет только скрытой игры (b), сет на обе игры, сирота
      await trophySet(1, [b], [{ type: 'platinum', at: '2026-05-01T10:00:00Z' }]);
      await trophySet(2, [a, b], [{ type: 'gold', at: '2026-05-02T10:00:00Z' }]);
      await trophySet(3, [], [{ type: 'gold', at: '2026-05-03T10:00:00Z' }]);

      await setGameHidden(t.db, TEST_USER, b, true, NOW);
      const first = (await getGamesByIds(t.db, TEST_USER, [b]))[0].hiddenAt;
      expect(first).toBe(NOW.toISOString());
      await setGameHidden(t.db, TEST_USER, b, true, new Date('2026-10-28T10:00:00Z'));
      expect((await getGamesByIds(t.db, TEST_USER, [b]))[0].hiddenAt, 'повторное скрытие не двигает hidden_at').toBe(first);

      const list = await listGames(t.db, TEST_USER, lq());
      expect(list.items.map((g) => g.id)).toEqual([a]);
      expect(list.total).toBe(1);
      expect(list.counts).toMatchObject({ all: 1, playing: 1, completed: 0 });
      expect(list.years).toEqual([]);
      expect(list.items[0].hiddenAt).toBeNull();

      const hidden = await listGames(t.db, TEST_USER, lq('hidden=only'));
      expect(hidden.items.map((g) => [g.id, g.status, g.hiddenAt])).toEqual([[b, 'completed', first]]);
      expect(hidden.counts).toMatchObject({ all: 1, completed: 1 });
      expect(hidden.years).toEqual([2026]);

      const s = await getCollectionSummary(t.db, TEST_USER);
      expect(s.totals).toEqual({ games: 1, playSeconds: 3600, hours: 1, trophiesEarned: 2, platinumEarned: 0 });
      expect(s.counts.all).toBe(1);
      expect(s.continue.map((g) => g.id)).toEqual([a]);

      // статус не тронут, возврат восстанавливает всё
      expect((await statusRows()).map((r) => [r.gameId, r.status])).toEqual([[a, 'playing'], [b, 'completed']]);
      await setGameHidden(t.db, TEST_USER, b, false, NOW);
      const back = await getCollectionSummary(t.db, TEST_USER);
      expect(back.totals).toMatchObject({ games: 2, trophiesEarned: 3, platinumEarned: 1 });
      expect((await getGamesByIds(t.db, TEST_USER, [b]))[0]).toMatchObject({ status: 'completed', hiddenAt: null });
    });

    it('нет игры: NotFoundError', async () => {
      await expect(setGameHidden(t.db, TEST_USER, 999, true)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('status-bulk: скрытые id считаются отсутствующими, ничего не меняется', async () => {
      const a = await game(1);
      const b = await game(2);
      await setGameHidden(t.db, TEST_USER, b, true, NOW);
      const err = await setGamesStatusBulk(t.db, TEST_USER, [a, b], 'backlog', NOW).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BulkMissingError);
      expect((err as BulkMissingError).missingIds).toEqual([b]);
      expect(await statusRows()).toEqual([]);
    });

    it('статистика и Итоги: часы, оценка, played, finished, жанры, трофеи без скрытых; сирота и общий сет считаются', async () => {
      const a = await game(1, { psnGenres: ['ACTION'], firstPlayedAt: new Date('2026-01-10T10:00:00Z') });
      const b = await game(2, { psnGenres: ['PUZZLE'], firstPlayedAt: new Date('2026-01-10T10:00:00Z') });
      for (const id of [a, b]) {
        await t.db.insert(playtimeSnapshots).values([
          { gameId: id, snapshotDate: '2026-03-04', playDurationSeconds: 10 * 3600, lastPlayedAt: new Date('2026-02-01T10:00:00Z') },
          { gameId: id, snapshotDate: '2026-03-10', playDurationSeconds: 12 * 3600 },
        ]);
      }
      await t.db.insert(gameStatus).values({ gameId: b, status: 'completed', completedAt: new Date('2026-03-10T10:00:00Z') });
      await trophySet(1, [b], [{ type: 'platinum', at: '2026-03-10T10:00:00Z' }]);
      await trophySet(2, [a, b], [{ type: 'platinum', at: '2026-03-11T10:00:00Z' }]);
      await trophySet(3, [], [{ type: 'gold', at: '2026-03-12T10:00:00Z' }]);

      const before = await getStats(t.db, TEST_USER, { type: 'year', year: 2026, month: null }, NOW);
      expect(before.header).toMatchObject({ hours: 24, completed: 1, platinum: 2 });

      await setGameHidden(t.db, TEST_USER, b, true, NOW);
      const r = await getStats(t.db, TEST_USER, { type: 'year', year: 2026, month: null }, NOW);
      expect(r.header).toEqual({ completed: 0, dropped: 0, hours: 12, platinum: 1 });
      expect(r.hours.estimatedHours).toBe(10);
      expect(r.trophies.counts).toMatchObject({ platinum: 1, gold: 1, total: 2 });
      expect(r.genres.items.map((g) => g.key)).toEqual(['ACTION']);
      expect(r.finished.groups).toEqual([]);
      const ids = new Set(r.played.groups.flatMap((g) => g.items.map((i) => i.gameId)));
      expect([...ids]).toEqual([a]);
      expect(Object.keys(r.played.games)).toEqual([String(a)]);
      expect(r.played.groups.map((g) => g.month)).toEqual(['2026-03', '2026-02', '2026-01']);

      const w = await getWrapped(t.db, TEST_USER, 2026, null, NOW);
      expect(w.hours.total).toBe(12);
      expect(w.topGames.items.map((i) => i.game.id)).toEqual([a]);
      expect(w.finished.completed.count).toBe(0);
      expect(w.trophies.counts.platinum).toBe(1);
      // платина общего сета приписана видимой игре
      expect(w.trophies.platinum.first?.game?.id).toBe(a);
    });

    it('синк не трогает hidden_at; снимки скрытой игры пишутся', async () => {
      const state = freshState();
      const clock = { t: new Date('2026-10-27T17:00:00Z').getTime() };
      const deps = {
        db: t.db,
        now: () => new Date(clock.t),
        budgetMs: 1_000_000,
        connect: () =>
          connectPsn({
            getAccessToken: async () => 'test-token',
            onlineId: 'Target',
            delayMs: 0,
            api: fakeApi(state),
            sleep: async (ms: number) => {
              clock.t += ms;
            },
            now: () => clock.t,
          }),
      };
      const run = async () => {
        const s = await startRun(t.db, TEST_USER, { kind: 'manual', now: new Date(clock.t) });
        if (s.kind !== 'started') throw new Error(s.kind);
        await runChunk(deps, s.run);
      };
      await run();
      const [g] = await t.db.select().from(games).orderBy(asc(games.id)).limit(1);
      await setGameHidden(t.db, TEST_USER, g.id, true, NOW);
      clock.t = new Date('2026-10-28T17:00:00Z').getTime();
      await run();
      const [after] = await t.db.select().from(games).where(eq(games.id, g.id));
      expect(after.hiddenAt?.toISOString()).toBe(NOW.toISOString());
      expect(after.lastSeenAt.getTime()).toBeGreaterThan(g.lastSeenAt.getTime());
      const snaps = await t.db.select().from(playtimeSnapshots).where(eq(playtimeSnapshots.gameId, g.id));
      expect(snaps.map((s) => s.snapshotDate).sort()).toEqual(['2026-10-27', '2026-10-28']);
    });
  });

  describe('сброс всей коллекции и откат (9.8, 9.9)', () => {
    it('сброс: бэкап с датами, удаляются только видимые; откат возвращает ровно как было', async () => {
      const a = await game(1, { lastPlayedAt: new Date('2026-09-01T10:00:00Z') });
      const b = await game(2, { lastPlayedAt: new Date('2026-09-02T10:00:00Z') });
      const c = await game(3);
      const h = await game(4);
      await setGameStatus(t.db, TEST_USER, a, 'completed', new Date('2026-09-05T10:00:00Z'));
      await t.db.update(gameStatus).set({ completedAt: new Date('2026-08-15T00:00:00Z') }).where(eq(gameStatus.gameId, a)); // ручная дата
      await setGameStatus(t.db, TEST_USER, b, 'dropped', new Date('2026-09-06T10:00:00Z'));
      await setGameStatus(t.db, TEST_USER, h, 'backlog', NOW);
      await setGameHidden(t.db, TEST_USER, h, true, NOW);
      const original = (await statusRows()).filter((r) => r.gameId !== h);

      const res = await resetAllStatuses(t.db, TEST_USER, NOW);
      expect(res).toEqual({ backupId: 1, reset: 2 });
      expect((await statusRows()).map((r) => r.gameId), 'статус скрытой игры не тронут').toEqual([h]);
      const [bk] = await t.db.select().from(statusBackups);
      expect(bk.reason).toBe('reset_all');
      expect(bk.payload).toEqual([
        { gameId: a, status: 'completed', completedAt: '2026-08-15T00:00:00.000Z', droppedAt: null, statusChangedAt: '2026-09-05T10:00:00.000Z' },
        { gameId: b, status: 'dropped', completedAt: null, droppedAt: '2026-09-02T10:00:00.000Z', statusChangedAt: '2026-09-06T10:00:00.000Z' },
      ]);

      // после сброса пользователь успел поставить статус другой игре: откат делает «ровно как в бэкапе»
      await setGameStatus(t.db, TEST_USER, c, 'playing', NOW);
      const rr = await restoreStatuses(t.db, TEST_USER, res.backupId as number, new Date('2026-10-28T10:00:00Z'));
      expect(rr).toEqual({ restored: 2, skipped: 0, backupId: 2 });
      const now = await statusRows();
      const pick = (r: (typeof original)[number]) => [r.gameId, r.status, r.completedAt, r.droppedAt, r.statusChangedAt];
      expect(now.filter((r) => r.gameId !== h).map(pick)).toEqual(original.map(pick));
      expect(now.find((r) => r.gameId === h)?.status).toBe('backlog');
      // состояние до отката сохранено
      const [pre] = await t.db.select().from(statusBackups).where(eq(statusBackups.id, 2));
      expect(pre.reason).toBe('before_restore');
      expect(pre.payload).toEqual([{ gameId: c, status: 'playing', completedAt: null, droppedAt: null, statusChangedAt: NOW.toISOString() }]);
    });

    it('нечего сбрасывать: backupId null, бэкап не создан', async () => {
      await game(1);
      expect(await resetAllStatuses(t.db, TEST_USER, NOW)).toEqual({ backupId: null, reset: 0 });
      expect(await t.db.select().from(statusBackups)).toEqual([]);
    });

    it('откат: исчезнувшие и скрытые игры и мусорные строки пропускаются; нет бэкапа = NotFoundError', async () => {
      const a = await game(1);
      const b = await game(2);
      const c = await game(3);
      await setGameStatus(t.db, TEST_USER, a, 'playing', NOW);
      await setGameStatus(t.db, TEST_USER, b, 'backlog', NOW);
      await setGameStatus(t.db, TEST_USER, c, 'shelved', NOW);
      const { backupId } = await resetAllStatuses(t.db, TEST_USER, NOW);
      await t.db.delete(games).where(eq(games.id, b));
      await setGameHidden(t.db, TEST_USER, c, true, NOW);
      // мусор в payload: дата не по статусу и неизвестный статус
      await t.db.execute(sql`update status_backups set payload = payload || ${JSON.stringify([
        { gameId: a, status: 'playing', completedAt: '2026-01-01T00:00:00Z', droppedAt: null, statusChangedAt: '2026-01-01T00:00:00Z' },
        { gameId: 77, status: 'wat', completedAt: null, droppedAt: null, statusChangedAt: '2026-01-01T00:00:00Z' },
      ])}::jsonb where id = ${backupId}`);
      const rr = await restoreStatuses(t.db, TEST_USER, backupId as number, NOW);
      expect(rr).toMatchObject({ restored: 1, skipped: 4 });
      expect((await statusRows()).map((r) => [r.gameId, r.status])).toEqual([[a, 'playing']]);
      await expect(restoreStatuses(t.db, TEST_USER, 999, NOW)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('getLatestResetBackup (9.9a): пусто -> null; последняя reset_all с count; before_restore игнорируется; после отката остаётся', async () => {
      expect(await getLatestResetBackup(t.db, TEST_USER)).toEqual({ latest: null });
      const a = await game(1);
      const b = await game(2);
      await setGameStatus(t.db, TEST_USER, a, 'playing', NOW);
      expect(await resetAllStatuses(t.db, TEST_USER, NOW)).toMatchObject({ backupId: 1 });
      expect(await getLatestResetBackup(t.db, TEST_USER)).toEqual({
        latest: { id: 1, createdAt: NOW.toISOString(), reason: 'reset_all', count: 1 },
      });

      await setGameStatus(t.db, TEST_USER, a, 'playing', NOW);
      await setGameStatus(t.db, TEST_USER, b, 'backlog', NOW);
      const later = new Date('2026-10-28T10:00:00Z');
      await resetAllStatuses(t.db, TEST_USER, later); // id 2, count 2
      const r = await restoreStatuses(t.db, TEST_USER, 2, later); // before_restore (id 3) новее, но не reset_all
      expect(r.backupId).toBe(3);
      expect(await getLatestResetBackup(t.db, TEST_USER)).toEqual({
        latest: { id: 2, createdAt: later.toISOString(), reason: 'reset_all', count: 2 },
      });
    });

    it('getLatestResetBackup: только before_restore -> null', async () => {
      await game(1);
      const { backupId } = await resetAllStatuses(t.db, TEST_USER, NOW);
      expect(backupId).toBeNull();
      await t.db.insert(statusBackups).values({ reason: 'before_restore', payload: [] });
      expect(await getLatestResetBackup(t.db, TEST_USER)).toEqual({ latest: null });
    });

    it(`хранятся последние ${BACKUPS_KEEP} бэкапов`, async () => {
      const a = await game(1);
      for (let i = 0; i < BACKUPS_KEEP + 3; i++) {
        await setGameStatus(t.db, TEST_USER, a, 'playing', NOW);
        await resetAllStatuses(t.db, TEST_USER, NOW);
      }
      const ids = (await t.db.select({ id: statusBackups.id }).from(statusBackups).orderBy(asc(statusBackups.id))).map((r) => r.id);
      expect(ids).toEqual(Array.from({ length: BACKUPS_KEEP }, (_, i) => i + 4));
      await expect(restoreStatuses(t.db, TEST_USER, 1, NOW)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
