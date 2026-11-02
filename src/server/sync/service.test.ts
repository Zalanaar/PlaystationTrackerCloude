// continueChain и launchSync: доверенный origin и предохранитель hops на принимающей стороне (BUG-2, BUG-3).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { getSyncOrigin, getPsnEnv } from '@/server/env';
import { createTestDb, type TestDb } from './test-helpers';
import { MAX_HOPS } from './engine';
import { startRun } from './runs';
import { TEST_USER } from '@/server/sync/test-helpers';

const afterCbs: Array<() => unknown> = [];
let t: TestDb;
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void afterCbs.push(fn) }));
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => t.db }));

const { continueChain, launchSync, queueChain } = await import('./service');
const SECRET = 's'.repeat(40);

describe('continueChain', () => {
  const ok = () => vi.fn(async () => new Response(null, { status: 202 }));

  it('ходит на доверенный origin с hop и Bearer', async () => {
    const f = ok();
    await continueChain(7, 3, { origin: 'https://app.example', secret: SECRET, fetchImpl: f as unknown as typeof fetch });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('https://app.example/api/cron/sync?continue=7&hop=3');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`);
  });

  it('без секрета или без доверенного origin не вызывает ничего', async () => {
    const f = ok();
    await continueChain(7, 1, { origin: null, secret: SECRET, fetchImpl: f as unknown as typeof fetch });
    await continueChain(7, 1, { origin: 'https://a.example', secret: null, fetchImpl: f as unknown as typeof fetch });
    expect(f).not.toHaveBeenCalled();
  });

  it('сбой fetch не бросает и не пишет секрет в лог', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const f = vi.fn(async () => {
      throw new Error(`boom ${SECRET}`);
    });
    await expect(continueChain(1, 1, { origin: 'https://a.example', secret: SECRET, fetchImpl: f as unknown as typeof fetch })).resolves.toBeUndefined();
    expect(JSON.stringify(err.mock.calls)).not.toContain(SECRET);
    err.mockRestore();
  });

  it('origin берётся из env, а не из запроса: подмена Host не влияет', async () => {
    vi.stubEnv('SYNC_ORIGIN', 'https://mine.example');
    vi.stubEnv('CRON_SECRET', SECRET);
    const f = ok();
    vi.stubGlobal('fetch', f);
    await continueChain(2, 1);
    expect(String((f.mock.calls[0] as unknown[])[0])).toMatch(/^https:\/\/mine\.example\//);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});

describe('getSyncOrigin', () => {
  it('приоритет и нормализация', () => {
    expect(getSyncOrigin({ SYNC_ORIGIN: 'https://a.example/path?x=1', VERCEL_URL: 'b.vercel.app' })).toBe('https://a.example');
    expect(getSyncOrigin({ VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'prod.example', VERCEL_URL: 'b.vercel.app' })).toBe('https://prod.example');
    expect(getSyncOrigin({ VERCEL_ENV: 'preview', VERCEL_PROJECT_PRODUCTION_URL: 'prod.example', VERCEL_URL: 'b.vercel.app' })).toBe('https://b.vercel.app');
    expect(getSyncOrigin({ NODE_ENV: 'development' })).toBe('http://localhost:3000');
    expect(getSyncOrigin({ NODE_ENV: 'development', PORT: '4000' })).toBe('http://localhost:4000');
  });
  it('production без доверенного origin = null; мусор и чужие схемы отвергаются', () => {
    expect(getSyncOrigin({ NODE_ENV: 'production' })).toBeNull();
    expect(getSyncOrigin({ NODE_ENV: 'production', SYNC_ORIGIN: 'ftp://x.example' })).toBeNull();
  });
});

describe('бюджет звена', () => {
  it('SYNC_TIME_BUDGET_MS ограничен 55000', () => {
    const base = { PSN_TARGET_ONLINE_ID: 'x', TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') };
    expect(getPsnEnv({ ...base, SYNC_TIME_BUDGET_MS: '280000' })?.timeBudgetMs).toBe(55000);
    expect(getPsnEnv({ ...base, SYNC_TIME_BUDGET_MS: '40000' })?.timeBudgetMs).toBe(40000);
    expect(getPsnEnv(base)?.timeBudgetMs).toBe(50000);
  });
});

describe('launchSync: hops на принимающей стороне', () => {
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    afterCbs.length = 0;
    vi.stubEnv('PSN_TARGET_ONLINE_ID', 'x');
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 1).toString('base64'));
  });

  const partial = async (hops: number) => {
    const s = await startRun(t.db, TEST_USER, { kind: 'daily', now: new Date() });
    if (s.kind !== 'started') throw new Error('start');
    await t.db
      .update(schema.syncRuns)
      .set({ status: 'partial', errorReason: 'timeout', cursor: { phase: 'trophies', hops, heartbeat: new Date().toISOString() } })
      .where(eq(schema.syncRuns.id, s.run.id));
    return s.run.id;
  };

  it('hop совпадает с курсором и не больше лимита: звено запускается (after вызван)', async () => {
    const id = await partial(3);
    const r = await launchSync({ userId: TEST_USER, kind: 'daily', continueRunId: id, hop: 3 });
    expect(r.kind).toBe('started');
    expect(afterCbs).toHaveLength(1);
  });

  it('hop выше лимита: not_resumable, after не вызван', async () => {
    const id = await partial(MAX_HOPS + 1);
    expect(await launchSync({ userId: TEST_USER, kind: 'daily', continueRunId: id, hop: MAX_HOPS + 1 })).toEqual({ kind: 'not_resumable' });
    expect(afterCbs).toHaveLength(0);
  });

  it('hop не совпадает с курсором (повтор старого вызова): not_resumable', async () => {
    const id = await partial(5);
    expect(await launchSync({ userId: TEST_USER, kind: 'daily', continueRunId: id, hop: 2 })).toEqual({ kind: 'not_resumable' });
    expect(afterCbs).toHaveLength(0);
  });

  it('курсор уже за лимитом: not_resumable даже при подходящем hop', async () => {
    const id = await partial(MAX_HOPS + 3);
    expect(await launchSync({ userId: TEST_USER, kind: 'daily', continueRunId: id, hop: MAX_HOPS })).toEqual({ kind: 'not_resumable' });
  });

  it('последнее допустимое звено (hop = 20) запускается', async () => {
    const id = await partial(MAX_HOPS);
    expect((await launchSync({ userId: TEST_USER, kind: 'daily', continueRunId: id, hop: MAX_HOPS })).kind).toBe('started');
  });
});

describe('самовызов: повторы', () => {
  const opts = (f: unknown, sleep = vi.fn(async () => undefined)) => ({ origin: 'https://a.example', secret: SECRET, fetchImpl: f as typeof fetch, sleep });

  it('5xx и сетевой сбой повторяются, затем успех', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    const o = opts(f);
    await continueChain(5, 2, o);
    expect(f).toHaveBeenCalledTimes(3);
    expect(o.sleep).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });

  it('не больше 3 попыток; тайм-аут и 4xx не повторяются', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const always = vi.fn(async () => new Response(null, { status: 502 }));
    await queueChain(3, opts(always));
    expect(always).toHaveBeenCalledTimes(3);
    const timeout = vi.fn(async () => {
      throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    });
    await queueChain(3, opts(timeout));
    expect(timeout).toHaveBeenCalledTimes(1);
    const unauthorized = vi.fn(async () => new Response(null, { status: 401 }));
    await continueChain(1, 1, opts(unauthorized));
    expect(unauthorized).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  it('queueChain передаёт номер ожидания', async () => {
    const f = vi.fn(async () => new Response(null, { status: 202 }));
    await queueChain(0, { ...opts(f), wait: 4 });
    expect(String((f.mock.calls[0] as unknown[])[0])).toBe('https://a.example/api/cron/sync?queue=0&wait=4');
  });
});
