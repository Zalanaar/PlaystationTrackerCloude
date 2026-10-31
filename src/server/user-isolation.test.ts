// Тест утечек (контракт 22.6, 22.12): два пользователя с пересекающимися title_id, np_communication_id, external_id и датами снимков.
// Состояние после 0015 моделируется на PGlite: старые глобальные ключи убираются (в проде до 0015 второго пользователя с теми же играми быть не может).
// Принцип: читающая функция пользователя не возвращает ни байта чужих данных (маркеры MARK_A / MARK_B в названиях), а мутации по чужим id дают not found и ничего не меняют.
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { asUserId, type UserId } from '@/server/auth/user-id';
import { resetTestSession, testSession } from '@/server/auth/test-require-user';
import { createTestDb, fakeApi, freshState, TEST_USER, TEST_USER_2, type TestDb } from '@/server/sync/test-helpers';

const holder: { db: TestDb['db'] | null } = { db: null };
vi.mock('@/db', async (orig) => ({
  ...(await orig<typeof import('@/db')>()),
  getDb: () => {
    if (!holder.db) throw new Error('no db');
    return holder.db;
  },
}));
vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);

import { GET as gamesGet } from '@/app/api/games/route';
import { GET as gameGet } from '@/app/api/games/[id]/route';
import { PUT as statusPut } from '@/app/api/games/[id]/status/route';
import { PUT as hiddenPut } from '@/app/api/games/[id]/hidden/route';
import { DELETE as plannedDelete, PATCH as plannedPatch } from '@/app/api/roadmap/planned/[id]/route';
import { GET as summaryGet } from '@/app/api/collection/summary/route';
import { GET as backupGet } from '@/app/api/backup/route';
import { GET as wrappedGet } from '@/app/api/wrapped/route';
import { GET as statsGet } from '@/app/api/stats/route';
import { GET as roadmapGet } from '@/app/api/roadmap/route';
import { GET as syncStatusGet } from '@/app/api/sync/status/route';
import { GET as healthGet } from '@/app/api/health/route';
import { POST as restorePost } from '@/app/api/backup/restore/route';

import { buildBackup } from '@/server/backup/export';
import { applyRestore, previewRestore } from '@/server/backup/restore';
import { parseBackup } from '@/server/backup/format';
import { getCollectionSummary, getGamesByIds, listGames } from '@/server/collection/query';
import { getGameDetails } from '@/server/collection/details';
import { getLatestResetBackup, NotFoundError as CollectionNotFound, resetAllStatuses, restoreStatuses, setDurationOverride, setGameHidden } from '@/server/collection/mutations';
import { getNearPlatinumCandidates } from '@/server/collection/platinum-query';
import { getPsnProfile } from '@/server/collection/profile';
import { parseListQuery } from '@/server/collection/validation';
import { dislikeGame, getRecommendations, listDislikes, loadCandidates, NotFoundError as RecNotFound, undislikeGame } from '@/server/recommend/db';
import { getDiscover } from '@/server/recommend/discover';
import { dislikeExternal, listExternalDislikes, undislikeExternal } from '@/server/recommend/discover-dislikes';
import { reserveCall, usedToday } from '@/server/recommend/budget';
import {
  createPlanned, deletePlanned, excludeGame, getBacklogEntries, getRoadmap, getServiceGames, getSettings, getUnallocated, listPlanned,
  NotFoundError as RoadmapNotFound, putSettings, restoreGame, saveOrder, UnknownGamesError, updatePlanned,
} from '@/server/roadmap/db';
import { getActivity } from '@/server/stats/activity-query';
import { getEstimateInputs } from '@/server/stats/estimate-query';
import { getMonthExclusions, setMonthExclusion } from '@/server/stats/exclusions';
import { getStats } from '@/server/stats/query';
import { getRareTrophies } from '@/server/stats/rare-query';
import { connectPsn } from '@/server/psn/client';
import { runChunk } from '@/server/sync/engine';
import { startRun } from '@/server/sync/runs';
import { getSyncOverdue } from '@/server/sync/overdue';
import { getSyncStatus } from '@/server/sync/status';
import { BulkMissingError, setGameStatus, setGamesStatusBulk, setStatusDate, StatusRuleError } from '@/server/sync/status-rules';
import { getWrapped } from '@/server/wrapped/query';
import { listAccessUsers } from '@/server/auth/users';

const { games, gameStatus, playtimeSnapshots, trophySets, trophies, gameTrophySets, plannedGames, roadmapSettings, roadmapOrder, roadmapExcluded, psnProfile, syncRuns, statusBackups, recommendDiscoverCache, gameMonthExclusions } = schema;

const NOW = new Date('2026-10-27T10:00:00Z');
const A = TEST_USER;
const B = TEST_USER_2;
const mark = (u: UserId) => (u === A ? 'MARK_A' : 'MARK_B');
const other = (u: UserId) => (u === A ? 'MARK_B' : 'MARK_A');

describe('изоляция пользователей: два пользователя с пересекающимися ключами', () => {
  let t: TestDb;
  const ids: Record<number, { same: number; only: number; planned: number; backupId: number; set: number }> = {};

  beforeAll(async () => {
    t = await createTestDb();
    holder.db = t.db;
    await t.db.execute(sql.raw(`insert into allowed_users (email, role, status, psn_online_id) values ('b@example.com', 'member', 'active', 'psnB')`));
    // схема уже после 0015: глобальных ключей нет, миграции применены целиком
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await t.reset();
    resetTestSession();
    holder.db = t.db;
    await seed(A);
    await seed(B);
    // старые ключи PK game_id у dislikes/status глобальны (game_id уникален), потому ids разные
  });

  async function seed(u: UserId): Promise<void> {
    const m = mark(u);
    const [same] = await t.db.insert(games).values({
      userId: u, titleId: 'SAME', name: `Same ${m}`, category: 'ps5_native_game', lastSeenAt: NOW, psnGenres: ['ACTION'], playDurationSeconds: u === A ? 7200 : 600,
      lastPlayedAt: new Date('2026-10-01T10:00:00Z'), hltbMainHours: 10,
    }).returning({ id: games.id });
    const [only] = await t.db.insert(games).values({
      userId: u, titleId: `ONLY_${m}`, name: `Only ${m}`, category: 'ps4_game', lastSeenAt: NOW, psnGenres: ['RPG'], playDurationSeconds: 100,
    }).returning({ id: games.id });
    await t.db.insert(gameStatus).values([
      { userId: u, gameId: same.id, status: u === A ? 'completed' : 'backlog', completedAt: u === A ? new Date('2026-03-01T10:00:00Z') : null },
      { userId: u, gameId: only.id, status: 'backlog' },
    ]);
    await t.db.insert(playtimeSnapshots).values([
      { userId: u, gameId: same.id, snapshotDate: '2026-01-10', playDurationSeconds: 100 },
      { userId: u, gameId: same.id, snapshotDate: '2026-10-10', playDurationSeconds: u === A ? 7200 : 600 },
    ]);
    const [set] = await t.db.insert(trophySets).values({ userId: u, npCommunicationId: 'NPWR_SAME', npServiceName: 'trophy', name: `Set ${m}`, definedBronze: 2, earnedBronze: 1, definedPlatinum: 1 }).returning({ id: trophySets.id });
    await t.db.insert(gameTrophySets).values({ userId: u, gameId: same.id, trophySetId: set.id, source: 'title_id' });
    await t.db.insert(trophies).values([
      { userId: u, trophySetId: set.id, trophyId: 0, type: 'bronze', name: `Tr ${m}`, earned: true, earnedAt: new Date('2026-05-05T10:00:00Z'), earnedRate: '3.00' },
      { userId: u, trophySetId: set.id, trophyId: 1, type: 'platinum', name: `Plat ${m}`, earned: false, earnedRate: '1.00' },
    ]);
    const [pl] = await t.db.insert(plannedGames).values({ userId: u, title: `Plan ${m}`, externalSource: 'rawg', externalId: '777', releaseDate: '2027-03-03', status: 'planned', hoursManual: 5 }).returning({ id: plannedGames.id });
    await t.db.insert(roadmapSettings).values({ userId: u, year: 2026, hoursPerWeek: u === A ? 5 : 7 });
    await t.db.insert(roadmapOrder).values({ userId: u, gameId: only.id, position: 0 });
    await t.db.insert(psnProfile).values({ userId: u, onlineId: `Nick ${m}` });
    await t.db.insert(syncRuns).values({ userId: u, kind: 'daily', status: 'success', snapshotDate: '2026-10-26', startedAt: NOW, finishedAt: NOW, gamesSeen: u === A ? 11 : 22 });
    const [bk] = await t.db.insert(statusBackups).values({ userId: u, reason: 'reset_all', payload: [{ gameId: same.id, status: 'playing', completedAt: null, droppedAt: null, statusChangedAt: NOW.toISOString() }] }).returning({ id: statusBackups.id });
    await t.db.insert(recommendDiscoverCache).values({
      userId: u, day: '2026-10-27', profileHash: 'h', payload: { proposed: 1, candidates: [{ externalSource: 'rawg', externalId: '9', title: `Disc ${m}`, releaseDate: null, coverUrl: null, platforms: ['PS5'], reason: 'r' }] },
    });
    await dislikeGame(t.db, u, only.id, NOW);
    await dislikeExternal(t.db, u, { externalSource: 'rawg', externalId: '55', title: `Ext ${m}`, coverUrl: null }, NOW);
    await t.db.insert(gameMonthExclusions).values({ userId: u, gameId: same.id, month: '2026-02' });
    ids[u] = { same: same.id, only: only.id, planned: pl.id, backupId: bk.id, set: set.id };
  }

  const q = () => {
    const p = parseListQuery(new URLSearchParams());
    if (!p.ok) throw new Error(p.message);
    return p.value;
  };

  /** Все читающие функции для пользователя u. */
  function readers(u: UserId): Record<string, () => Promise<unknown>> {
    return {
      listGames: () => listGames(t.db, u, q(), NOW),
      listGamesHidden: () => listGames(t.db, u, { ...q(), hiddenOnly: true }, NOW),
      summary: () => getCollectionSummary(t.db, u),
      gamesByIds: () => getGamesByIds(t.db, u, [ids[A].same, ids[B].same, ids[A].only, ids[B].only]),
      details: () => getGameDetails(t.db, u, ids[u].same),
      nearPlatinum: () => getNearPlatinumCandidates(t.db, u),
      profile: () => getPsnProfile(t.db, u),
      statsYear: () => getStats(t.db, u, { type: 'year', year: 2026, month: null }, NOW),
      statsMonth: () => getStats(t.db, u, { type: 'month', year: 2026, month: 3 }, NOW),
      wrapped: () => getWrapped(t.db, u, 2026, null, NOW),
      activity: () => getActivity(t.db, u, 2026, NOW),
      rare: () => getRareTrophies(t.db, u, null),
      estimates: () => getEstimateInputs(t.db, u),
      exclusions: async () => [...(await getMonthExclusions(t.db, u))].map(([k, v]) => [k, [...v]]),
      roadmap: () => getRoadmap(t.db, u, NOW),
      backlog: () => getBacklogEntries(t.db, u),
      unallocated: () => getUnallocated(t.db, u),
      service: () => getServiceGames(t.db, u),
      planned: () => listPlanned(t.db, u, 'all'),
      settings: () => getSettings(t.db, u, NOW),
      candidates: () => loadCandidates(t.db, u),
      recommend: () => getRecommendations(t.db, u, 'any', NOW, { llm: null }),
      dislikes: () => listDislikes(t.db, u, NOW),
      externalDislikes: () => listExternalDislikes(t.db, u, NOW),
      discover: () => getDiscover(t.db, u, { refresh: false }, NOW, { llm: { provider: 'groq', apiKey: 'k', model: null, dailyLimit: 5 }, rawgKey: 'r' }),
      backup: () => buildBackup(t.db, u, NOW),
      latestBackup: () => getLatestResetBackup(t.db, u),
      syncStatus: () => getSyncStatus(t.db, u, NOW),
      overdue: () => getSyncOverdue(t.db, u, NOW),
    };
  }

  for (const u of [A, B]) {
    it(`читающие функции пользователя ${mark(u)} не содержат данных ${other(u)}`, async () => {
      for (const [name, fn] of Object.entries(readers(u))) {
        const json = JSON.stringify(await fn(), (_k, v) => (v instanceof Set ? [...v] : v));
        expect(json, `${name} утёк ${other(u)}`).not.toContain(other(u));
        if (['listGames', 'summary', 'planned', 'profile', 'backup', 'discover', 'externalDislikes'].includes(name)) {
          expect(json, `${name} без своих данных`).toContain(mark(u));
        }
      }
    });
  }

  it('счётчики и суммы считаются по пользователю', async () => {
    const sa = await getCollectionSummary(t.db, A);
    const sb = await getCollectionSummary(t.db, B);
    expect(sa.totals.games).toBe(2);
    expect(sb.totals.games).toBe(2);
    expect(sa.totals.playSeconds).toBe(7300);
    expect(sb.totals.playSeconds).toBe(700);
    expect(sa.counts).toMatchObject({ all: 2, completed: 1, backlog: 1 });
    expect(sb.counts).toMatchObject({ all: 2, completed: 0, backlog: 2 });
    expect((await getStats(t.db, A, { type: 'year', year: 2026, month: null }, NOW)).header.completed).toBe(1);
    expect((await getStats(t.db, B, { type: 'year', year: 2026, month: null }, NOW)).header.completed).toBe(0);
    const users = await listAccessUsers(t.db);
    expect(users.map((x) => [x.id, x.gamesCount])).toEqual([[1, 2], [2, 2]]);
    expect(users.find((x) => x.id === 1)?.lastSyncAt).not.toBeNull();
  });

  it('чужой id игры: B не читает и не меняет данные A (not found), состояние A прежнее', async () => {
    const before = JSON.stringify([await listGames(t.db, A, q(), NOW), await buildBackup(t.db, A, NOW)]);
    const aGame = ids[A].same;
    expect(await getGameDetails(t.db, B, aGame)).toBeNull();
    expect(await getGamesByIds(t.db, B, [aGame])).toEqual([]);
    await expect(setGameStatus(t.db, B, aGame, 'dropped', NOW)).rejects.toMatchObject({ code: 'not_found' });
    await expect(setGameStatus(t.db, B, aGame, null, NOW)).rejects.toBeInstanceOf(StatusRuleError);
    await expect(setStatusDate(t.db, B, aGame, new Date('2026-01-01T00:00:00Z'), NOW)).rejects.toBeInstanceOf(StatusRuleError);
    await expect(setGamesStatusBulk(t.db, B, [aGame, ids[B].same], 'dropped', NOW)).rejects.toBeInstanceOf(BulkMissingError);
    await expect(setGameHidden(t.db, B, aGame, true, NOW)).rejects.toBeInstanceOf(CollectionNotFound);
    await expect(setDurationOverride(t.db, B, aGame, 5)).rejects.toBeInstanceOf(CollectionNotFound);
    await expect(setMonthExclusion(t.db, B, aGame, '2026-03', true)).rejects.toBeInstanceOf(CollectionNotFound);
    await expect(excludeGame(t.db, B, ids[A].only)).rejects.toBeInstanceOf(RoadmapNotFound);
    await expect(restoreGame(t.db, B, ids[A].only)).rejects.toBeInstanceOf(RoadmapNotFound);
    await expect(saveOrder(t.db, B, [ids[A].only])).rejects.toBeInstanceOf(UnknownGamesError);
    await expect(dislikeGame(t.db, B, aGame, NOW)).rejects.toBeInstanceOf(RecNotFound);
    await expect(undislikeGame(t.db, B, ids[A].only)).rejects.toBeInstanceOf(RecNotFound);
    await expect(updatePlanned(t.db, B, ids[A].planned, { hoursManual: 99 })).rejects.toBeInstanceOf(RoadmapNotFound);
    await expect(deletePlanned(t.db, B, ids[A].planned)).rejects.toBeInstanceOf(RoadmapNotFound);
    await expect(restoreStatuses(t.db, B, ids[A].backupId, NOW)).rejects.toBeInstanceOf(CollectionNotFound);
    expect(JSON.stringify([await listGames(t.db, A, q(), NOW), await buildBackup(t.db, A, NOW)])).toBe(before);
  });

  it('массовые операции B (сброс, настройки, порядок, внешние дизлайки) не трогают данные A', async () => {
    const before = JSON.stringify([await listGames(t.db, A, q(), NOW), await buildBackup(t.db, A, NOW), await getRoadmap(t.db, A, NOW), await listExternalDislikes(t.db, A, NOW), await listDislikes(t.db, A, NOW)]);
    await saveOrder(t.db, B, [ids[B].only]);
    await excludeGame(t.db, B, ids[B].only);
    const reset = await resetAllStatuses(t.db, B, NOW);
    expect(reset.reset).toBe(2);
    await putSettings(t.db, B, { year: 2027, hoursPerWeek: 3 });
    await undislikeExternal(t.db, B, '55');
    await undislikeGame(t.db, B, ids[B].only);
    await applyRestore(t.db, B, parseOk(await buildBackup(t.db, A, NOW)), NOW);
    // B получил собственные backup/статусы, A без изменений
    expect(JSON.stringify([await listGames(t.db, A, q(), NOW), await buildBackup(t.db, A, NOW), await getRoadmap(t.db, A, NOW), await listExternalDislikes(t.db, A, NOW), await listDislikes(t.db, A, NOW)])).toBe(before);
    expect((await getSettings(t.db, A, NOW)).hoursPerWeek).toBe(5);
    expect((await getLatestResetBackup(t.db, A)).latest?.id).toBe(ids[A].backupId);
    expect((await getLatestResetBackup(t.db, B)).latest?.id).not.toBe(ids[A].backupId);
  });

  it('копия A, восстановленная пользователем B, применяется только к играм B (по title_id) и не создаёт чужих игр', async () => {
    const file = parseOk(await buildBackup(t.db, A, NOW));
    const preview = await previewRestore(t.db, B, file);
    expect(preview.missing.map((x) => x.titleId)).toContain('ONLY_MARK_A'.replace('MARK_A', 'MARK_A'));
    await applyRestore(t.db, B, file, NOW);
    const bGames = await t.db.select({ id: games.id }).from(games).where(eq(games.userId, B));
    expect(bGames).toHaveLength(2);
    const planned = await t.db.select().from(plannedGames).where(eq(plannedGames.userId, B));
    expect(planned.every((p) => p.userId === B)).toBe(true);
    expect(await t.db.select().from(gameStatus).where(and(eq(gameStatus.userId, A), eq(gameStatus.status, 'completed')))).toHaveLength(1);
  });

  it('планируемые игры и ключи: один и тот же external_id у двоих разрешён, дубль внутри пользователя нет', async () => {
    await expect(createPlanned(t.db, B, { title: 'dup', releaseDate: null, coverUrl: null, wantAtRelease: false, hoursManual: null, externalSource: 'rawg', externalId: '777' })).rejects.toMatchObject({ existingId: expect.any(Number) });
    const created = await createPlanned(t.db, B, { title: 'new', releaseDate: null, coverUrl: null, wantAtRelease: false, hoursManual: null, externalSource: 'rawg', externalId: '888' });
    expect((await listPlanned(t.db, A, 'all')).map((p) => p.id)).not.toContain(created.id);
  });

  it('бюджет LLM считается на пользователя', async () => {
    expect(await reserveCall(t.db, A, 'phrases', 20, NOW)).toBe(true);
    expect(await reserveCall(t.db, A, 'phrases', 20, NOW)).toBe(true);
    expect(await usedToday(t.db, A, 'phrases', NOW)).toBe(2);
    expect(await usedToday(t.db, B, 'phrases', NOW)).toBe(0);
    expect(await reserveCall(t.db, B, 'phrases', 20, NOW)).toBe(true);
    expect(await usedToday(t.db, B, 'phrases', NOW)).toBe(1);
  });

  it('синк B с теми же title_id не трогает игры, трофеи и снимки A', async () => {
    const snapshotOfA = async () =>
      JSON.stringify([
        await t.db.select().from(games).where(eq(games.userId, A)),
        await t.db.select().from(trophySets).where(eq(trophySets.userId, A)),
        await t.db.select().from(trophies).where(eq(trophies.userId, A)),
        await t.db.select().from(playtimeSnapshots).where(eq(playtimeSnapshots.userId, A)),
        await t.db.select().from(psnProfile).where(eq(psnProfile.userId, A)),
      ]);
    const before = await snapshotOfA();
    // титулы фикстуры: у обоих пользователей могут быть те же title_id; убираем игры B и синкаем заново
    await t.db.delete(games).where(eq(games.userId, B));
    const state = freshState();
    const s = await startRun(t.db, B, { kind: 'manual', now: NOW });
    if (s.kind !== 'started') throw new Error(s.kind);
    expect(s.run.userId).toBe(B);
    const res = await runChunk(
      {
        db: t.db, now: () => NOW, budgetMs: 1_000_000,
        connect: () => connectPsn({ getAccessToken: async () => 'tok', onlineId: 'psnB', delayMs: 0, api: fakeApi(state), sleep: async () => undefined, now: () => NOW.getTime() }),
      },
      s.run,
    );
    expect(res.status).toBe('success');
    const bCount = (await t.db.select().from(games).where(eq(games.userId, B))).length;
    expect(bCount).toBeGreaterThan(0);
    expect(await t.db.select().from(trophySets).where(eq(trophySets.userId, B))).not.toHaveLength(0);
    expect((await t.db.select().from(psnProfile).where(eq(psnProfile.userId, B)))[0].onlineId).toBe('Target');
    expect(await snapshotOfA()).toBe(before);
    // sync_runs и статус: каждый видит только свои запуски
    expect((await getSyncStatus(t.db, B, NOW)).run?.id).toBe(s.run.id);
    expect((await getSyncStatus(t.db, A, NOW)).run?.id).not.toBe(s.run.id);
    expect((await getSyncStatus(t.db, A, NOW)).totals.games).toBe(2);
    // продолжение чужого запуска невозможно
    const cont = await startRun(t.db, A, { kind: 'manual', now: NOW, continueRunId: s.run.id });
    expect(cont.kind).toBe('not_resumable');
  });

  describe('роуты: B под своей сессией', () => {
    const req = (url: string, method = 'GET', body?: unknown) =>
      new Request(`http://x${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

    it('GET/PUT по чужому id = 404 not_found, не 403', async () => {
      testSession.userId = 2;
      testSession.role = 'member';
      const aGame = ids[A].same;
      expect((await gameGet(req('/'), params(aGame))).status).toBe(404);
      const st = await statusPut(req('/', 'PUT', { status: 'dropped' }), params(aGame));
      expect(st.status).toBe(404);
      expect((await st.json()).error.code).toBe('not_found');
      expect((await hiddenPut(req('/', 'PUT', { hidden: true }), params(aGame))).status).toBe(404);
      expect((await plannedPatch(req('/', 'PATCH', { hoursManual: 3 }), params(ids[A].planned))).status).toBe(404);
      expect((await plannedDelete(req('/', 'DELETE'), params(ids[A].planned))).status).toBe(404);
      expect((await restorePost(req('/', 'POST', { mode: 'preview', backup: 1 }))).status).toBe(400);
      // а свои работают
      expect((await gameGet(req('/'), params(ids[B].same))).status).toBe(200);
      expect((await statusPut(req('/', 'PUT', { status: 'playing' }), params(ids[B].same))).status).toBe(200);
      expect((await t.db.select().from(gameStatus).where(eq(gameStatus.gameId, aGame)))[0].status).toBe('completed');
    });

    it('списки и экспорт под сессией B не содержат данных A, под сессией A данных B', async () => {
      for (const [uid, role] of [[2, 'member'], [1, 'owner']] as const) {
        testSession.userId = uid;
        testSession.role = role;
        const bad = uid === 2 ? 'MARK_A' : 'MARK_B';
        const good = uid === 2 ? 'MARK_B' : 'MARK_A';
        const handlers: [string, () => Promise<Response>][] = [
          ['games', () => gamesGet(req('/api/games'))],
          ['summary', () => summaryGet(req('/'))],
          ['backup', () => backupGet(req('/'))],
          ['wrapped', () => wrappedGet(req('/api/wrapped?year=2026'))],
          ['stats', () => statsGet(req('/api/stats?year=2026'))],
          ['roadmap', () => roadmapGet(req('/'))],
          ['syncStatus', () => syncStatusGet(req('/'))],
          ['health', () => healthGet(req('/'))],
        ];
        for (const [name, call] of handlers) {
          const r = await call();
          expect(r.status, name).toBe(200);
          const text = await r.text();
          expect(text, `${name} (user ${uid}) утёк ${bad}`).not.toContain(bad);
          if (name === 'games' || name === 'backup') expect(text).toContain(good);
        }
        // health/sync: только свой запуск (gamesSeen A=11, B=22)
        const st = JSON.parse(await (await syncStatusGet(req('/'))).text()).data;
        expect(st.run.counters.gamesSeen).toBe(uid === 2 ? 22 : 11);
      }
    });
  });

  it('данные пользователя удаляются каскадом с allowed_users и не задевают других', async () => {
    await t.db.execute(sql.raw('delete from allowed_users where id = 2'));
    expect((await t.db.select().from(games).where(eq(games.userId, B)))).toHaveLength(0);
    expect((await t.db.select().from(games).where(eq(games.userId, A)))).toHaveLength(2);
    expect(await t.db.select().from(roadmapExcluded).where(eq(roadmapExcluded.userId, B))).toHaveLength(0);
    // вернуть пользователя 2 для остальных тестов
    await t.db.execute(sql.raw(`insert into allowed_users (id, email, role, status, psn_online_id) overriding system value values (2, 'b@example.com', 'member', 'active', 'psnB')`));
  });
});

function parseOk(file: unknown) {
  const p = parseBackup(JSON.parse(JSON.stringify(file)));
  if (!p.ok) throw new Error('backup не разобран');
  return p.value;
}

// asUserId экспортируется для явной проверки допустимых значений
it('asUserId отвергает неположительные и нецелые', () => {
  expect(() => asUserId(0)).toThrow();
  expect(() => asUserId(1.5)).toThrow();
  expect(asUserId(3)).toBe(3);
});
