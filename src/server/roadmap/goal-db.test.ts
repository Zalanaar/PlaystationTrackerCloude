// Фаза 32 на PGlite: остаток часов в плане и «Подскажи», цель года (17.3a), изоляция по пользователю.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { buildDuration } from '@/server/collection/duration';
import { loadCandidates } from '@/server/recommend/db';
import { createTestDb, type TestDb, TEST_USER, TEST_USER_2 } from '@/server/sync/test-helpers';
import { clearGoal, getBacklogEntries, getGoal, getRoadmap, getUnallocated, putGoal, putSettings, SettingsRequiredError, excludeGame } from './db';
import { parseGoalBody } from './validation';

const { games, gameStatus, allowedUsers } = schema;
const NOW = new Date('2026-07-01T09:00:00Z');
const H = 3600;

describe('Фаза 32: остаток часов и цель года (БД)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    await t.db.insert(allowedUsers).values({ email: 'u2@example.com', role: 'member', status: 'active' }).onConflictDoNothing();
  });

  const base = { category: 'ps5_native_game', lastSeenAt: NOW };
  async function game(userId: number, titleId: string, o: Partial<typeof games.$inferInsert> = {}) {
    const [g] = await t.db.insert(games).values({ userId, titleId, name: titleId, ...base, ...o }).returning({ id: games.id });
    return g.id;
  }
  const status = (userId: number, gameId: number, s: 'backlog' | 'completed' | 'playing', completedAt?: Date) =>
    t.db.insert(gameStatus).values({ userId, gameId, status: s, ...(completedAt ? { completedAt } : {}) });

  it('очередь плана: hours = остаток, totalHours = база, ручная оценка приоритетнее HLTB', async () => {
    const a = await game(1, 'A', { hltbMainHours: 20, playDurationSeconds: 5 * H });
    const b = await game(1, 'B', { hltbMainHours: 40, durationOverrideHours: 10, playDurationSeconds: 3 * H });
    const c = await game(1, 'C', { hltbMainHours: 10, playDurationSeconds: 30 * H });
    const d = await game(1, 'D');
    for (const id of [a, b, c, d]) await status(1, id, 'backlog');
    const q = await getBacklogEntries(t.db, TEST_USER);
    const by = Object.fromEntries(q.map((e) => [e.title, e]));
    expect([by.A.hours, by.A.totalHours, by.A.playedHours, by.A.hoursSource]).toEqual([15, 20, 5, 'hltb']);
    expect([by.B.hours, by.B.totalHours, by.B.hoursSource]).toEqual([7, 10, 'manual']);
    expect([by.C.hours, by.C.totalHours]).toEqual([1.5, 10]); // пол 15%
    expect([by.D.hours, by.D.totalHours, by.D.hoursSource]).toEqual([null, null, null]);
  });

  it('исключённая игра в unallocated тоже с остатком', async () => {
    const a = await game(1, 'A', { hltbMainHours: 20, playDurationSeconds: 10 * H });
    await status(1, a, 'backlog');
    await excludeGame(t.db, TEST_USER, a);
    const u = await getUnallocated(t.db, TEST_USER);
    expect(u[0]).toMatchObject({ hours: 10, totalHours: 20, playedHours: 10 });
  });

  it('GET roadmap: план использует остаток, а не полную длительность', async () => {
    const a = await game(1, 'A', { hltbMainHours: 20, playDurationSeconds: 10 * H });
    await status(1, a, 'backlog');
    await putSettings(t.db, TEST_USER, { year: 2026, hoursPerWeek: 10 });
    const r = await getRoadmap(t.db, TEST_USER, NOW);
    expect(r.items[0]).toMatchObject({ hours: 10, totalHours: 20 });
    expect(r.totals.plannedHours).toBe(10);
    expect(r.goal).toBeNull();
  });

  it('«Подскажи»: кандидат несёт остаток в hours и базу в totalHours', async () => {
    const a = await game(1, 'A', { hltbMainHours: 20, playDurationSeconds: 5 * H });
    await status(1, a, 'backlog');
    const [c] = await loadCandidates(t.db, TEST_USER);
    expect(c).toMatchObject({ hours: 15, totalHours: 20, hoursSource: 'hltb' });
  });

  it('карточка бэклога: duration.remainingHours и progress; hours остаётся полной длительностью', () => {
    const d = buildDuration({ durationOverrideHours: null, hltbMainHours: 20, hltbId: 1, playSeconds: 5 * H });
    expect(d).toMatchObject({ hours: 20, remainingHours: 15, progress: 0.25 });
    expect(buildDuration({ playSeconds: 5 * H })).toMatchObject({ hours: null, remainingHours: null, progress: null });
    expect(buildDuration({ hltbMainHours: 10, playSeconds: 99 * H })).toMatchObject({ remainingHours: 1.5, progress: 0.85 });
  });

  describe('цель года', () => {
    it('нет настроек: getGoal null, putGoal = SettingsRequiredError', async () => {
      expect(await getGoal(t.db, TEST_USER, NOW)).toBeNull();
      await expect(putGoal(t.db, TEST_USER, { mode: 'complete', count: 5 }, NOW)).rejects.toBeInstanceOf(SettingsRequiredError);
    });

    it('complete: считает завершения по completed_at (МСК) в году, чужие и вне года не считает', async () => {
      await putSettings(t.db, TEST_USER, { year: 2026, hoursPerWeek: 10 });
      const mk = async (user: number, title: string, at: Date) => status(user, await game(user, title), 'completed', at);
      await mk(1, 'in1', new Date('2026-03-10T12:00:00Z'));
      await mk(1, 'in2', new Date('2026-06-10T12:00:00Z'));
      await mk(1, 'ny-edge', new Date('2025-12-31T21:30:00Z')); // 00:30 1 января МСК: в 2026
      await mk(1, 'old-edge', new Date('2025-12-31T20:30:00Z')); // 23:30 31 декабря МСК: в 2025
      await mk(1, 'next', new Date('2027-01-01T10:00:00Z'));
      await mk(2, 'other-user', new Date('2026-03-10T12:00:00Z'));
      const g = await putGoal(t.db, TEST_USER, { mode: 'complete', count: 10 }, NOW);
      expect(g).toMatchObject({ mode: 'complete', count: 10, current: 3, remaining: 7, paceEmpty: false, asOf: '2026-07-01' });
      expect(await getGoal(t.db, TEST_USER_2, NOW)).toBeNull();
    });

    it('скрытая игра не считается; backlog_to считает бэклог пользователя', async () => {
      await putSettings(t.db, TEST_USER, { year: 2026, hoursPerWeek: 10 });
      await status(1, await game(1, 'b1'), 'backlog');
      await status(1, await game(1, 'b2'), 'backlog');
      await status(1, await game(1, 'bh', { hiddenAt: NOW }), 'backlog');
      await status(1, await game(1, 'dh', { hiddenAt: NOW }), 'completed', new Date('2026-02-01T10:00:00Z'));
      await status(2, await game(2, 'b3'), 'backlog');
      const g = await putGoal(t.db, TEST_USER, { mode: 'backlog_to', count: 1 }, NOW);
      expect(g).toMatchObject({ current: 2, remaining: 1, paceEmpty: true, forecast: 2 });
    });

    it('PUT settings цель не сбрасывает; DELETE снимает; идемпотентно; GET roadmap отдаёт goal', async () => {
      await putSettings(t.db, TEST_USER, { year: 2026, hoursPerWeek: 10 });
      await putGoal(t.db, TEST_USER, { mode: 'complete', count: 4 }, NOW);
      await putSettings(t.db, TEST_USER, { year: 2026, hoursPerWeek: 5 });
      expect((await getRoadmap(t.db, TEST_USER, NOW)).goal).toMatchObject({ mode: 'complete', count: 4 });
      expect(await getGoal(t.db, TEST_USER_2, NOW)).toBeNull();
      await clearGoal(t.db, TEST_USER);
      await clearGoal(t.db, TEST_USER);
      expect(await getGoal(t.db, TEST_USER, NOW)).toBeNull();
      expect((await getRoadmap(t.db, TEST_USER, NOW)).goal).toBeNull();
    });

    it('цель у одного пользователя не затрагивает второго', async () => {
      await putSettings(t.db, TEST_USER, { year: 2026, hoursPerWeek: 10 });
      await putSettings(t.db, TEST_USER_2, { year: 2026, hoursPerWeek: 10 });
      await putGoal(t.db, TEST_USER, { mode: 'complete', count: 4 }, NOW);
      expect(await getGoal(t.db, TEST_USER_2, NOW)).toBeNull();
      await clearGoal(t.db, TEST_USER_2);
      expect(await getGoal(t.db, TEST_USER, NOW)).not.toBeNull();
    });

    it('цель считается и без валидного бюджета (status plan no_budget не влияет)', async () => {
      await putSettings(t.db, TEST_USER, { year: 2026, hoursPerWeek: 10 });
      await putGoal(t.db, TEST_USER, { mode: 'complete', count: 4 }, NOW);
      const r = await getRoadmap(t.db, TEST_USER, NOW);
      expect(r.status).toBe('ok');
      expect(r.goal?.status).toBe('behind');
    });
  });

  describe('parseGoalBody', () => {
    it('валидные и невалидные тела', () => {
      expect(parseGoalBody({ mode: 'complete', count: 12 })).toEqual({ ok: true, value: { mode: 'complete', count: 12 } });
      expect(parseGoalBody({ mode: 'backlog_to', count: 0 }).ok).toBe(true);
      const bads: unknown[] = [{}, { mode: 'complete' }, { mode: 'complete', count: 0 }, { mode: 'x', count: 3 }, { mode: 'complete', count: 1.5 }, { mode: 'complete', count: -1 },
        { mode: 'complete', count: 1001 }, { mode: 'complete', count: '3' }, { mode: 'complete', count: 3, extra: 1 }, [], null];
      for (const b of bads) expect(parseGoalBody(b).ok, JSON.stringify(b)).toBe(false);
    });
  });
});
