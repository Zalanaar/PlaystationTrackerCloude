import { describe, expect, it, vi } from 'vitest';
import { CatalogError } from './rawg';
import {
  CATALOG_CACHE_TTL_MS,
  cachedSearch,
  cachedUpcoming,
  isFresh,
  memoryCatalogCache,
  searchCacheKey,
  upcomingCacheKey,
} from './cache';

const KEY = 'SECRET_KEY_123';
const NOW = new Date('2026-10-29T21:30:00Z'); // 30 октября 00:30 МСК
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const mock = (impl: (url: URL, init?: RequestInit) => Promise<Response>) => vi.fn(impl) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

const page1 = {
  count: 2,
  next: null,
  results: [
    { id: 10, name: 'Soon', released: '2026-11-05', tba: false, background_image: 'https://media.rawg.io/s.jpg', platforms: [{ platform: { name: 'PlayStation 5', slug: 'playstation5' } }] },
    { id: 12, name: 'Later', released: '2027-01-10', tba: false, background_image: null, platforms: [{ platform: { name: 'PC', slug: 'pc' } }] },
  ],
};

const searchBody = {
  results: [
    { id: 2, name: 'Last of Us', released: '2026-02-27', tba: false, background_image: 'https://media.rawg.io/b.jpg', platforms: [{ platform: { name: 'PlayStation 5', slug: 'playstation5' } }] },
  ],
};

describe('ключи и TTL', () => {
  it('ключ новинок включает диапазон и страницу; поиск нормализует запрос', () => {
    expect(upcomingCacheKey('2026-10-30', '2027-10-30', 1)).toBe('upcoming:2026-10-30|2027-10-30|1');
    expect(searchCacheKey('  Last   of  ', true, 10)).toBe('search:ps:10:last of');
    expect(searchCacheKey('Last of', false, 10)).toBe('search:any:10:last of');
  });

  it('isFresh: внутри TTL да, на границе и в прошлом нет', () => {
    const t = NOW.getTime();
    expect(isFresh(t, t + CATALOG_CACHE_TTL_MS - 1, CATALOG_CACHE_TTL_MS)).toBe(true);
    expect(isFresh(t, t + CATALOG_CACHE_TTL_MS, CATALOG_CACHE_TTL_MS)).toBe(false);
    expect(isFresh(t, t - 1, CATALOG_CACHE_TTL_MS)).toBe(false);
  });
});

describe('cachedUpcoming', () => {
  it('повторное открытие страницы: 0 запросов к RAWG при свежем кэше', async () => {
    const f = mock(async () => json(page1));
    const store = memoryCatalogCache();
    const first = await cachedUpcoming(1, { apiKey: KEY, fetch: f, now: NOW, store });
    expect(first.rawgCalls).toBe(1);
    expect(first.stale).toBe(false);
    expect(first.value.candidates.map((c) => c.externalId)).toEqual(['10', '12']);
    const second = await cachedUpcoming(1, { apiKey: KEY, fetch: f, now: new Date(NOW.getTime() + 60_000), store });
    expect(second.rawgCalls).toBe(0);
    expect(second.fetchedAt).toBe(first.fetchedAt);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('429 при живом кэше: отдаём последние данные как stale, не пустую ошибку', async () => {
    const f = mock(async () => json(page1));
    const store = memoryCatalogCache();
    const first = await cachedUpcoming(1, { apiKey: KEY, fetch: f, now: NOW, store });
    const limited = mock(async () => new Response('x', { status: 429 }));
    const staleAt = new Date(NOW.getTime() + CATALOG_CACHE_TTL_MS + 1000);
    const stale = await cachedUpcoming(1, { apiKey: KEY, fetch: limited, now: staleAt, store });
    expect(stale.stale).toBe(true);
    expect(stale.value.candidates).toEqual(first.value.candidates);
    expect(stale.fetchedAt).toBe(first.fetchedAt);
    expect(stale.rawgCalls).toBe(1);
  });

  it('429 без кэша: ошибка rate_limited', async () => {
    const f = mock(async () => new Response('x', { status: 429 }));
    await expect(cachedUpcoming(1, { apiKey: KEY, fetch: f, now: NOW, store: memoryCatalogCache() }))
      .rejects.toMatchObject({ reason: 'rate_limited' } satisfies Partial<CatalogError>);
  });
});

describe('cachedSearch', () => {
  it('повтор того же запроса не ходит в RAWG', async () => {
    const f = mock(async () => json(searchBody));
    const store = memoryCatalogCache();
    const a = await cachedSearch('Last of', { apiKey: KEY, fetch: f, now: NOW, store, playstationOnly: true });
    const b = await cachedSearch('  last   of ', { apiKey: KEY, fetch: f, now: NOW, store, playstationOnly: true });
    expect(a.rawgCalls).toBe(1);
    expect(b.rawgCalls).toBe(0);
    expect(b.value[0]?.title).toBe('Last of Us');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('429 после истечения TTL: stale-выдача', async () => {
    const f = mock(async () => json(searchBody));
    const store = memoryCatalogCache();
    await cachedSearch('Last of', { apiKey: KEY, fetch: f, now: NOW, store, playstationOnly: true });
    const limited = mock(async () => new Response('x', { status: 429 }));
    const stale = await cachedSearch('Last of', {
      apiKey: KEY, fetch: limited, now: new Date(NOW.getTime() + CATALOG_CACHE_TTL_MS + 1), store, playstationOnly: true,
    });
    expect(stale.stale).toBe(true);
    expect(stale.value[0]?.externalId).toBe('2');
  });
});
