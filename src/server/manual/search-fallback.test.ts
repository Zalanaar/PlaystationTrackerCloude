import { describe, expect, it, vi } from 'vitest';
import { Breaker } from '@/server/catalog/fallback';
import type { CatalogCandidate } from '@/server/catalog/rawg';
import { FALLBACK_TTL_MS, searchAnyPlatform, searchPlayStation, suggestPlayStation, type CatalogFallback, type SearchCache, type SuggestCache } from './search';

const ps = (id: string): CatalogCandidate => ({ externalSource: 'rawg', externalId: id, title: `Game ${id}`, releaseDate: null, coverUrl: null, platforms: ['PlayStation 5'], playstation: true, catalog: 'psstore' });
const down = vi.fn(async () => new Response('', { status: 522 })) as unknown as typeof fetch;
const rawgOk = vi.fn(async () => new Response(JSON.stringify({ count: 1, results: [{ id: 7, name: 'Hades', released: null, platforms: [{ platform: { id: 187, name: 'PlayStation 5', slug: 'playstation5' } }] }] }))) as unknown as typeof fetch;
const fallback = (): CatalogFallback & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    breaker: new Breaker(),
    playstation: async (q, limit) => (calls.push(`ps:${q}:${limit}`), { candidates: [ps('ps-1')], catalog: 'psstore' }),
    any: async (q) => (calls.push(`any:${q}`), { candidates: [ps('ps-2')], catalog: 'psstore' }),
  };
};
const reserve = async () => true;

describe('поиск «Не куплено» и «Другая платформа» при сбое RAWG', () => {
  it('PS-поиск, подсказки и все платформы уходят в запасной каталог', async () => {
    const fb = fallback();
    const now = new Date('2026-11-10T10:00:00Z');
    const a = await searchPlayStation('elden', { apiKey: 'K', fetch: down, reserve, fallback: fb, cache: new Map(), now });
    expect(a).toMatchObject({ catalog: 'psstore', cached: false });
    expect(a.candidates[0].externalId).toBe('ps-1');
    const s = await suggestPlayStation('eld', { apiKey: 'K', fetch: down, reserve, fallback: { ...fb, breaker: new Breaker() }, suggestCache: new Map(), now });
    expect(s.catalog).toBe('psstore');
    const o = await searchAnyPlatform('zelda', { apiKey: 'K', fetch: down, reserve, fallback: { ...fb, breaker: new Breaker() }, cache: new Map(), now });
    expect(o.candidates[0].externalId).toBe('ps-2');
    expect(fb.calls).toEqual(['ps:elden:10', 'ps:eld:8', 'any:zelda']);
  });

  it('выдача запасного живёт в кэше 2 минуты, RAWG — 10', async () => {
    const cache: SearchCache = new Map();
    const t0 = Date.parse('2026-11-10T10:00:00Z');
    await searchPlayStation('elden', { apiKey: 'K', fetch: down, reserve, fallback: fallback(), cache, now: new Date(t0) });
    expect((await searchPlayStation('elden', { apiKey: 'K', fetch: down, reserve, fallback: fallback(), cache, now: new Date(t0 + FALLBACK_TTL_MS - 1000) })).cached).toBe(true);
    const later = await searchPlayStation('elden', { apiKey: 'K', fetch: rawgOk, reserve, fallback: fallback(), cache, now: new Date(t0 + FALLBACK_TTL_MS + 1000) });
    expect(later).toMatchObject({ cached: false, catalog: 'rawg' });
  });

  it('подсказки запасного не переиспользуются префиксом', async () => {
    const sc: SuggestCache = new Map();
    const now = new Date('2026-11-10T10:00:00Z');
    await suggestPlayStation('eld', { apiKey: 'K', fetch: down, reserve, fallback: fallback(), suggestCache: sc, now });
    expect(sc.get('eld')?.complete).toBe(false);
  });

  it('без запасного (старые вызовы) — ошибка RAWG как раньше', async () => {
    await expect(searchPlayStation('x', { apiKey: 'K', fetch: down, reserve, cache: new Map() })).rejects.toMatchObject({ reason: 'http_error' });
  });
});
