// F2-B: обновление индекса гайдов — отдельный маршрут, Bearer, только прод, работа после ответа, сбой не наружу.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SECRET = 'g'.repeat(40);
const afterCbs: Array<() => unknown> = [];
const refresh = vi.fn();
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => void afterCbs.push(fn) }));
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => ({}) }));
vi.mock('@/server/guides/store', () => ({ refreshGuideIndex: (...a: unknown[]) => refresh(...a) }));

const req = (auth = `Bearer ${SECRET}`) => new Request('http://x/api/cron/guides', { headers: { authorization: auth } });

describe('GET /api/cron/guides', () => {
  beforeEach(() => {
    afterCbs.length = 0;
    refresh.mockReset();
    vi.stubEnv('CRON_SECRET', SECRET);
    vi.stubEnv('VERCEL_ENV', 'production');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('без Bearer — 401, ничего не запускает', async () => {
    const { GET } = await import('./route');
    expect((await GET(req('Bearer nope'))).status).toBe(401);
    expect(afterCbs).toHaveLength(0);
  });

  it('не прод — не ходит наружу', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    const { GET } = await import('./route');
    const r = await GET(req());
    expect(r.status).toBe(200);
    expect(afterCbs).toHaveLength(0);
  });

  it('прод — 202 сразу, обновление после ответа; исключение глотается', async () => {
    refresh.mockRejectedValueOnce(new Error('boom'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { GET } = await import('./route');
    const r = await GET(req());
    expect(r.status).toBe(202);
    expect(refresh).not.toHaveBeenCalled();
    expect(afterCbs).toHaveLength(1);
    await expect(Promise.resolve(afterCbs[0]())).resolves.toBeUndefined();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledWith('cron: guide index failed');
    err.mockRestore();
  });
});
