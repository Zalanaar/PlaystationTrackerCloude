// Шаг синка «У тебя нет» (контракт Фазы 30, 30.4): предупреждения, бюджет времени, отказоустойчивость.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { getRecommendations } from '@/server/recommend/db';
import { getDiscover } from '@/server/recommend/discover';
import { RunContext } from './context';
import { discoverStep } from './discover-step';
import { startRun } from './runs';
import { createTestDb, TEST_USER, type TestDb } from './test-helpers';

const { games, gameStatus, syncRuns, recommendDiscoverCache } = schema;
const NOW = new Date('2026-10-31T09:00:00Z');
const LIMITS = { userLimit: 60, totalLimit: 300 };
const body = (names: string[]) => JSON.stringify({ next: null, results: names.map((n, i) => ({ id: 100 + i, name: n, slug: `g${i}`, released: '2019-01-01', metacritic: 88, rating: 4, platforms: [{ platform: { name: 'PS5', slug: 'playstation5' } }], genres: [{ slug: 'action' }] })) });

describe('discoverStep', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function ctx(budget = 1_000_000) {
    await t.db.update(syncRuns).set({ status: 'success' }).where(eq(syncRuns.status, 'running'));
    const s = await startRun(t.db, TEST_USER, { kind: 'manual', now: NOW });
    if (s.kind !== 'started') throw new Error(s.kind);
    return new RunContext(t.db, s.run, () => NOW, budget);
  }
  async function seed() {
    const [g] = await t.db.insert(games).values({ userId: 1, category: 'ps5_native_game', lastSeenAt: NOW, titleId: 'A', name: 'Alpha', psnGenres: ['ACTION'], playDurationSeconds: 3600 * 20 }).returning({ id: games.id });
    await t.db.insert(gameStatus).values({ userId: 1, gameId: g.id, status: 'completed', statusChangedAt: NOW });
  }
  const ok = (names: string[]) => (async () => new Response(body(names), { status: 200 })) as unknown as typeof fetch;

  it('нет ключа RAWG: шаг молча пропускается, предупреждений нет', async () => {
    await seed();
    const c = await ctx();
    const r = await discoverStep(c, { rawgKey: null, limits: LIMITS, llm: null });
    expect(r.status).toBe('disabled');
    expect(c.warnings).toEqual([]);
  });

  it('успех: подборка записана; повторный запуск в те же сутки ничего не запрашивает', async () => {
    await seed();
    let calls = 0;
    const f = (async () => { calls++; return new Response(body(['Nioh 2']), { status: 200 }); }) as unknown as typeof fetch;
    const r1 = await discoverStep(await ctx(), { rawgKey: 'k', limits: LIMITS, llm: null, fetch: f });
    expect(r1.status).toBe('done');
    const n = calls;
    expect(n).toBeGreaterThan(0);
    const c2 = await ctx();
    const r2 = await discoverStep(c2, { rawgKey: 'k', limits: LIMITS, llm: null, fetch: f });
    expect(r2.status).toBe('skipped');
    expect(calls).toBe(n);
    expect(c2.warnings).toEqual([]);
    expect((await getDiscover(t.db, TEST_USER, NOW, { rawgKey: 'k', limits: LIMITS })).items.map((i) => i.title)).toEqual(['Nioh 2']);
  });

  it('лимит RAWG: предупреждение discover_limit без ключа в тексте', async () => {
    await seed();
    const c = await ctx();
    const r = await discoverStep(c, { rawgKey: 'rawg_STEP_SECRET', limits: { userLimit: 1, totalLimit: 300 }, llm: null, fetch: ok(['Nioh 2']) });
    expect(r.status).toBe('limit');
    expect(c.warnings.map((w) => w.code)).toEqual(['discover_limit']);
    expect(JSON.stringify(c.warnings)).not.toContain('STEP_SECRET');
  });

  it('сбой RAWG: предупреждение discover_failed с причиной, без ключа и URL', async () => {
    await seed();
    const c = await ctx();
    const boom = (async (u: URL) => { throw new Error(`fail ${String(u)}`); }) as unknown as typeof fetch;
    const r = await discoverStep(c, { rawgKey: 'rawg_STEP_SECRET', limits: LIMITS, llm: null, fetch: boom });
    expect(r.status).toBe('failed');
    const w = c.warnings.find((x) => x.code === 'discover_failed');
    expect(w?.message).toContain('network');
    expect(JSON.stringify(c.warnings)).not.toMatch(/STEP_SECRET|https?:/);
  });

  it('мало времени в звене: запросов нет, подборка добирается следующим синком', async () => {
    await seed();
    let calls = 0;
    const f = (async () => { calls++; return new Response(body(['Nioh 2']), { status: 200 }); }) as unknown as typeof fetch;
    const r = await discoverStep(await ctx(5_000), { rawgKey: 'k', limits: LIMITS, llm: null, fetch: f });
    expect(calls).toBe(0);
    expect(r.status).toBe('partial');
    expect(await t.db.select().from(recommendDiscoverCache)).toEqual([]);
  });

  it('«Подскажи» из бэклога не затронут шагом', async () => {
    await seed();
    await discoverStep(await ctx(), { rawgKey: 'k', limits: LIMITS, llm: null, fetch: ok(['Nioh 2']) });
    const rec = await getRecommendations(t.db, TEST_USER, 'any', NOW, { llm: null });
    expect(rec.items).toEqual([]);
  });
});
