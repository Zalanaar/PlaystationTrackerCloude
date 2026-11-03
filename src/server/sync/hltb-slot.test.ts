// П. 3: шаг HLTB синка пропускается, пока у пользователя идёт массовый HLTB-запуск (hltb_runs). PGlite, фейковый PSN.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { connectPsn } from '@/server/psn/client';
import { runChunk, type SyncDeps } from './engine';
import { HLTB_STALE_RUN_MS, hltbRunActive } from './hltb-slot';
import { startRun } from './runs';
import { createTestDb, fakeApi, freshState, TEST_USER, TEST_USER_2, type TestDb } from './test-helpers';

const { hltbRuns, allowedUsers } = schema;
const T0 = new Date('2026-10-27T17:00:00Z');

describe('слот HLTB и шаг синка', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  const run = async (searches: { n: number }) => {
    const api = fakeApi(freshState());
    const deps: SyncDeps = {
      db: t.db,
      now: () => T0,
      budgetMs: 1_000_000,
      connect: () => connectPsn({ getAccessToken: async () => 'test-token', onlineId: 'Target', delayMs: 0, api, sleep: async () => undefined, now: () => T0.getTime() }),
      hltb: { client: { search: async () => (searches.n++, []) }, sleep: async () => undefined, pauseMs: 0, reserve: async () => 'ok' },
    };
    const s = await startRun(t.db, TEST_USER, { kind: 'manual', now: T0 });
    if (s.kind !== 'started') throw new Error('не стартовало');
    return runChunk(deps, s.run);
  };

  it('без массового запуска шаг HLTB идёт', async () => {
    const n = { n: 0 };
    await run(n);
    expect(n.n).toBeGreaterThan(0);
  });

  it('пока идёт массовый запуск этого пользователя, шаг HLTB синка пропущен, синк проходит', async () => {
    await t.db.insert(hltbRuns).values({ userId: 1, status: 'running', startedAt: T0, heartbeatAt: T0 });
    const n = { n: 0 };
    const res = await run(n);
    expect(n.n).toBe(0);
    expect(res.status).not.toBe('failed');
  });

  it('hltbRunActive: только свой пользователь, только running с живым heartbeat', async () => {
    await t.db.insert(allowedUsers).values({ email: 'm@example.com', role: 'member', status: 'active' });
    await t.db.insert(hltbRuns).values({ userId: 1, status: 'running', startedAt: T0, heartbeatAt: T0 });
    expect(await hltbRunActive(t.db, TEST_USER, T0)).toBe(true);
    expect(await hltbRunActive(t.db, TEST_USER_2, T0)).toBe(false);
    expect(await hltbRunActive(t.db, TEST_USER, new Date(T0.getTime() + HLTB_STALE_RUN_MS + 1000))).toBe(false);
  });
});
