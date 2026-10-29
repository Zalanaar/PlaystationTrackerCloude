import { describe, expect, it, vi } from 'vitest';
import { CatalogError, getUpcoming, mapResults, searchCatalog, type UpcomingCache } from './rawg';

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

  it('playstationOnly передаёт platforms=187,18 в RAWG; по умолчанию параметра нет', async () => {
    const f = mock(async () => json(sample));
    await searchCatalog('x', { apiKey: KEY, fetch: f, playstationOnly: true });
    expect((f.mock.calls[0][0] as URL).searchParams.get('platforms')).toBe('187,18');
    await searchCatalog('x', { apiKey: KEY, fetch: f });
    expect((f.mock.calls[1][0] as URL).searchParams.has('platforms')).toBe(false);
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

describe('getUpcoming (RAWG, предстоящие релизы)', () => {
  const NOW = new Date('2026-10-29T21:30:00Z'); // 30 октября 00:30 МСК
  const page1 = {
    count: 3,
    next: 'https://api.rawg.io/api/games?page=2&key=SECRET',
    results: [
      { id: 10, name: 'Soon', released: '2026-11-05', tba: false, background_image: 'https://media.rawg.io/s.jpg', platforms: [{ platform: { name: 'PlayStation 5', slug: 'playstation5' } }] },
      { id: 11, name: 'No date', released: null, tba: true, background_image: null, platforms: [] },
      { id: 12, name: 'Later', released: '2027-01-10', tba: false, background_image: null, platforms: [{ platform: { name: 'PC', slug: 'pc' } }] },
    ],
  };

  it('строит запрос: диапазон по МСК, ordering, платформы PlayStation, page_size, page; пропускает tba; порядок RAWG', async () => {
    const f = mock(async () => json(page1));
    const r = await getUpcoming(2, { apiKey: KEY, fetch: f, now: NOW, cache: new Map() });
    const u = f.mock.calls[0][0] as URL;
    expect(u.searchParams.get('dates')).toBe('2026-10-30,2027-10-30');
    expect(u.searchParams.get('ordering')).toBe('released');
    expect(u.searchParams.get('platforms')).toBe('187,18');
    expect(u.searchParams.get('page_size')).toBe('20');
    expect(u.searchParams.get('page')).toBe('2');
    expect(u.searchParams.get('key')).toBe(KEY);
    expect(r.page).toBe(2);
    expect(r.hasMore).toBe(true);
    expect(r.candidates.map((c) => c.externalId)).toEqual(['10', '12']); // без tba, без пересортировки PS-первыми
  });

  it('hasMore: next null = false; нет поля next = по заполненности страницы', async () => {
    const c: UpcomingCache = new Map();
    expect((await getUpcoming(1, { apiKey: KEY, fetch: mock(async () => json({ ...page1, next: null })), now: NOW, cache: c })).hasMore).toBe(false);
    const full = { results: Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `G${i}`, released: '2026-12-01' })) };
    expect((await getUpcoming(2, { apiKey: KEY, fetch: mock(async () => json(full)), now: NOW, cache: c })).hasMore).toBe(true);
    expect((await getUpcoming(3, { apiKey: KEY, fetch: mock(async () => json({ results: [] })), now: NOW, cache: c })).hasMore).toBe(false);
  });

  it('кэш 1 час: повтор не ходит в сеть, страницы раздельно, через час и новый день заново', async () => {
    const f = mock(async () => json(page1));
    const cache: UpcomingCache = new Map();
    const at = (ms: number) => new Date(NOW.getTime() + ms);
    await getUpcoming(1, { apiKey: KEY, fetch: f, now: NOW, cache });
    await getUpcoming(1, { apiKey: KEY, fetch: f, now: at(59 * 60_000), cache });
    expect(f).toHaveBeenCalledTimes(1);
    await getUpcoming(2, { apiKey: KEY, fetch: f, now: at(59 * 60_000), cache });
    expect(f).toHaveBeenCalledTimes(2);
    await getUpcoming(1, { apiKey: KEY, fetch: f, now: at(60 * 60_000), cache });
    expect(f).toHaveBeenCalledTimes(3);
    await getUpcoming(1, { apiKey: KEY, fetch: f, now: at(26 * 3600_000), cache });
    expect(f).toHaveBeenCalledTimes(4);
  });

  it('ошибки не кэшируются; нет ключа без сети; ключа нет в сообщениях', async () => {
    const cache: UpcomingCache = new Map();
    const bad = mock(async () => new Response('x', { status: 500 }));
    expect(await reason(getUpcoming(1, { apiKey: KEY, fetch: bad, now: NOW, cache }))).toBe('http_error');
    expect(await reason(getUpcoming(1, { apiKey: KEY, fetch: mock(async () => new Response('', { status: 429 })), now: NOW, cache }))).toBe('rate_limited');
    expect(await reason(getUpcoming(1, { apiKey: KEY, fetch: mock(async () => { throw new TypeError(`failed ?key=${KEY}`); }), now: NOW, cache }))).toBe('network');
    expect(await reason(getUpcoming(1, { apiKey: KEY, fetch: mock(async () => json({ nope: 1 })), now: NOW, cache }))).toBe('bad_response');
    expect(cache.size).toBe(0);
    const f = mock(async () => json(page1));
    expect(await reason(getUpcoming(1, { apiKey: null, fetch: f, now: NOW, cache }))).toBe('no_key');
    expect(f).not.toHaveBeenCalled();
  });
});
