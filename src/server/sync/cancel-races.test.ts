// Фаза 32.1 (QA): гонки отмены и перезапуска, не покрытые тестами backend.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { connectPsn } from '@/server/psn/client';
import type { PsnApi } from '@/server/psn/client';
import { runChunk, type SyncDeps } from './engine';
import { cancelRun, restartRun, startRun } from './runs';
import { createTestDb, fakeApi, freshState, TEST_USER, type FakeState, type TestDb } from './test-helpers';

const { syncRuns, games, trophies } = schema;
const T0 = new Date('2026-10-27T17:00:00Z');

describe('QA-32.1: гонки', () => {
  let t: TestDb;
  let state: FakeState;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => { await t.reset(); state = freshState(); });

  const deps = (hook?: (n: number) => Promise<void>, budgetMs = 1_000_000): SyncDeps => {
    const base = fakeApi(state);
    let n = 0;
    const api = { ...base, getUserTrophiesEarnedForTitle: async (...a: Parameters<PsnApi['getUserTrophiesEarnedForTitle']>) => { n++; await hook?.(n); return base.getUserTrophiesEarnedForTitle(...a); } } as PsnApi;
    return { db: t.db, now: () => T0, budgetMs, connect: () => connectPsn({ getAccessToken: async () => 't', onlineId: 'Target', delayMs: 0, api, sleep: async () => undefined, now: () => T0.getTime() }) };
  };
  const row = async (id: number) => (await t.db.select().from(syncRuns).where(eq(syncRuns.id, id)))[0];

  it('restart во время partial-паузы: отмены нет, partial возобновляется той же строкой, запоздавший самовызов отбивается', async () => {
    const s = await startRun(t.db, TEST_USER, { kind: 'daily', now: T0 });
    if (s.kind !== 'started') throw new Error('x');
    // бюджет 0: звено останавливается partial/timeout, hops=1
    const r1 = await runChunk(deps(undefined, 0), s.run);
    expect(r1).toMatchObject({ status: 'partial', reason: 'timeout' });
    expect((await row(s.run.id)).status).toBe('partial');

    const r = await restartRun(t.db, TEST_USER, { kind: 'manual', now: new Date(T0.getTime() + 1000) });
    expect(r).toMatchObject({ kind: 'started', resumed: true, cancelledRunId: null });
    if (r.kind !== 'started') return;
    expect(r.run.id).toBe(s.run.id);
    expect(r.run.status).toBe('running');
    // запоздавший самовызов цепочки для того же запуска не должен породить второго исполнителя
    const late = await startRun(t.db, TEST_USER, { kind: 'daily', now: new Date(T0.getTime() + 2000), continueRunId: s.run.id, hop: 1 });
    expect(late.kind).not.toBe('started');
    // отмена после такого restart работает
    expect(await cancelRun(t.db, TEST_USER, T0)).toMatchObject({ id: s.run.id });
  });

  it('прогресс трофеев: отмена -> plain start -> трофеи доезжают без дублей, ранее записанные сеты не перезапрашиваются', async () => {
    const s = await startRun(t.db, TEST_USER, { kind: 'manual', now: T0 });
    if (s.kind !== 'started') throw new Error('x');
    await runChunk(deps(async (n) => void (n === 4 && (await cancelRun(t.db, TEST_USER, T0)))), s.run);
    const before = (await t.db.select().from(trophies)).length;
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThan(9);
    const earnedBefore = state.calls.earned;
    const n = await startRun(t.db, TEST_USER, { kind: 'manual', now: T0 });
    if (n.kind !== 'started') throw new Error('y');
    expect(await runChunk(deps(), n.run)).toMatchObject({ status: 'success' });
    expect((await t.db.select().from(trophies)).length).toBe(9);
    expect((await t.db.select().from(games)).length).toBe(6);
    // уже загруженные сеты повторно не запрашивались (запросов earned после отмены меньше, чем сетов)
    expect(state.calls.earned - earnedBefore).toBeLessThan(6);
  });
});
