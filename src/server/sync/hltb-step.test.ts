// Фаза 11: шаг HLTB в синке (PGlite, фейковый клиент HLTB). Ошибка HLTB не роняет синк.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { HltbError, type HltbClient } from '@/server/hltb/client';
import type { HltbCandidate } from '@/server/hltb/normalize';
import { connectPsn } from '@/server/psn/client';
import { RunContext } from './context';
import { runChunk, type SyncDeps } from './engine';
import { HLTB_BATCH, HLTB_RECHECK_MS, hltbStep, type HltbDeps } from './hltb-step';
import { startRun } from './runs';
import { createTestDb, fakeApi, freshState, type TestDb } from './test-helpers';
import { TEST_USER } from '@/server/sync/test-helpers';

const { games, gameStatus, syncRuns } = schema;
const NOW = new Date('2026-10-28T10:00:00Z');
const deps = (search: HltbClient['search']): HltbDeps => ({ client: { search }, sleep: async () => undefined });
const cand = (id: number, name: string, main: number | null): HltbCandidate => ({ id, name, mainHours: main, extraHours: null });

describe('hltbStep', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function ctx(budget = 1_000_000) {
    await t.db.update(syncRuns).set({ status: 'success' }).where(eq(syncRuns.status, 'running'));
    const s = await startRun(t.db, TEST_USER, { kind: 'manual', now: NOW });
    if (s.kind !== 'started') throw new Error(s.kind);
    return new RunContext(t.db, s.run, () => NOW, budget);
  }
  async function add(name: string, o: Partial<typeof games.$inferInsert> = {}, status?: 'backlog' | 'completed' | 'service' | 'playing' | 'dropped' | 'shelved') {
    const [g] = await t.db
      .insert(games)
      .values({ titleId: `T-${name}`, name, category: 'ps5_native_game', lastSeenAt: NOW, ...o })
      .returning({ id: games.id });
    if (status) await t.db.insert(gameStatus).values({ gameId: g.id, status: status });
    return g.id;
  }
  const row = async (id: number) => (await t.db.select().from(games).where(eq(games.id, id)))[0];

  it('находит и сохраняет, нет совпадения = not_found с checked_at', async () => {
    const a = await add('Hades', {}, 'backlog');
    const b = await add('Совсем Неизвестная Игра', {}, 'backlog');
    const search: HltbClient['search'] = async (term) => (term.includes('hades') ? [cand(2127, 'Hades', 21.9)] : []);
    const c = await ctx();
    const r = await hltbStep(c, deps(search));
    expect(r).toMatchObject({ checked: 2, found: 1, failed: 0 });
    expect(await row(a)).toMatchObject({ hltbId: 2127, hltbName: 'Hades', hltbMainHours: 21.9, hltbCheckedAt: NOW });
    expect(await row(b)).toMatchObject({ hltbId: null, hltbMainHours: null, hltbCheckedAt: NOW });
  });

  it('кого пропускаем: service, скрытые, с ручной длительностью, свежепроверенные (completed/dropped берём, 20.1)', async () => {
    const asked: string[] = [];
    await add('Done', {}, 'completed');
    await add('Quit', {}, 'dropped');
    await add('Svc', {}, 'service');
    await add('Hidden', { hiddenAt: NOW }, 'backlog');
    await add('Manual', { durationOverrideHours: 5 }, 'backlog');
    await add('Fresh', { hltbCheckedAt: new Date(NOW.getTime() - HLTB_RECHECK_MS + 86400_000) }, 'backlog');
    await add('Stale', { hltbCheckedAt: new Date(NOW.getTime() - HLTB_RECHECK_MS - 1000) }, 'backlog');
    await add('NoStatus');
    await hltbStep(await ctx(), deps(async (term) => (asked.push(term), [])));
    expect(asked.sort()).toEqual(['done', 'nostatus', 'quit', 'stale']);
  });

  it('порядок: backlog, playing, shelved, без статуса, completed, dropped', async () => {
    await add('Z-drop', {}, 'dropped');
    await add('Y-done', {}, 'completed');
    await add('X-none');
    await add('W-shelf', {}, 'shelved');
    await add('V-play', {}, 'playing');
    await add('U-back', {}, 'backlog');
    const asked: string[] = [];
    await hltbStep(await ctx(), deps(async (term) => (asked.push(term), [cand(1, term, 5)])));
    expect(asked).toEqual(['u back', 'v play', 'w shelf', 'x none', 'y done', 'z drop']);
  });

  it('порядок: backlog раньше игр без статуса; пачка ограничена', async () => {
    for (let i = 0; i < HLTB_BATCH + 5; i++) await add(`NoSt${i}`);
    await add('Bk', {}, 'backlog');
    const asked: string[] = [];
    await hltbStep(await ctx(), deps(async (term) => (asked.push(term), [cand(1, term, 5)])));
    expect(asked[0]).toBe('bk');
    expect(asked).toHaveLength(HLTB_BATCH);
  });

  it('ошибка HLTB: игра не помечается проверенной, 3 ошибки подряд останавливают шаг, предупреждение', async () => {
    for (let i = 0; i < 6; i++) await add(`G${i}`, {}, 'backlog');
    let calls = 0;
    const c = await ctx();
    const r = await hltbStep(c, deps(async () => {
      calls++;
      throw new HltbError('blocked', 'HLTB: HTTP 403');
    }));
    expect(calls).toBe(3);
    expect(r).toMatchObject({ checked: 0, failed: 3 });
    expect((await t.db.select().from(games)).every((g) => g.hltbCheckedAt === null)).toBe(true);
    expect(c.warnings.map((w) => w.code)).toContain('hltb_failed');
    expect(JSON.stringify(c.warnings)).not.toMatch(/Bearer|token/i);
  });

  it('пустая выдача на всё подряд = подозрение на поломку: ничего не пишем', async () => {
    for (let i = 0; i < 6; i++) await add(`G${i}`, {}, 'backlog');
    const c = await ctx();
    await hltbStep(c, deps(async () => []));
    expect((await t.db.select().from(games)).every((g) => g.hltbCheckedAt === null)).toBe(true);
    expect(c.warnings.map((w) => w.code)).toContain('hltb_empty');
  });

  it.each([1, 4])('малая партия (%i игр), все выдачи пустые: not_found не пишется, hltb_empty', async (n) => {
    for (let i = 0; i < n; i++) await add(`Small${i}`, {}, 'backlog');
    const c = await ctx();
    const r = await hltbStep(c, deps(async () => []));
    expect(r).toMatchObject({ checked: 0, found: 0 });
    expect((await t.db.select().from(games)).every((g) => g.hltbCheckedAt === null)).toBe(true);
    expect(c.warnings.map((w) => w.code)).toContain('hltb_empty');
  });

  it('малая партия, но есть один нормальный ответ: пустые выдачи фиксируются как not_found', async () => {
    const a = await add('Hades', {}, 'backlog');
    const b = await add('Совсем Неизвестная Игра', {}, 'backlog');
    const c = await ctx();
    await hltbStep(c, deps(async (term) => (term.includes('hades') ? [cand(2127, 'Hades', 21.9)] : [])));
    expect((await row(a)).hltbId).toBe(2127);
    expect(await row(b)).toMatchObject({ hltbId: null, hltbCheckedAt: NOW });
    expect(c.warnings.map((w) => w.code)).not.toContain('hltb_empty');
  });

  it('раньше находили, теперь нет: данные не стираются', async () => {
    const id = await add('Hades', { hltbId: 5, hltbName: 'Hades', hltbMainHours: 20, hltbCheckedAt: new Date(NOW.getTime() - HLTB_RECHECK_MS - 1) }, 'backlog');
    await add('Other', {}, 'backlog');
    await hltbStep(await ctx(), deps(async (term) => (term === 'hades' ? [] : [cand(9, 'Other', 3)])));
    expect(await row(id)).toMatchObject({ hltbId: 5, hltbMainHours: 20, hltbCheckedAt: NOW });
  });

  it('HLTB не вернул время при том же id: прежние часы сохраняются; другой id: сбрасываются', async () => {
    const id = await add('Hades', { hltbId: 5, hltbMainHours: 20, hltbExtraHours: 30, hltbCheckedAt: new Date(NOW.getTime() - HLTB_RECHECK_MS - 1) }, 'backlog');
    await hltbStep(await ctx(), deps(async () => [cand(5, 'Hades', null)]));
    expect(await row(id)).toMatchObject({ hltbId: 5, hltbMainHours: 20, hltbExtraHours: 30 });
    await t.db.update(games).set({ hltbCheckedAt: null }).where(eq(games.id, id));
    await hltbStep(await ctx(), deps(async () => [cand(6, 'Hades', null)]));
    expect(await row(id)).toMatchObject({ hltbId: 6, hltbMainHours: null });
  });

  it('мало времени в бюджете: шаг не начинается', async () => {
    await add('Hades', {}, 'backlog');
    let calls = 0;
    const r = await hltbStep(await ctx(100), deps(async () => (calls++, [])));
    expect(calls).toBe(0);
    expect(r.checked).toBe(0);
  });
});

describe('синк с HLTB-шагом', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  const run = async (hltb: HltbDeps) => {
    const state = freshState();
    state.pageSize = 200;
    const deps: SyncDeps = {
      db: t.db,
      now: () => NOW,
      budgetMs: 1_000_000,
      hltb,
      connect: () => connectPsn({ getAccessToken: async () => 't', onlineId: 'Target', delayMs: 0, api: fakeApi(state), sleep: async () => undefined, now: () => NOW.getTime() }),
    };
    for (let i = 0; i < 10; i++) {
      const s = await startRun(t.db, TEST_USER, { kind: 'manual', now: NOW });
      if (s.kind !== 'started') throw new Error(s.kind);
      const res = await runChunk(deps, s.run);
      if (!res.continueNext) return { res, runId: s.run.id };
    }
    throw new Error('цепочка не закончилась');
  };

  it('HLTB недоступен: синк success, данные игр на месте, предупреждение в sync_runs', async () => {
    const { res, runId } = await run(deps(async () => {
      throw new HltbError('unavailable', `HLTB: не найден рабочий эндпоинт: init /api/find/init: 404; ${'x'.repeat(500)}`);
    }));
    expect(res.status).toBe('success');
    const [r] = await t.db.select().from(syncRuns).where(eq(syncRuns.id, runId));
    expect(r.status).toBe('success');
    const w = (r.warnings as { code: string; message: string }[]).find((x) => x.code === 'hltb_failed');
    expect(w?.message).toContain('init /api/find/init: 404');
    expect(w?.message.length).toBeLessThan(450);
    expect((await t.db.select().from(games)).length).toBeGreaterThan(0);
  });

  it('HLTB бросает неожиданное исключение: всё равно success', async () => {
    const { res } = await run(deps(async () => {
      throw new Error('boom');
    }));
    expect(res.status).toBe('success');
  });

  it('HLTB работает: часы появляются у игр без статуса', async () => {
    const { res } = await run(deps(async (term) => [cand(1, term, 12)]));
    expect(res.status).toBe('success');
    const withHours = (await t.db.select().from(games)).filter((g) => g.hltbMainHours === 12);
    expect(withHours.length).toBeGreaterThan(0);
    expect(withHours.length).toBeLessThanOrEqual(HLTB_BATCH);
  });

  it('повторный синк идемпотентен: проверенные игры не запрашиваются снова', async () => {
    let calls = 0;
    const d = deps(async (term) => (calls++, [cand(1, term, 12)]));
    await run(d);
    const first = calls;
    await run(d);
    const total = (await t.db.select().from(games)).length;
    // второй синк добирает только остаток, не повторяя первых
    expect(calls).toBeLessThanOrEqual(Math.min(total, 2 * HLTB_BATCH));
    expect(calls - first).toBeLessThanOrEqual(HLTB_BATCH);
  });
});
