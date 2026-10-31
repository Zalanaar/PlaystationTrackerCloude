// QA правок после выкатки Фазы 12: исключения, порядок со скрытыми, каталог предстоящих (адверсариально).
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { getUpcoming, type UpcomingCache } from '@/server/catalog/rawg';
import { createTestDb, type TestDb, TEST_USER } from '@/server/sync/test-helpers';
import { createPlanned, excludeGame, getBacklogEntries, getRoadmap, putSettings, restoreGame, saveOrder, updatePlanned } from './db';
import { parseUpcomingPage } from './validation';

const { games, gameStatus, roadmapOrder, playtimeSnapshots } = schema;
const NOW = new Date('2026-10-29T09:00:00Z');

describe('QA: исключения и порядок', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function seed(n: number, hours = 10) {
    const rows = await t.db.insert(games).values(Array.from({ length: n }, (_, i) => ({ userId: 1, category: 'ps5_native_game', lastSeenAt: NOW, titleId: `T${i}`, name: `G${i}`, hltbMainHours: hours }))).returning({ id: games.id });
    const ids = rows.map((r) => r.id);
    await t.db.insert(gameStatus).values(ids.map((gameId, i) => ({ userId: 1, gameId, status: 'backlog' as const, statusChangedAt: new Date(NOW.getTime() + i * 1000) })));
    return ids;
  }

  it('исключение -> смена статуса на completed -> возврат: порядок не трогаем, в очередь не попадает; назад в backlog игра сразу в очереди', async () => {
    const [a, b, c] = await seed(3);
    await saveOrder(t.db, TEST_USER, [a, b, c]);
    await excludeGame(t.db, TEST_USER, b);
    await t.db.update(gameStatus).set({ status: 'completed' }).where(eq(gameStatus.gameId, b));
    await restoreGame(t.db, TEST_USER, b);
    expect((await getBacklogEntries(t.db, TEST_USER)).map((e) => e.gameId)).toEqual([a, c]);
    await t.db.update(gameStatus).set({ status: 'backlog' }).where(eq(gameStatus.gameId, b));
    expect((await getBacklogEntries(t.db, TEST_USER)).map((e) => e.gameId)).toContain(b);
  });

  it('исключение -> смена статуса на service -> backlog: игра остаётся исключённой (не всплывает в очереди сама)', async () => {
    const [a, b] = await seed(2);
    await excludeGame(t.db, TEST_USER, b);
    await t.db.update(gameStatus).set({ status: 'service' }).where(eq(gameStatus.gameId, b));
    await t.db.update(gameStatus).set({ status: 'backlog' }).where(eq(gameStatus.gameId, b));
    expect((await getBacklogEntries(t.db, TEST_USER)).map((e) => e.gameId)).toEqual([a]);
  });

  it('возврат: позиции остальных сохраняются при строках порядка у ушедших игр и скрытых not_fit', async () => {
    const ids = await seed(5, 60); // не все влезут в бюджет 5 ч/нед при 60 ч
    await putSettings(t.db, TEST_USER, { year: 2026, hoursPerWeek: 5 });
    const [done, ...q] = ids;
    await saveOrder(t.db, TEST_USER, [done, ...q]);
    await t.db.update(gameStatus).set({ status: 'completed' }).where(eq(gameStatus.gameId, done));
    await excludeGame(t.db, TEST_USER, q[0]);
    await restoreGame(t.db, TEST_USER, q[0]);
    const r = await getRoadmap(t.db, TEST_USER, NOW);
    expect(r.queue.map((x) => x.key)).toEqual([...q.slice(1), q[0]].map((x) => `g:${x}`));
    const rows = await t.db.select().from(roadmapOrder).where(eq(roadmapOrder.gameId, done));
    expect(rows).toHaveLength(1); // строка завершённой игры жива (прогресс)
  });

  it('полный порядок с not_fit сохраняется, позиции скрытых не ломаются', async () => {
    const ids = await seed(6, 60);
    await putSettings(t.db, TEST_USER, { year: 2026, hoursPerWeek: 2 });
    const r0 = await getRoadmap(t.db, TEST_USER, NOW);
    expect(r0.notFit.length).toBeGreaterThan(0);
    const full = r0.queue.map((q) => Number(q.key.slice(2)));
    const swapped = [full[1], full[0], ...full.slice(2)];
    await saveOrder(t.db, TEST_USER, swapped);
    const r1 = await getRoadmap(t.db, TEST_USER, NOW);
    expect(r1.queue.map((q) => Number(q.key.slice(2)))).toEqual(swapped);
    expect(new Set(full)).toEqual(new Set(ids));
  });

  it('исключённая игра не в notFit/needHours/progress; часы исключённой в факте не считаются', async () => {
    const [a, b] = await seed(2, 10);
    await putSettings(t.db, TEST_USER, { year: 2026, hoursPerWeek: 10 });
    await t.db.insert(playtimeSnapshots).values([
      { userId: 1, gameId: b, snapshotDate: '2026-02-01', playDurationSeconds: 0 }, { userId: 1, gameId: b, snapshotDate: '2026-10-01', playDurationSeconds: 36000 },
      { userId: 1, gameId: a, snapshotDate: '2026-02-01', playDurationSeconds: 0 }, { userId: 1, gameId: a, snapshotDate: '2026-10-01', playDurationSeconds: 3600 },
    ]);
    await saveOrder(t.db, TEST_USER, [a, b]);
    const before = await getRoadmap(t.db, TEST_USER, NOW);
    await excludeGame(t.db, TEST_USER, b);
    const after = await getRoadmap(t.db, TEST_USER, NOW);
    expect(JSON.stringify(after.items) + JSON.stringify(after.notFit) + JSON.stringify(after.needHours) + JSON.stringify(after.conflicts)).not.toContain(`g:${b}`);
    expect(after.progress!.actualHours).toBeLessThan(before.progress!.actualHours);
    expect(after.progress!.actualHours).toBeCloseTo(1, 1);
  });

  it('релиз: unallocated исключает из плана и конфликтов, возврат planned возвращает; удаление совсем', async () => {
    await putSettings(t.db, TEST_USER, { year: 2026, hoursPerWeek: 10 });
    const a = await createPlanned(t.db, TEST_USER, { title: 'R1', releaseDate: '2026-11-02', coverUrl: null, wantAtRelease: true, hoursManual: 10, externalSource: null, externalId: null });
    const b = await createPlanned(t.db, TEST_USER, { title: 'R2', releaseDate: '2026-11-02', coverUrl: null, wantAtRelease: true, hoursManual: 10, externalSource: null, externalId: null });
    expect((await getRoadmap(t.db, TEST_USER, NOW)).conflicts.length).toBe(1);
    await updatePlanned(t.db, TEST_USER, b.id, { status: 'cancelled' });
    const r = await getRoadmap(t.db, TEST_USER, NOW);
    expect(r.conflicts).toEqual([]);
    expect(r.unallocated.map((e) => e.plannedId)).toEqual([b.id]);
    expect(a.id).not.toBe(b.id);
  });
});

describe('QA: каталог предстоящих', () => {
  const body = (n: number, next: string | null = 'x') => JSON.stringify({ next, results: Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `<img src=x onerror=alert(1)>${i}`, released: '2026-12-01', platforms: [{ platform: { name: 'PS5', slug: 'playstation5' } }] })) });
  const mk = (responses: Array<number | string>, calls: string[]): typeof fetch => (async (u: URL | string) => {
    calls.push(String(u));
    const r = responses.shift()!;
    return typeof r === 'number' ? new Response('boom', { status: r }) : new Response(r, { status: 200 });
  }) as typeof fetch;

  it('кэш не кэширует ошибки; успех кэшируется на час; ключ только в URL запроса', async () => {
    const calls: string[] = [];
    const cache: UpcomingCache = new Map();
    const deps = { apiKey: 'SECRETKEY', cache, fetch: mk([500, body(3), body(3)], calls), now: NOW };
    await expect(getUpcoming(1, deps)).rejects.toMatchObject({ reason: 'http_error' });
    expect(cache.size).toBe(0);
    const ok = await getUpcoming(1, deps);
    expect(ok.candidates).toHaveLength(3);
    await getUpcoming(1, deps);
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(ok)).not.toContain('SECRETKEY');
    await getUpcoming(1, { ...deps, now: new Date(NOW.getTime() + 3_700_000) });
    expect(calls).toHaveLength(3);
  });

  it('страница за пределами (404), битый JSON, 429, пустой results: 404/битый -> ошибки без ключа, пустой -> hasMore false', async () => {
    const calls: string[] = [];
    const d = (r: Array<number | string>) => ({ apiKey: 'SECRETKEY', cache: new Map() as UpcomingCache, fetch: mk(r, calls), now: NOW });
    await expect(getUpcoming(9, d([404]))).rejects.toMatchObject({ reason: 'http_error' });
    await expect(getUpcoming(1, d(['{bad']))).rejects.toMatchObject({ reason: 'bad_response' });
    await expect(getUpcoming(1, d([429]))).rejects.toMatchObject({ reason: 'rate_limited' });
    const empty = await getUpcoming(1, d([JSON.stringify({ next: null, results: [] })]));
    expect(empty).toMatchObject({ candidates: [], hasMore: false });
  });

  it('page 1..500', () => {
    const p = (v: string) => parseUpcomingPage(new URLSearchParams(v));
    for (const v of ['page=0', 'page=501', 'page=-1', 'page=1.5', 'page=1e2', 'page=abc', 'page=00001', 'page=99999']) expect(p(v).ok, v).toBe(false);
    for (const v of ['', 'page=1', 'page=500']) expect(p(v).ok, v).toBe(true);
  });
});
