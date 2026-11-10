import { describe, expect, it, vi } from 'vitest';
import { parsePsStore, PSSTORE_SEARCH_HASH, searchPsStore } from './psstore';
import { CatalogError } from './rawg';

const img = (role: string, url: string) => ({ type: 'IMAGE', role, url });
const sample = {
  data: {
    universalSearch: {
      results: [
        { id: '10002694', name: 'Elden Ring™', __typename: 'Concept', storeDisplayClassification: 'FULL_GAME', platforms: ['PS5', 'PS4'], media: [img('BACKGROUND', 'https://image.api.playstation.com/bg.png'), img('MASTER', 'https://image.api.playstation.com/m.png?w=440')] },
        { id: 'UP0700-PPSA04609_00-ELDENRINGSOTE001', name: 'ELDEN RING Shadow of the Erdtree', storeDisplayClassification: 'ADD_ON', media: [] },
        { id: 'UP0700-PPSA04609_00-ELDENRING0000000', name: 'ELDEN RING', __typename: 'Product', storeDisplayClassification: 'FULL_GAME', media: [] },
        { id: 'EP1-DEMO', name: 'Elden Ring Demo', storeDisplayClassification: 'DEMO' },
        { id: 'bad id/with slash', name: 'Bad' },
        { name: 'no id' },
        { id: 'UP9000-PPSA01411_00-0000000000000000', name: ' Ghost  of Tsushima ', storeDisplayClassification: 'PREMIUM_EDITION', releaseDate: '2021-08-20T00:00:00Z', media: [img('GAMEHUB_COVER_ART', 'https://evil.example/x.png'), img('GAMEHUB_COVER_ART', 'https://image.api.playstation.com/g.png')] },
      ],
    },
  },
};

describe('PlayStation Store (запасной каталог)', () => {
  it('разбор: только игры, издания схлопнуты, id с префиксом ps-, обложка только с image.api.playstation.com', () => {
    const r = parsePsStore(sample);
    expect(r.map((c) => c.externalId)).toEqual(['ps-10002694', 'ps-UP9000-PPSA01411_00-0000000000000000']);
    expect(r[0]).toEqual({
      externalSource: 'rawg', externalId: 'ps-10002694', title: 'Elden Ring™', releaseDate: null,
      coverUrl: 'https://image.api.playstation.com/m.png', platforms: ['PlayStation 5', 'PlayStation 4'], playstation: true, catalog: 'psstore',
    });
    expect(r[1]).toMatchObject({ title: 'Ghost of Tsushima', releaseDate: '2021-08-20', coverUrl: 'https://image.api.playstation.com/g.png', platforms: [] });
    expect(parsePsStore(sample, 1)).toHaveLength(1);
  });

  it('неожиданная форма ответа = bad_response', () => {
    expect(() => parsePsStore({ data: null })).toThrow(CatalogError);
    expect(() => parsePsStore({ errors: [{ message: 'PersistedQueryNotFound' }] })).toThrow(CatalogError);
  });

  it('запрос: persisted query витрины, сбои = CatalogError с причиной', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(sample))) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    const r = await searchPsStore('elden ring', { fetch: f });
    expect(r).toHaveLength(2);
    const url = f.mock.calls[0][0] as URL;
    expect(url.origin + url.pathname).toBe('https://web.np.playstation.com/api/graphql/v1/op');
    expect(url.searchParams.get('operationName')).toBe('getSearchResults');
    expect(JSON.parse(url.searchParams.get('variables')!)).toMatchObject({ searchTerm: 'elden ring', countryCode: 'US' });
    expect(url.searchParams.get('extensions')).toContain(PSSTORE_SEARCH_HASH);

    const reason = async (impl: () => Promise<Response>, timeoutMs?: number) => {
      try {
        await searchPsStore('x', { fetch: vi.fn(impl) as unknown as typeof fetch, timeoutMs });
        return 'ok';
      } catch (e) {
        return (e as CatalogError).reason;
      }
    };
    expect(await reason(async () => new Response('', { status: 500 }))).toBe('http_error');
    expect(await reason(async () => new Response('', { status: 429 }))).toBe('rate_limited');
    expect(await reason(async () => new Response('<html>'))).toBe('bad_response');
    expect(await reason(async () => { throw new TypeError('fetch failed'); })).toBe('network');
    expect(
      await reason(() => new Promise<Response>((_, rej) => setTimeout(() => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })), 30)), 5),
    ).toBe('timeout');
  });
});
