import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cachedGet, call, GET_CACHE_TTL_MS, invalidateApiCache } from './http';
import { resetClientCaches } from '../profiles/scope';

const ok = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('cachedGet', () => {
  let n = 0;
  const fetchMock = vi.fn(async () => ok({ n: ++n }));
  beforeEach(() => { n = 0; fetchMock.mockClear(); vi.stubGlobal('fetch', fetchMock); vi.stubGlobal('window', {}); invalidateApiCache(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('делит один запрос между параллельными вызовами и отдаёт свежий ответ из памяти', async () => {
    const [a, b] = await Promise.all([cachedGet('/api/x'), cachedGet('/api/x')]);
    expect(a).toEqual({ n: 1 });
    expect(b).toBe(a);
    expect(await cachedGet('/api/x')).toEqual({ n: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await cachedGet('/api/y')).toEqual({ n: 2 });
  });

  it('перечитывает после TTL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await cachedGet('/api/x');
    vi.setSystemTime(Date.now() + GET_CACHE_TTL_MS + 1);
    expect(await cachedGet('/api/x')).toEqual({ n: 2 });
  });

  it('запись через call сбрасывает кэш, включая GET в полёте', async () => {
    const inFlight = cachedGet('/api/x');
    await call('/api/x', { method: 'PUT', body: '{}' });
    await inFlight;
    expect(await cachedGet('/api/x')).toEqual({ n: 3 });
  });

  it('смена профиля (resetClientCaches) и invalidateApiCache сбрасывают кэш', async () => {
    await cachedGet('/api/x');
    resetClientCaches();
    expect(await cachedGet('/api/x')).toEqual({ n: 2 });
    invalidateApiCache();
    expect(await cachedGet('/api/x')).toEqual({ n: 3 });
  });

  it('запрос с signal идёт своим fetch, но ответ кладёт в кэш; ошибки не кэшируются', async () => {
    const p1 = cachedGet('/api/x');
    const p2 = cachedGet('/api/x', new AbortController().signal);
    await Promise.all([p1, p2]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ ok: false, error: { code: 'x', message: 'x' } }), { status: 500 }));
    invalidateApiCache();
    await expect(cachedGet('/api/z')).rejects.toMatchObject({ status: 500 });
    expect(await cachedGet('/api/z')).toEqual({ n: 3 });
  });
});
