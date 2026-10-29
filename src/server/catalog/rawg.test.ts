import { describe, expect, it, vi } from 'vitest';
import { CatalogError, mapResults, searchCatalog } from './rawg';

const KEY = 'SECRET_KEY_123';
const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), { status: 200, ...init });
const mock = (impl: (url: URL, init?: RequestInit) => Promise<Response>) => vi.fn(impl) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
const reason = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(CatalogError);
    expect(String((e as Error).message)).not.toContain(KEY);
    return (e as CatalogError).reason;
  }
  return 'no_error';
};

const sample = {
  count: 3,
  results: [
    { id: 1, name: 'Hades', released: '2020-09-17', tba: false, background_image: 'https://media.rawg.io/a.jpg', platforms: [{ platform: { id: 4, name: 'PC', slug: 'pc' } }] },
    { id: 2, name: ' Resident Evil Requiem ', released: '2026-02-27', tba: false, background_image: 'https://media.rawg.io/b.jpg', platforms: [{ platform: { id: 187, name: 'PlayStation 5', slug: 'playstation5' } }, { platform: { id: 4, name: 'PC', slug: 'pc' } }] },
    { id: 3, name: 'Unannounced', released: null, tba: true, background_image: null, platforms: null },
  ],
};

describe('searchCatalog (RAWG)', () => {
  it('строит запрос с ключом на сервере и разбирает кандидатов; PlayStation первыми', async () => {
    const f = mock(async () => json(sample));
    const r = await searchCatalog('resident', { apiKey: KEY, fetch: f });
    const url = f.mock.calls[0][0] as URL;
    expect(url.origin + url.pathname).toBe('https://api.rawg.io/api/games');
    expect(url.searchParams.get('search')).toBe('resident');
    expect(url.searchParams.get('key')).toBe(KEY);
    expect(url.searchParams.get('page_size')).toBe('10');
    expect(r.map((c) => c.externalId)).toEqual(['2', '1', '3']);
    expect(r[0]).toEqual({
      externalSource: 'rawg', externalId: '2', title: 'Resident Evil Requiem', releaseDate: '2026-02-27',
      coverUrl: 'https://media.rawg.io/b.jpg', platforms: ['PlayStation 5', 'PC'], playstation: true,
    });
    expect(r[2]).toMatchObject({ releaseDate: null, coverUrl: null, platforms: [], playstation: false });
  });

  it('нет ключа: no_key, сеть не вызывается', async () => {
    const f = mock(async () => json(sample));
    expect(await reason(searchCatalog('x', { apiKey: null, fetch: f }))).toBe('no_key');
    expect(f).not.toHaveBeenCalled();
  });

  it('сеть, HTTP-ошибки, лимит, не JSON, неожиданная форма', async () => {
    const run = (impl: () => Promise<Response>) => reason(searchCatalog('x', { apiKey: KEY, fetch: mock(impl) }));
    expect(await run(async () => { throw new TypeError(`fetch failed https://api.rawg.io/api/games?key=${KEY}`); })).toBe('network');
    expect(await run(async () => new Response('x', { status: 500 }))).toBe('http_error');
    expect(await run(async () => new Response('x', { status: 401 }))).toBe('http_error');
    expect(await run(async () => new Response('x', { status: 429 }))).toBe('rate_limited');
    expect(await run(async () => new Response('<html>', { status: 200 }))).toBe('bad_response');
    expect(await run(async () => json({ detail: 'ok' }))).toBe('bad_response');
    expect(await run(async () => json({ results: 'нет' }))).toBe('bad_response');
    expect(await run(async () => json([]))).toBe('bad_response');
    expect(await run(async () => new Response(`{"results":[],"pad":"${'x'.repeat(1_000_001)}"}`))).toBe('bad_response');
  });

  it('таймаут: abort -> timeout', async () => {
    const f = mock((_url, init) => new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))));
    expect(await reason(searchCatalog('x', { apiKey: KEY, fetch: f, timeoutMs: 10 }))).toBe('timeout');
  });

  it('пустая выдача это пустой список, а не ошибка', async () => {
    expect(await searchCatalog('zzz', { apiKey: KEY, fetch: mock(async () => json({ count: 0, results: [] })) })).toEqual([]);
  });
});

describe('mapResults', () => {
  it('кривая запись пропускается, остальные остаются', () => {
    const r = mapResults({ results: [{ id: 1 }, null, { id: 5, name: 'Ok' }, { id: 6, name: '   ' }] });
    expect(r.map((c) => c.externalId)).toEqual(['5']);
  });
  it('даты: несуществующая и не ISO отбрасываются, http-обложка отбрасывается', () => {
    const r = mapResults({ results: [{ id: 1, name: 'A', released: '2026-02-30', background_image: 'http://x/a.jpg' }, { id: 2, name: 'B', released: '2026', background_image: null }, { id: 3, name: 'C', released: '2026-04-10', tba: true }] });
    expect(r.map((c) => [c.releaseDate, c.coverUrl])).toEqual([[null, null], [null, null], [null, null]]);
  });
});
