// Контракт 16.7: массовый запуск HLTB (PGlite, фейковый клиент, управляемые часы).
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { HltbError, type HltbClient } from '@/server/hltb/client';
import type { HltbCandidate } from '@/server/hltb/normalize';
import { getSyncStatus } from './status';
import { runHltbMass } from './hltb-run';
import type { HltbDeps } from './hltb-step';
import { closeStaleRuns, startRun } from './runs';
import { HLTB_STALE_RUN_MS } from './hltb-slot';
import { createTestDb, type TestDb } from './test-helpers';
import { TEST_USER } from '@/server/sync/test-helpers';

const { games, gameStatus, syncRuns, hltbRuns } = schema;
const T0 = new Date('2026-10-28T10:00:00Z');
const cand = (id: number, name: string): HltbCandidate => ({ id, name, mainHours: 10, extraHours: null });

describe('runHltbMass', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  /** Часы двигаются на stepMs при каждом запросе и паузе. */
  function clock(stepMs: number) {
    let ms = T0.getTime();
    return { now: () => new Date(ms), tick: () => void (ms += stepMs) };
  }
  function mk(search: HltbClient['search'], c = clock(0), tickPerSearch = 0): { deps: HltbDeps; now: () => Date } {
    return {
      now: c.now,
      deps: {
        client: {
          search: async (term) => {
            for (let i = 0; i < tickPerSearch; i++) c.tick();
            return search(term);
          },
        },
        sleep: async () => undefined,
      },
    };
  }
  async function add(n: number, status: 'backlog' | 'completed' | 'service' = 'backlog') {
    for (let i = 0; i < n; i++) {
      const [g] = await t.db.insert(games).values({ userId: 1, titleId: `T${i}-${status}`, name: `Game ${i} ${status}`, category: 'ps5_native_game', lastSeenAt: T0 }).returning({ id: games.id });
      await t.db.insert(gameStatus).values({ userId: 1, gameId: g.id, status });
    }
  }
  const found: HltbClient['search'] = async (term) => [cand(Number(term.match(/\d+/)?.[0] ?? 1) + 1000, term)];

  it('обрабатывает все пачками, remaining=0, done=true, пишет hltb_runs (не sync_runs)', async () => {
    await add(25);
    await add(3, 'completed');
    await add(2, 'service');
    const { deps, now } = mk(found);
    const r = await runHltbMass({ userId: TEST_USER, db: t.db, deps, now, batch: 10 });
    expect(r.kind).toBe('done');
    if (r.kind !== 'done') return;
    // 20.1: completed берём тоже, service никогда
    expect(r.result).toMatchObject({ processed: 28, remaining: 0, done: true, stopReason: 'complete', failed: 0 });
    const runs = await t.db.select().from(hltbRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'success', gamesSeen: 28 });
    expect(runs[0].finishedAt).not.toBeNull();
    expect(await t.db.select().from(syncRuns)).toHaveLength(0);
  });

  it('бюджет времени: останавливается, remaining>0, done=false; следующий вызов дорабатывает', async () => {
    await add(10);
    // каждый запрос занимает 10 с; бюджет 30 с, на запрос нужно >= 9 с остатка
    const c = clock(10_000);
    const { deps, now } = mk(found, c, 1);
    const r1 = await runHltbMass({ userId: TEST_USER, db: t.db, deps, now, budgetMs: 30_000, batch: 4 });
    if (r1.kind !== 'done') throw new Error('x');
    expect(r1.result.done).toBe(false);
    expect(r1.result.stopReason).toBe('budget');
    expect(r1.result.processed).toBeGreaterThan(0);
    expect(r1.result.processed).toBeLessThan(10);
    expect(r1.result.remaining).toBe(10 - r1.result.processed);
  });

  it('идемпотентность: повтор после полного прохода ничего не делает', async () => {
    await add(5);
    const { deps, now } = mk(found);
    await runHltbMass({ userId: TEST_USER, db: t.db, deps, now });
    let calls = 0;
    const again = mk(async () => (calls++, []), undefined);
    const r = await runHltbMass({ userId: TEST_USER, db: t.db, deps: again.deps, now: again.now });
    if (r.kind !== 'done') throw new Error('x');
    expect(r.result).toMatchObject({ processed: 0, remaining: 0, done: true, stopReason: 'complete' });
    expect(calls).toBe(0);
  });

  it('п. 3: синк и HLTB-запуск не блокируют друг друга', async () => {
    await add(2);
    const s = await startRun(t.db, TEST_USER, { kind: 'manual', now: T0 });
    expect(s.kind).toBe('started');
    const { deps, now } = mk(found);
    const r = await runHltbMass({ userId: TEST_USER, db: t.db, deps, now });
    expect(r.kind).toBe('done');
    // и обратно: идущий HLTB-запуск не мешает синку (в т.ч. cron)
    await t.db.update(syncRuns).set({ status: 'success' }).where(eq(syncRuns.status, 'running'));
    await t.db.insert(hltbRuns).values({ userId: 1, status: 'running', startedAt: T0, heartbeatAt: T0 });
    expect((await startRun(t.db, TEST_USER, { kind: 'daily', now: T0 })).kind).toBe('started');
  });

  it('п. 3: второй HLTB-запуск при идущем отвергается (слот один на систему), id идущего в ответе', async () => {
    await add(2);
    const [live] = await t.db.insert(hltbRuns).values({ userId: 1, status: 'running', startedAt: T0, heartbeatAt: T0 }).returning();
    const { deps, now } = mk(found);
    const r = await runHltbMass({ userId: TEST_USER, db: t.db, deps, now });
    expect(r).toMatchObject({ kind: 'already_running', runId: live.id });
    expect(await t.db.select().from(hltbRuns)).toHaveLength(1);
  });

  it('п. 3: брошенный HLTB-запуск без heartbeat > 2 мин закрывается timeout, новый стартует', async () => {
    await add(2);
    await t.db.insert(hltbRuns).values({ userId: 1, status: 'running', startedAt: T0, heartbeatAt: T0 });
    const later = new Date(T0.getTime() + HLTB_STALE_RUN_MS + 1000);
    const { deps } = mk(found);
    const r = await runHltbMass({ userId: TEST_USER, db: t.db, deps, now: () => later });
    expect(r.kind).toBe('done');
    const rows = await t.db.select().from(hltbRuns).orderBy(hltbRuns.id);
    expect(rows.map((x) => [x.status, x.errorReason])).toEqual([['failed', 'timeout'], ['success', null]]);
  });

  it('совместимость: старая строка sync_runs kind=hltb (код до п. 3) закрывается синком по 2-минутному порогу', async () => {
    await t.db.insert(syncRuns).values({ userId: 1, kind: 'hltb', status: 'running', snapshotDate: '2026-10-28', startedAt: T0 });
    await closeStaleRuns(t.db, new Date(T0.getTime() + HLTB_STALE_RUN_MS + 1000));
    expect((await t.db.select().from(syncRuns))[0]).toMatchObject({ status: 'failed', errorReason: 'timeout' });
  });

  it('ошибка HLTB не роняет: 200-итог, failed, предупреждение, done=true, игры не помечены', async () => {
    await add(6);
    const { deps, now } = mk(async () => {
      throw new HltbError('unavailable', 'down');
    });
    const r = await runHltbMass({ userId: TEST_USER, db: t.db, deps, now });
    if (r.kind !== 'done') throw new Error('x');
    expect(r.result).toMatchObject({ processed: 0, failed: 3, remaining: 6, done: true, stopReason: 'errors' });
    expect(r.warnings.map((w) => w.code)).toContain('hltb_failed');
    expect((await t.db.select().from(hltbRuns))[0]).toMatchObject({ status: 'success' });
    expect((await t.db.select().from(games)).every((g) => g.hltbCheckedAt === null)).toBe(true);
  });

  it('пустая выдача на всё: hltb_empty, not_found не пишется, done=true (цикл фронта конечен)', async () => {
    await add(4);
    const { deps, now } = mk(async () => []);
    const r = await runHltbMass({ userId: TEST_USER, db: t.db, deps, now });
    if (r.kind !== 'done') throw new Error('x');
    expect(r.result).toMatchObject({ processed: 0, remaining: 4, done: true, stopReason: 'empty' });
    expect(r.warnings.map((w) => w.code)).toContain('hltb_empty');
  });

  it('индикация синка не видит запуски hltb', async () => {
    await add(2);
    const { deps, now } = mk(found);
    await runHltbMass({ userId: TEST_USER, db: t.db, deps, now });
    const st = await getSyncStatus(t.db, TEST_USER);
    expect(st.run).toBeNull();
    expect(st.lastSuccessAt ?? null).toBeNull();
  });

  it('recheckNotFound: берёт только прежние not_found до since, найденные и ручные не трогает', async () => {
    const old = new Date(T0.getTime() - 86400_000);
    const [nf] = await t.db.insert(games).values({ userId: 1, titleId: 'a', name: 'Gothic Classic', category: 'ps5_native_game', lastSeenAt: T0, hltbCheckedAt: old }).returning({ id: games.id });
    const [ok] = await t.db.insert(games).values({ userId: 1, titleId: 'b', name: 'Hades', category: 'ps5_native_game', lastSeenAt: T0, hltbCheckedAt: old, hltbId: 5, hltbMainHours: 20 }).returning({ id: games.id });
    const [man] = await t.db.insert(games).values({ userId: 1, titleId: 'c', name: 'Manual', category: 'ps5_native_game', lastSeenAt: T0, hltbCheckedAt: old, durationOverrideHours: 3 }).returning({ id: games.id });
    const asked: string[] = [];
    const { deps, now } = mk(async (term) => (asked.push(term), [cand(77, 'Gothic')]));
    const plain = await runHltbMass({ userId: TEST_USER, db: t.db, deps, now });
    if (plain.kind !== 'done') throw new Error('x');
    expect(plain.result.processed).toBe(0);
    const r = await runHltbMass({ userId: TEST_USER, db: t.db, deps, now, recheckBefore: T0 });
    if (r.kind !== 'done') throw new Error('x');
    expect(r.result).toMatchObject({ processed: 1, found: 1, remaining: 0, done: true });
    const rows = await t.db.select().from(games);
    expect(rows.find((g) => g.id === nf.id)).toMatchObject({ hltbId: 77, hltbName: 'Gothic' });
    expect(rows.find((g) => g.id === ok.id)).toMatchObject({ hltbId: 5, hltbMainHours: 20 });
    expect(rows.find((g) => g.id === man.id)?.hltbId).toBeNull();
    // повтор с тем же since: уже перепроверено, цикл конечен
    const again = await runHltbMass({ userId: TEST_USER, db: t.db, deps, now, recheckBefore: T0 });
    if (again.kind !== 'done') throw new Error('x');
    expect(again.result.processed).toBe(0);
  });
});
