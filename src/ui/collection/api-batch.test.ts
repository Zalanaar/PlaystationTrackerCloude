// fetchGamesBatch (Фаза 48): один GET на все блоки, результат как allSettled по блокам.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, invalidateApiCache } from '../data/http';
import { fetchGamesBatch, gamesBatchUrl } from './api';

const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const q = (s: string) => new URLSearchParams(s);
const list = (total: number) => ({ items: [], total, limit: 60, offset: 0, counts: {}, years: [], forgottenCount: 0, durationCounts: {}, genreCounts: {}, hltbCounts: {} });

describe('fetchGamesBatch', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); vi.stubGlobal('window', {}); invalidateApiCache(); });
  afterEach(() => vi.unstubAllGlobals());

  it('URL: каждая выборка отдельным b, порядок сохраняется', () => {
    const u = new URL(gamesBatchUrl([q('status=playing&limit=12'), q('status=completed,dropped&q=ведьм')]), 'http://x');
    expect(u.pathname).toBe('/api/games/batch');
    expect(u.searchParams.getAll('b')).toEqual(['status=playing&limit=12', `status=completed%2Cdropped&q=${encodeURIComponent('ведьм')}`]);
  });

  it('один fetch; упавший блок = rejected ApiError 503, остальные fulfilled', async () => {
    fetchMock.mockResolvedValue(res(200, { ok: true, data: { results: [{ ok: true, data: list(1) }, { ok: false, code: 'db_unavailable' }] } }));
    const rs = await fetchGamesBatch([q('status=playing'), q('status=backlog')]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rs[0]).toEqual({ status: 'fulfilled', value: list(1) });
    expect(rs[1].status).toBe('rejected');
    expect((rs[1] as PromiseRejectedResult).reason).toBeInstanceOf(ApiError);
    expect(((rs[1] as PromiseRejectedResult).reason as ApiError).status).toBe(503);
  });

  it('сбой запроса целиком (401/503/сеть) или чужая длина ответа = все блоки rejected', async () => {
    fetchMock.mockResolvedValueOnce(res(401, { ok: false, error: { code: 'unauthorized', message: 'x' } }));
    vi.stubGlobal('window', { location: { assign: () => {}, pathname: '/', search: '' } });
    const r401 = await fetchGamesBatch([q('status=playing'), q('status=backlog')]);
    expect(r401.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(((r401[0] as PromiseRejectedResult).reason as ApiError).status).toBe(401);

    fetchMock.mockResolvedValueOnce(res(200, { ok: true, data: { results: [{ ok: true, data: list(1) }] } }));
    const short = await fetchGamesBatch([q('status=playing&x=1'), q('status=backlog&x=1')]);
    expect(short.map((r) => r.status)).toEqual(['rejected', 'rejected']);

    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    const net = await fetchGamesBatch([q('status=playing&x=2')]);
    expect(((net[0] as PromiseRejectedResult).reason as ApiError).code).toBe('network');
  });
});
