// QA 20.3, п. 4: код 20.3 на схеме РОВНО после 0014 (старые PK/unique на месте, psn_profile.id и roadmap_settings.id default 1, owner id = 1).
// Это состояние прода между выкладкой кода и миграцией 0015. Ничего из схемы не отбрасывается (в отличие от user-isolation.test.ts).
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { parseBackup } from '@/server/backup/format';
import { buildBackup } from '@/server/backup/export';
import { applyRestore, previewRestore } from '@/server/backup/restore';
import { getCollectionSummary, listGames } from '@/server/collection/query';
import { parseListQuery } from '@/server/collection/validation';
import { resetAllStatuses, restoreStatuses } from '@/server/collection/mutations';
import { connectPsn } from '@/server/psn/client';
import { dislikeGame, getRecommendations } from '@/server/recommend/db';
import { reserveCall, usedToday } from '@/server/recommend/budget';
import { createPlanned, excludeGame, getRoadmap, putSettings, saveOrder, updatePlanned } from '@/server/roadmap/db';
import { setMonthExclusion } from '@/server/stats/exclusions';
import { getStats } from '@/server/stats/query';
import { getWrapped } from '@/server/wrapped/query';
import { runChunk } from '@/server/sync/engine';
import { startRun } from '@/server/sync/runs';
import { setGameStatus } from '@/server/sync/status-rules';
import { createTestDb, fakeApi, freshState, TEST_USER as U, type TestDb } from '@/server/sync/test-helpers';

const { games, gameStatus, playtimeSnapshots, trophies, trophySets, psnProfile, roadmapSettings, recommendLlmUsage, statusBackups } = schema;
const NOW = new Date('2026-10-27T10:00:00Z');

describe('20.3 на схеме после 0014 (до 0015), один пользователь owner id=1', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb({ migrations: 15 }); // схема ровно после 0014 (журнал: 15 записей)
  });
  afterAll(() => t.close());

  const sync = async (now: Date, kind: 'manual' | 'daily' = 'manual') => {
    const state = freshState();
    const s = await startRun(t.db, U, { kind, now });
    if (s.kind !== 'started') throw new Error('не стартовал');
    const res = await runChunk(
      { db: t.db, now: () => now, budgetMs: 1_000_000, connect: () => connectPsn({ getAccessToken: async () => 'tok', onlineId: 'Target', delayMs: 0, api: fakeApi(state), sleep: async () => undefined, now: () => now.getTime() }) },
      s.run,
    );
    return res;
  };

  it('схема действительно после 0014: старые ключи и default 1 на месте', async () => {
    const r = await t.pg.execute(sql`select indexname from pg_indexes where schemaname='public' and indexname in ('games_title_id_key','trophy_sets_np_communication_id_key','trophies_set_trophy_key','playtime_snapshots_game_date_key','planned_games_external_key')`);
    expect(r.rows).toHaveLength(5);
    const d = await t.pg.execute(sql`select table_name, column_default from information_schema.columns where table_schema='public' and column_name='id' and table_name in ('psn_profile','roadmap_settings')`);
    expect((d.rows as { column_default: string }[]).every((x) => x.column_default === '1')).toBe(true);
  });

  it('синк fixture дважды: идемпотентен, всё с user_id = 1, профиль пишется без id', async () => {
    expect((await sync(NOW)).status).toBe('success');
    const count = async () => ({
      g: (await t.db.select().from(games)).length,
      s: (await t.db.select().from(playtimeSnapshots)).length,
      tr: (await t.db.select().from(trophies)).length,
      ts: (await t.db.select().from(trophySets)).length,
    });
    const c1 = await count();
    expect(c1.g).toBeGreaterThan(0);
    expect((await sync(new Date(NOW.getTime() + 60_000))).status).toBe('success');
    expect(await count()).toEqual(c1);
    const prof = await t.db.select().from(psnProfile);
    expect(prof).toHaveLength(1);
    expect(prof[0].userId).toBe(1);
    expect((await t.db.select().from(games).where(sql`user_id <> 1`))).toHaveLength(0);
  });

  it('смена статуса, правила completed_at, сброс и откат', async () => {
    const [g] = await t.db.select().from(games).where(sql`last_played_at is not null`).limit(1);
    await setGameStatus(t.db, U, g.id, 'completed', NOW);
    const [st] = await t.db.select().from(gameStatus).where(eq(gameStatus.gameId, g.id));
    expect(st.userId).toBe(1);
    expect(st.completedAt?.toISOString()).toBe(g.lastPlayedAt?.toISOString());
    await setGameStatus(t.db, U, g.id, 'backlog', NOW);
    await setGameStatus(t.db, U, g.id, 'playing', NOW);
    const reset = await resetAllStatuses(t.db, U, NOW);
    expect(reset.reset).toBeGreaterThan(0);
    const back = await restoreStatuses(t.db, U, reset.backupId!, NOW);
    expect(back.restored).toBeGreaterThan(0);
    expect((await t.db.select().from(statusBackups).where(sql`user_id <> 1`))).toHaveLength(0);
  });

  it('план: настройки (upsert по user_id при PK id=1), planned, порядок, исключение', async () => {
    await putSettings(t.db, U, { year: 2026, hoursPerWeek: 7 });
    await putSettings(t.db, U, { year: 2026, hoursPerWeek: 9 }); // повтор = update, не падает на PK id=1
    const rows = await t.db.select().from(roadmapSettings);
    expect(rows).toHaveLength(1);
    expect(rows[0].hoursPerWeek).toBe(9);
    const p = await createPlanned(t.db, U, { title: 'P', releaseDate: '2027-01-01', coverUrl: null, wantAtRelease: false, hoursManual: 5, externalSource: 'rawg', externalId: '1' });
    await expect(createPlanned(t.db, U, { title: 'P', releaseDate: '2027-01-01', coverUrl: null, wantAtRelease: false, hoursManual: 5, externalSource: 'rawg', externalId: '1' })).rejects.toThrow();
    await updatePlanned(t.db, U, p.id, { hoursManual: 6 });
    const list = await t.db.select().from(games).limit(3);
    for (const g of list) await setGameStatus(t.db, U, g.id, 'backlog', NOW);
    await saveOrder(t.db, U, [list[1].id, list[0].id]);
    await saveOrder(t.db, U, [list[0].id, list[1].id]);
    await excludeGame(t.db, U, list[2].id);
    const rm = await getRoadmap(t.db, U, NOW);
    expect(rm.settings.hoursPerWeek).toBe(9);
  });

  it('«Подскажи»: рекомендации, дизлайки, кэш фраз, счётчик LLM (upsert по (user_id, day) при старом PK day)', async () => {
    const rec = await getRecommendations(t.db, U, 'any', NOW, { llm: null });
    expect(rec.meta.candidates).toBeGreaterThan(0);
    const [any] = await t.db.select().from(games).limit(1);
    await dislikeGame(t.db, U, any.id, NOW);
    await dislikeGame(t.db, U, any.id, NOW);
    expect(await reserveCall(t.db, U, 'phrases', 10, NOW)).toBe(true);
    expect(await reserveCall(t.db, U, 'phrases', 10, NOW)).toBe(true);
    expect(await usedToday(t.db, U, 'phrases', NOW)).toBe(2);
    expect((await t.db.select().from(recommendLlmUsage))).toHaveLength(1);
  });

  it('статистика, Итоги, коллекция, исключение месяца работают', async () => {
    const [g] = await t.db.select().from(games).limit(1);
    await setMonthExclusion(t.db, U, g.id, '2026-02', true);
    const st = await getStats(t.db, U, { type: 'year', year: 2026, month: null }, NOW);
    expect(st.header).toBeDefined();
    expect(await getWrapped(t.db, U, 2026, null, NOW)).toBeDefined();
    const q = parseListQuery(new URLSearchParams());
    if (!q.ok) throw new Error(q.message);
    expect((await listGames(t.db, U, q.value, NOW)).total).toBeGreaterThan(0);
    expect((await getCollectionSummary(t.db, U)).totals.games).toBeGreaterThan(0);
  });

  it('экспорт -> JSON -> предпросмотр -> восстановление в ту же БД без падений на PK/unique', async () => {
    const file = await buildBackup(t.db, U, NOW);
    const parsed = parseBackup(JSON.parse(JSON.stringify(file)));
    if (!parsed.ok) throw new Error('экспорт не парсится обратно');
    const pre = await previewRestore(t.db, U, parsed.value);
    expect(pre).toBeDefined();
    const first = await applyRestore(t.db, U, parsed.value, NOW);
    const second = await applyRestore(t.db, U, parsed.value, NOW);
    expect(second).toBeDefined();
    expect(first).toBeDefined();
    expect(JSON.stringify(await buildBackup(t.db, U, NOW)).replace(/"createdAt":"[^"]*"/, '')).toBe(JSON.stringify(file).replace(/"createdAt":"[^"]*"/, ''));
  });
});
