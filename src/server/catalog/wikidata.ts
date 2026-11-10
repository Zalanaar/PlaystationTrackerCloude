// Последний запасной каталог для любой платформы: Wikidata (без ключа). Поиск: wbsearchentities + wbgetentities,
// только элементы «видеоигра» (P31 = Q7889). Подборка «У тебя нет»: один SPARQL-запрос заметных игр PS5/PS4 (см. discoverWikidata).
import { z } from 'zod';
import { CatalogError, type CatalogCandidate } from './rawg';
import { cleanTitle, fetchJson, titleKey, USER_AGENT, type SourceDeps } from './http';

export const VIDEO_GAME = 'Q7889';
/** Платформы Wikidata -> подписи как у RAWG (по ним узнаются чипы Switch/Xbox/PC и PS5/PS4). */
export const WD_PLATFORMS: Readonly<Record<string, string>> = {
  Q63184502: 'PlayStation 5', Q5014725: 'PlayStation 4', Q10683: 'PlayStation 3',
  Q19610114: 'Nintendo Switch', Q122761124: 'Nintendo Switch 2',
  Q13361286: 'Xbox One', Q98973368: 'Xbox Series X|S', Q48263: 'Xbox 360',
  Q1406: 'PC', Q16338: 'PC', Q14116: 'macOS', Q388: 'Linux',
};
const API = 'https://www.wikidata.org/w/api.php';
const HEADERS = { Accept: 'application/json', 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT };
const QID = /^Q\d{1,12}$/;

const searchEnv = z.object({ search: z.array(z.unknown()) });
const hit = z.object({ id: z.string() });
const snak = z.object({ mainsnak: z.object({ datavalue: z.object({ value: z.unknown() }).optional() }) }).passthrough();
const entity = z.object({
  id: z.string(),
  labels: z.record(z.string(), z.object({ value: z.string() })).optional(),
  claims: z.record(z.string(), z.array(z.unknown())).optional(),
});
const entitiesEnv = z.object({ entities: z.record(z.string(), z.unknown()) });

const values = (claims: Record<string, unknown[]> | undefined, prop: string): unknown[] =>
  (claims?.[prop] ?? []).flatMap((c) => {
    const r = snak.safeParse(c);
    return r.success && r.data.mainsnak.datavalue ? [r.data.mainsnak.datavalue.value] : [];
  });
const itemIds = (claims: Record<string, unknown[]> | undefined, prop: string): string[] =>
  values(claims, prop).flatMap((v) => {
    const id = (v as { id?: unknown } | null)?.id;
    return typeof id === 'string' && QID.test(id) ? [id] : [];
  });
/** P577: самая ранняя дата с точностью до дня (precision 11); иначе null. */
function firstDate(claims: Record<string, unknown[]> | undefined): string | null {
  const days = values(claims, 'P577').flatMap((v) => {
    const o = v as { time?: unknown; precision?: unknown } | null;
    if (typeof o?.time !== 'string' || o.precision !== 11) return [];
    const m = /^\+(\d{4}-\d{2}-\d{2})T/.exec(o.time);
    return m ? [m[1]] : [];
  });
  return days.sort()[0] ?? null;
}

export function parseEntities(body: unknown, order: readonly string[], limit = 10): CatalogCandidate[] {
  const env = entitiesEnv.safeParse(body);
  if (!env.success) throw new CatalogError('bad_response');
  const out: CatalogCandidate[] = [];
  const seen = new Set<string>();
  for (const id of order) {
    const r = entity.safeParse(env.data.entities[id]);
    if (!r.success || !QID.test(r.data.id)) continue;
    if (!itemIds(r.data.claims, 'P31').includes(VIDEO_GAME)) continue;
    const label = r.data.labels?.en?.value ?? r.data.labels?.mul?.value;
    const title = label ? cleanTitle(label) : '';
    const key = titleKey(title);
    if (!title || !key || seen.has(key)) continue;
    seen.add(key);
    const platforms = [...new Set(itemIds(r.data.claims, 'P400').flatMap((p) => (WD_PLATFORMS[p] ? [WD_PLATFORMS[p]] : [])))];
    out.push({
      externalSource: 'rawg', externalId: `wd-${r.data.id}`, title, releaseDate: firstDate(r.data.claims), coverUrl: null,
      platforms, playstation: platforms.some((p) => /^PlayStation [45]$/.test(p)), catalog: 'wikidata',
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function searchWikidata(query: string, deps: SourceDeps = {}): Promise<CatalogCandidate[]> {
  const s = new URL(API);
  for (const [k, v] of Object.entries({ action: 'wbsearchentities', search: query, language: 'en', uselang: 'en', type: 'item', limit: '20', format: 'json', origin: '*' })) s.searchParams.set(k, v);
  const found = searchEnv.safeParse(await fetchJson(s, { headers: HEADERS }, deps));
  if (!found.success) throw new CatalogError('bad_response');
  const ids = found.data.search.flatMap((h) => {
    const r = hit.safeParse(h);
    return r.success && QID.test(r.data.id) ? [r.data.id] : [];
  });
  if (ids.length === 0) return [];
  const g = new URL(API);
  for (const [k, v] of Object.entries({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels|claims', languages: 'en|mul', format: 'json', origin: '*' })) g.searchParams.set(k, v);
  return parseEntities(await fetchJson(g, { headers: HEADERS }, deps), ids, deps.limit ?? 10);
}

// --- подборка «У тебя нет» без RAWG (Пакет 7)

/** Жанры Wikidata -> слаги жанров RAWG (по ним работают фасеты и mapGenres). 'horror' — метка (tagSlugs). */
export const WD_GENRES: Readonly<Record<string, readonly string[]>> = {
  Q23916: ['adventure'], Q270948: ['action'], Q343568: ['action', 'adventure'], Q744038: ['role-playing-games-rpg'],
  Q1610017: ['simulation'], Q1050023: ['casual'], Q1422746: ['action', 'role-playing-games-rpg'], Q828322: ['platformer'],
  Q472055: ['strategy'], Q54767: ['puzzle'], Q185029: ['shooter'], Q860750: ['racing'], Q333967: ['horror', 'action'],
  Q380266: ['shooter'], Q19643088: ['platformer', 'action'], Q11338014: ['horror'], Q1044478: ['shooter', 'arcade'],
  Q858523: ['action'], Q1529437: ['role-playing-games-rpg', 'strategy'], Q4282636: ['shooter'], Q846224: ['fighting'],
  Q401831: ['action'], Q1163960: ['action'], Q15613992: ['arcade'], Q125693245: ['action'], Q5923834: ['role-playing-games-rpg'],
  Q2176159: ['strategy'], Q105906396: ['role-playing-games-rpg'], Q208189: ['strategy'], Q1198141: ['simulation'],
  Q62591185: ['puzzle', 'platformer'], Q1137896: ['strategy'], Q588289: ['simulation', 'strategy'], Q116790414: ['platformer'],
  Q116790461: ['platformer'], Q1265717: ['role-playing-games-rpg'], Q105475134: ['action', 'role-playing-games-rpg'],
  Q4375640: ['strategy'], Q1199309: ['simulation'], Q111149309: ['simulation'], Q11590806: ['adventure'], Q2628513: ['adventure'],
  Q689445: ['adventure'],
};
export const WD_PS = { Q63184502: 'PS5', Q5014725: 'PS4' } as const;
/** Порог заметности: число статей в разделах Википедии (sitelinks). Ниже — игра слишком малоизвестна для подсказки. */
export const WD_NOTABLE_MIN = 15;
export const WD_SPARQL_TIMEOUT_MS = 20_000;

export type WdNotable = {
  externalId: string; title: string; releaseDate: string | null; psPlatforms: ('PS5' | 'PS4')[];
  genreSlugs: string[]; tagSlugs: string[]; metacritic: number | null; notability: number;
};

export const WD_SPARQL = `SELECT ?game (SAMPLE(?label) AS ?title) (MIN(?date) AS ?released) (SAMPLE(?links) AS ?sl)
(GROUP_CONCAT(DISTINCT STRAFTER(STR(?plat), "entity/"); separator=",") AS ?plats)
(GROUP_CONCAT(DISTINCT STRAFTER(STR(?genre), "entity/"); separator=",") AS ?genres) (MAX(?score) AS ?mc) WHERE {
  VALUES ?plat { wd:Q63184502 wd:Q5014725 }
  ?game wdt:P31 wd:Q7889; wdt:P400 ?plat; wikibase:sitelinks ?links.
  FILTER(?links >= ${WD_NOTABLE_MIN})
  ?game rdfs:label ?label. FILTER(LANG(?label) IN ("en", "mul"))
  OPTIONAL { ?game wdt:P577 ?date. }
  OPTIONAL { ?game wdt:P136 ?genre. }
  OPTIONAL { ?game p:P444 ?rs. ?rs ps:P444 ?score; pq:P447 wd:Q150248. }
} GROUP BY ?game`;

const lit = z.object({ value: z.string() });
const row = z.object({ game: lit, title: lit, released: lit.optional(), sl: lit, plats: lit.optional(), genres: lit.optional(), mc: lit.optional() });
const sparqlEnv = z.object({ results: z.object({ bindings: z.array(z.unknown()) }) });

/** «85/100», «85/100 (Generally favorable)», «85» -> 85; иное -> null. */
export function parseScore(s: string | undefined): number | null {
  const m = s ? /^\s*(\d{1,3})(?:\s*\/\s*100)?\b/.exec(s) : null;
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 100 ? n : null;
}

export function parseNotable(body: unknown): WdNotable[] {
  const env = sparqlEnv.safeParse(body);
  if (!env.success) throw new CatalogError('bad_response');
  const out: WdNotable[] = [];
  for (const raw of env.data.results.bindings) {
    const r = row.safeParse(raw);
    if (!r.success) continue;
    const qid = /\/(Q\d{1,12})$/.exec(r.data.game.value)?.[1];
    const title = cleanTitle(r.data.title.value);
    if (!qid || !title || QID.test(title)) continue;
    const plats = (r.data.plats?.value ?? '').split(',');
    const psPlatforms = (['Q63184502', 'Q5014725'] as const).filter((q) => plats.includes(q)).map((q) => WD_PS[q]);
    if (psPlatforms.length === 0) continue;
    const slugs = [...new Set((r.data.genres?.value ?? '').split(',').flatMap((g) => WD_GENRES[g] ?? []))];
    const notability = Number(r.data.sl.value);
    const day = r.data.released?.value ? /^(\d{4}-\d{2}-\d{2})T/.exec(r.data.released.value)?.[1] ?? null : null;
    out.push({
      externalId: `wd-${qid}`, title, releaseDate: day, psPlatforms,
      genreSlugs: slugs.filter((s) => s !== 'horror'), tagSlugs: slugs.includes('horror') ? ['horror'] : [],
      metacritic: parseScore(r.data.mc?.value), notability: Number.isFinite(notability) ? notability : 0,
    });
  }
  return out;
}

type NotableCache = { at: number; value: WdNotable[] } | null;
let notableCache: NotableCache = null;
export const WD_NOTABLE_TTL_MS = 12 * 3600_000;
export const resetNotableCache = () => { notableCache = null; };

/** Заметные игры PS5/PS4 из Wikidata одним SPARQL-запросом; кэш процесса 12 ч (общий для всех профилей, данные публичные). */
export async function fetchNotablePs(deps: SourceDeps & { now?: number } = {}): Promise<WdNotable[]> {
  const now = deps.now ?? Date.now();
  if (notableCache && now - notableCache.at < WD_NOTABLE_TTL_MS) return notableCache.value;
  const url = new URL('https://query.wikidata.org/sparql');
  const body = await fetchJson(
    url,
    {
      method: 'POST',
      headers: { Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
      body: new URLSearchParams({ query: WD_SPARQL }).toString(),
    },
    { ...deps, timeoutMs: deps.timeoutMs ?? WD_SPARQL_TIMEOUT_MS },
    8_000_000,
  );
  const value = parseNotable(body);
  if (value.length === 0) throw new CatalogError('bad_response');
  notableCache = { at: now, value };
  return value;
}
