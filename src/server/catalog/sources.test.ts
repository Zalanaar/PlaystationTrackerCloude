import { describe, expect, it, vi } from 'vitest';
import { parseEshop } from './eshop';
import { parseGiantBomb, searchGiantBomb } from './giantbomb';
import { baseTitle } from './http';
import { parseMsStore } from './msstore';
import { CatalogError, type CatalogCandidate } from './rawg';
import { catalogFallback, mergeResults, relevance } from './sources';
import { parseSteam } from './steam';
import { parseEntities, parseNotable, parseScore } from './wikidata';

const json = (b: unknown) => new Response(JSON.stringify(b));
const steamBody = { items: [
  { type: 'app', name: 'Hades', id: 1145360, tiny_image: 'https://shared.akamai.steamstatic.com/a.jpg' },
  { type: 'app', name: 'Hades Original Soundtrack', id: 1 },
  { type: 'app', name: 'Hades II', id: 1145350 },
  { type: 'dlc', name: 'Hades DLC', id: 2 },
  { name: 'no id' },
] };
const eshopBody = { response: { docs: [
  { fs_id: '1576884', title: 'The Legend of Zelda: Tears of the Kingdom', dates_released_dts: ['2023-05-12T00:00:00Z'], image_url_sq_s: 'https://www.nintendo.com/eu/media/x.jpg', system_names_txt: ['Nintendo Switch'] },
  { fs_id: 'x/y', title: 'Bad' },
  { fs_id: 3115664, title: 'Zelda OoT', image_url_sq_s: 'https://evil.example/x.jpg', system_names_txt: ['Nintendo Switch 2'] },
] } };
const msBody = { Results: [
  { Products: [{ ProductId: '9PLKVSWR299F', Title: 'Forza Motorsport Standard Edition', Type: 'Game', Icon: '//store-images.s-microsoft.com/image/a' }] },
  { Products: [{ ProductId: '9PN4DRJDLZT7', Title: 'Forza Motorsport Deluxe Edition', Type: 'Game' }] },
  { Products: [{ ProductId: '9N5MZM3J3LCQ', Title: 'Forza Motorsport Premium Add-Ons Bundle', Type: 'Game' }] },
  { Products: [{ ProductId: '9NBLGGH4R315', Title: 'Some App', Type: 'Application' }] },
] };

describe('запасные каталоги: разбор ответов', () => {
  it('Steam: только игры, без саундтреков и DLC, id steam-, PC', () => {
    const r = parseSteam(steamBody);
    expect(r.map((c) => [c.externalId, c.title, c.platforms, c.catalog, c.playstation])).toEqual([
      ['steam-1145360', 'Hades', ['PC'], 'steam', false], ['steam-1145350', 'Hades II', ['PC'], 'steam', false],
    ]);
    expect(r[0].coverUrl).toBe('https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1145360/library_600x900.jpg');
    expect(() => parseSteam({ nope: 1 })).toThrow(CatalogError);
  });

  it('Nintendo: id ns-, дата, платформа, обложка только с nintendo.com', () => {
    const r = parseEshop(eshopBody);
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({
      externalSource: 'rawg', externalId: 'ns-1576884', title: 'The Legend of Zelda: Tears of the Kingdom', releaseDate: '2023-05-12',
      coverUrl: 'https://www.nintendo.com/eu/media/x.jpg', platforms: ['Nintendo Switch'], playstation: false, catalog: 'eshop',
    });
    expect(r[1]).toMatchObject({ externalId: 'ns-3115664', coverUrl: null, platforms: ['Nintendo Switch 2'] });
  });

  it('Microsoft Store: издания схлопнуты, наборы дополнений и приложения отброшены', () => {
    const r = parseMsStore(msBody);
    expect(r.map((c) => [c.externalId, c.title, c.platforms])).toEqual([['xb-9PLKVSWR299F', 'Forza Motorsport', ['Xbox']]]);
    expect(r[0].coverUrl).toBe('https://store-images.s-microsoft.com/image/a');
    expect(baseTitle('Halo: The Master Chief Collection')).toBe('Halo: The Master Chief Collection');
  });

  it('Wikidata: только видеоигры, платформы и дата из утверждений', () => {
    const claim = (v: unknown) => ({ mainsnak: { datavalue: { value: v } } });
    const body = { entities: {
      Q1: { id: 'Q1', labels: { en: { value: 'Halo Infinite' } }, claims: { P31: [claim({ id: 'Q7889' })], P400: [claim({ id: 'Q13361286' }), claim({ id: 'Q1406' }), claim({ id: 'Q999' })], P577: [claim({ time: '+2021-12-08T00:00:00Z', precision: 11 }), claim({ time: '+2021-00-00T00:00:00Z', precision: 9 })] } },
      Q2: { id: 'Q2', labels: { mul: { value: 'Halo (franchise)' } }, claims: { P31: [claim({ id: 'Q7058673' })] } },
      Q3: { id: 'Q3', labels: { mul: { value: 'Astro Bot' } }, claims: { P31: [claim({ id: 'Q7889' })], P400: [claim({ id: 'Q63184502' })] } },
    } };
    const r = parseEntities(body, ['Q3', 'Q1', 'Q2']);
    expect(r.map((c) => [c.externalId, c.title, c.platforms, c.releaseDate, c.playstation])).toEqual([
      ['wd-Q3', 'Astro Bot', ['PlayStation 5'], null, true], ['wd-Q1', 'Halo Infinite', ['Xbox One', 'PC'], '2021-12-08', false],
    ]);
  });

  it('Wikidata SPARQL: заметные игры PS, жанры в слагах RAWG, оценка Metacritic', () => {
    expect([parseScore('85/100'), parseScore('86/100 (Generally favorable)'), parseScore('91'), parseScore('A+'), parseScore(undefined)]).toEqual([85, 86, 91, null, null]);
    const b = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v }]));
    const r = parseNotable({ results: { bindings: [
      b({ game: 'http://www.wikidata.org/entity/Q42564798', title: 'Ghost of Tsushima', released: '2020-07-17T00:00:00Z', sl: '42', plats: 'Q5014725,Q63184502', genres: 'Q343568,Q333967', mc: '83/100' }),
      b({ game: 'http://www.wikidata.org/entity/Q1', title: 'Q1', sl: '20', plats: 'Q5014725' }),
      b({ game: 'http://www.wikidata.org/entity/Q2', title: 'No PS', sl: '20', plats: '' }),
    ] } });
    expect(r).toEqual([{ externalId: 'wd-Q42564798', title: 'Ghost of Tsushima', releaseDate: '2020-07-17', psPlatforms: ['PS5', 'PS4'], genreSlugs: ['action', 'adventure'], tagSlugs: ['horror'], metacritic: 83, notability: 42 }]);
    expect(() => parseNotable({})).toThrow(CatalogError);
  });

  it('Giant Bomb: без ключа источник выключен (no_key), с ключом — разбор', async () => {
    await expect(searchGiantBomb('x', null)).rejects.toMatchObject({ reason: 'no_key' });
    const r = parseGiantBomb({ status_code: 1, results: [{ id: 5, name: 'Bloodborne', original_release_date: '2015-03-24', image: { small_url: 'https://www.giantbomb.com/a/uploads/x.jpg' }, platforms: [{ name: 'PlayStation 4' }] }] });
    expect(r[0]).toMatchObject({ externalId: 'gb-5', playstation: true, releaseDate: '2015-03-24', coverUrl: 'https://www.giantbomb.com/a/uploads/x.jpg', catalog: 'giantbomb' });
    expect(() => parseGiantBomb({ status_code: 100, results: [] })).toThrow(CatalogError);
  });
});

const cand = (id: string, title: string, platforms: string[], catalog: CatalogCandidate['catalog']): CatalogCandidate => ({
  externalSource: 'rawg', externalId: id, title, releaseDate: null, coverUrl: null, platforms, playstation: platforms.some((p) => p.startsWith('PlayStation')), catalog,
});

describe('слияние и порядок источников', () => {
  it('релевантность и слияние одной игры с разных площадок', () => {
    expect([relevance('Hades', 'hades'), relevance('Hades II', 'hades'), relevance('The Hades Story', 'hades'), relevance('Zagreus', 'hades')]).toEqual([3, 2, 1, 0]);
    const r = mergeResults([
      [cand('ps-1', 'Hades II', ['PlayStation 5'], 'psstore'), cand('ps-2', 'Hades', ['PlayStation 5', 'PlayStation 4'], 'psstore')],
      [cand('steam-1', 'Hades', ['PC'], 'steam'), cand('steam-2', 'Hades Harem', ['PC'], 'steam')],
    ], 'hades', 10);
    expect(r.map((c) => [c.externalId, c.platforms.join('/')])).toEqual([
      ['steam-1', 'PC/PlayStation 5/PlayStation 4'], ['ps-1', 'PlayStation 5'], ['steam-2', 'PC'],
    ]);
  });

  type Route = (u: URL) => Response | Promise<Response>;
  const fake = (routes: Record<string, Route>) => vi.fn(async (input: URL | string) => {
    const u = new URL(String(input));
    const hit = Object.entries(routes).find(([host]) => u.hostname === host);
    if (!hit) throw new TypeError('fetch failed');
    return hit[1](u);
  }) as unknown as typeof fetch;
  const psBody = { data: { universalSearch: { results: [{ id: '1', name: 'Hades', storeDisplayClassification: 'FULL_GAME', platforms: ['PS5'] }] } } };

  it('все платформы: источники независимы — Steam упал, остальные отвечают; ничего — Wikidata', async () => {
    const f = fake({
      'web.np.playstation.com': () => json(psBody),
      'store.steampowered.com': () => new Response('', { status: 503 }),
      'searching.nintendo-europe.com': () => json({ response: { docs: [] } }),
      'displaycatalog.mp.microsoft.com': () => json({ Results: [{ Products: [{ ProductId: '9PLKVSWR299F', Title: 'Hades', Type: 'Game' }] }] }),
    });
    const r = await catalogFallback({ fetch: f, giantBombKey: null }).any!('hades', 10);
    expect(r.catalog).toBe('psstore');
    expect(r.candidates.map((c) => [c.externalId, c.platforms.join('/')])).toEqual([['ps-1', 'PlayStation 5/Xbox']]);

    const wdOnly = fake({
      'www.wikidata.org': (u) => u.searchParams.get('action') === 'wbsearchentities'
        ? json({ search: [{ id: 'Q5' }] })
        : json({ entities: { Q5: { id: 'Q5', labels: { en: { value: 'Rare Game' } }, claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q7889' } } } }] } } } }),
    });
    const w = await catalogFallback({ fetch: wdOnly, giantBombKey: null }).any!('rare', 10);
    expect(w).toMatchObject({ catalog: 'wikidata', candidates: [{ externalId: 'wd-Q5', title: 'Rare Game' }] });

    await expect(catalogFallback({ fetch: fake({}), giantBombKey: null }).any!('x', 10)).rejects.toBeInstanceOf(CatalogError);
  });

  it('PS-поиск: PS Store, при сбое — Wikidata только с играми PS5/PS4', async () => {
    const f = fake({
      'www.wikidata.org': (u) => u.searchParams.get('action') === 'wbsearchentities'
        ? json({ search: [{ id: 'Q1' }, { id: 'Q2' }] })
        : json({ entities: {
          Q1: { id: 'Q1', labels: { en: { value: 'Astro Bot' } }, claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q7889' } } } }], P400: [{ mainsnak: { datavalue: { value: { id: 'Q63184502' } } } }] } },
          Q2: { id: 'Q2', labels: { en: { value: 'Astro Switch' } }, claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q7889' } } } }], P400: [{ mainsnak: { datavalue: { value: { id: 'Q19610114' } } } }] } },
        } }),
    });
    const r = await catalogFallback({ fetch: f, giantBombKey: null }).playstation!('astro', 10);
    expect(r).toMatchObject({ catalog: 'wikidata', candidates: [{ externalId: 'wd-Q1', playstation: true }] });
    expect(r.candidates).toHaveLength(1);
    const ok = await catalogFallback({ fetch: fake({ 'web.np.playstation.com': () => json(psBody) }), giantBombKey: null }).playstation!('hades', 10);
    expect(ok.catalog).toBe('psstore');
  });

  it('ключ Giant Bomb: источник добавляется, ключ не попадает в ошибки', async () => {
    const KEY = 'gbSECRETkey12345';
    const f = fake({ 'www.giantbomb.com': () => new Response('', { status: 500 }), 'web.np.playstation.com': () => json(psBody) });
    const r = await catalogFallback({ fetch: f, giantBombKey: KEY }).playstation!('hades', 10);
    expect(r.catalog).toBe('psstore');
    try {
      await catalogFallback({ fetch: fake({}), giantBombKey: KEY }).playstation!('hades', 10);
    } catch (e) {
      expect(String((e as Error).message)).not.toContain(KEY);
    }
  });
});
