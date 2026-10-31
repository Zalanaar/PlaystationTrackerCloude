// Фаза 20.3, миграция 0015: код на схеме ПОСЛЕ 0015 (createTestDb применяет все миграции).
// Синк двух пользователей с одними и теми же title_id/np_communication_id: у каждого свои строки, повторный синк идемпотентен,
// ON CONFLICT целится в существующие ключи, чужие данные не затрагиваются.
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { connectPsn } from '@/server/psn/client';
import { runChunk } from '@/server/sync/engine';
import { startRun } from '@/server/sync/runs';
import { createTestDb, fakeApi, freshState, TEST_USER as A, TEST_USER_2 as B, type TestDb } from '@/server/sync/test-helpers';
import type { UserId } from '@/server/auth/user-id';

const { games, playtimeSnapshots, trophies, trophySets, gameTrophySets, psnProfile, roadmapSettings, recommendReasons, recommendLlmUsage, syncRuns } = schema;
const NOW = new Date('2026-10-27T10:00:00Z');

describe('схема после 0015: синк двух пользователей с общими title_id', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.pg.execute(sql.raw(`insert into allowed_users (email, role, status, psn_online_id) values ('b@example.com', 'member', 'active', 'psnB')`));
  });
  afterAll(() => t.close());

  const sync = async (u: UserId, now: Date) => {
    const state = freshState();
    const s = await startRun(t.db, u, { kind: 'manual', now });
    if (s.kind !== 'started') throw new Error('не стартовал');
    return runChunk(
      { db: t.db, now: () => now, budgetMs: 1_000_000, connect: () => connectPsn({ getAccessToken: async () => 'tok', onlineId: 'Target', delayMs: 0, api: fakeApi(state), sleep: async () => undefined, now: () => now.getTime() }) },
      s.run,
    );
  };
  const counts = async (u: UserId) => ({
    g: (await t.db.select().from(games).where(eq(games.userId, u))).length,
    s: (await t.db.select().from(playtimeSnapshots).where(eq(playtimeSnapshots.userId, u))).length,
    ts: (await t.db.select().from(trophySets).where(eq(trophySets.userId, u))).length,
    tr: (await t.db.select().from(trophies).where(eq(trophies.userId, u))).length,
    l: (await t.db.select().from(gameTrophySets).where(eq(gameTrophySets.userId, u))).length,
  });

  it('два пользователя получают одинаковые наборы со своими строками; повторный синк не меняет счётчики', async () => {
    expect((await sync(A, NOW)).status).toBe('success');
    expect((await sync(B, new Date(NOW.getTime() + 60_000))).status).toBe('success');
    const a = await counts(A);
    const b = await counts(B);
    expect(a.g).toBeGreaterThan(0);
    expect(b).toEqual(a);
    const ta = (await t.db.select({ id: games.titleId }).from(games).where(eq(games.userId, A))).map((x) => x.id).sort();
    const tb = (await t.db.select({ id: games.titleId }).from(games).where(eq(games.userId, B))).map((x) => x.id).sort();
    expect(tb).toEqual(ta);
    // id игр не пересекаются, связи трофейных сетов не перекрёстные
    const cross = await t.pg.execute(sql`select count(*)::int as n from game_trophy_sets l join games g on g.id = l.game_id where g.user_id <> l.user_id`);
    expect((cross.rows[0] as { n: number }).n).toBe(0);
    // у каждого свой профиль PSN (PK user_id)
    const prof = await t.db.select().from(psnProfile);
    expect(prof.map((p) => p.userId).sort()).toEqual([A, B]);

    expect((await sync(A, new Date(NOW.getTime() + 120_000))).status).toBe('success');
    expect((await sync(B, new Date(NOW.getTime() + 180_000))).status).toBe('success');
    expect(await counts(A)).toEqual(a);
    expect(await counts(B)).toEqual(b);
    expect((await t.db.select().from(psnProfile))).toHaveLength(2);
    const runs = await t.db.select().from(syncRuns);
    expect(runs.filter((r) => r.userId === A)).toHaveLength(2);
    expect(runs.filter((r) => r.userId === B)).toHaveLength(2);
  });

  it('настройки плана, счётчик LLM и кэш фраз: по строке на пользователя, upsert не перезаписывает чужое', async () => {
    const { putSettings } = await import('@/server/roadmap/db');
    const { writeCachedReasons } = await import('@/server/recommend/db');
    await putSettings(t.db, A, { year: 2026, hoursPerWeek: 5 });
    await putSettings(t.db, B, { year: 2026, hoursPerWeek: 9 });
    await putSettings(t.db, A, { year: 2026, hoursPerWeek: 6 });
    const rs = await t.db.select().from(roadmapSettings);
    expect(rs.map((r) => [r.userId, r.hoursPerWeek]).sort()).toEqual([[A, 6], [B, 9]]);

    // счётчик LLM: ключ (user_id, day), upsert по нему не склеивает пользователей
    for (const [u, calls] of [[A, 1], [B, 2], [A, 3]] as const) {
      await t.db
        .insert(recommendLlmUsage)
        .values({ userId: u, day: '2026-10-27', calls })
        .onConflictDoUpdate({ target: [recommendLlmUsage.userId, recommendLlmUsage.day], set: { calls } });
    }
    expect((await t.db.select().from(recommendLlmUsage)).map((r) => [r.userId, r.calls]).sort()).toEqual([[A, 3], [B, 2]]);

    const [ga] = await t.db.select().from(games).where(eq(games.userId, A)).limit(1);
    const [gb] = await t.db.select().from(games).where(eq(games.userId, B)).limit(1);
    const item = (id: number) => ({ game: { id, name: 'G', genres: [], hours: null }, signals: [] }) as never;
    await writeCachedReasons(t.db, A, [item(ga.id)], new Map([[ga.id, 'для A']]), NOW);
    await writeCachedReasons(t.db, B, [item(gb.id)], new Map([[gb.id, 'для B']]), NOW);
    const rows = await t.db.select().from(recommendReasons);
    expect(rows.map((r) => [r.userId, r.gameId, r.text]).sort()).toEqual([[A, ga.id, 'для A'], [B, gb.id, 'для B']]);
    // повторная запись того же хэша обновляет текст (ON CONFLICT по (user_id, game_id, signals_hash))
    await writeCachedReasons(t.db, A, [item(ga.id)], new Map([[ga.id, 'для A v2']]), NOW);
    const again = await t.db.select().from(recommendReasons).where(eq(recommendReasons.userId, A));
    expect(again.map((r) => r.text)).toEqual(['для A v2']);
  });
});
