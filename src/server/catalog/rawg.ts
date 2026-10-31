// Единственное место с сетью к RAWG (контракт 17.9). Ключ только из env, в ошибки, логи и ответы не попадает.
// Формат ответа по документации rawg.io/apidocs (GET /api/games?search=): { results: [{ id, name, released, tba, background_image, platforms: [{ platform: { name, slug } }] }] }.
// Вживую без ключа не проверялось: разбор оборонительный, неожиданная форма = bad_response, а не пустая выдача.
import { z } from 'zod';
import { dayNum, dayStr } from '@/server/roadmap/dates';
import { mskDateString } from '@/server/stats/period';

export type CatalogCandidate = {
  externalSource: 'rawg';
  externalId: string;
  title: string;
  releaseDate: string | null;
  coverUrl: string | null;
  platforms: string[];
  playstation: boolean;
};

export type CatalogFailReason = 'no_key' | 'timeout' | 'network' | 'http_error' | 'rate_limited' | 'bad_response';

export class CatalogError extends Error {
  constructor(readonly reason: CatalogFailReason) {
    super(`catalog_${reason}`);
  }
}

export const RAWG_BASE = 'https://api.rawg.io/api/games';
export const RAWG_TIMEOUT_MS = 8000;
export const RAWG_MAX_BYTES = 1_000_000;
export const RAWG_PAGE_SIZE = 10;

export type CatalogDeps = {
  apiKey: string | null;
  /** Инжектируемый fetch для тестов. */
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Только PlayStation: RAWG получает platforms=187,18 (PS5, PS4), фильтр на стороне каталога, а не по 10 результатам. */
  playstationOnly?: boolean;
  /** Вызывается перед каждым реальным запросом (кэш не считается). false = лимит исчерпан, запрос не уходит (контракт 24.2). */
  reserve?: () => Promise<boolean>;
};

/** id платформ RAWG (GET /api/platforms): PlayStation 5 = 187, PlayStation 4 = 18. */
export const RAWG_PLAYSTATION_PLATFORMS = '187,18';

const raw = z.object({
  id: z.union([z.number(), z.string()]),
  name: z.string(),
  released: z.string().nullable().optional(),
  tba: z.boolean().optional(),
  background_image: z.string().nullable().optional(),
  platforms: z.array(z.object({ platform: z.object({ name: z.string(), slug: z.string().optional() }) })).nullable().optional(),
});
const envelope = z.object({ results: z.array(z.unknown()) });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string): boolean => DATE_RE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** Разбор без сортировки (порядок RAWG сохраняется). */
export function parseResults(body: unknown): CatalogCandidate[] {
  const env = envelope.safeParse(body);
  if (!env.success) throw new CatalogError('bad_response');
  const out: CatalogCandidate[] = [];
  for (const item of env.data.results) {
    const r = raw.safeParse(item);
    if (!r.success) continue; // одна кривая запись не ломает остальные
    const g = r.data;
    const title = g.name.trim().slice(0, 200);
    const id = String(g.id).trim();
    if (!title || !id || id.length > 64) continue;
    const slugs = (g.platforms ?? []).map((p) => p.platform.slug ?? '');
    const cover = g.background_image;
    out.push({
      externalSource: 'rawg',
      externalId: id,
      title,
      releaseDate: !g.tba && g.released && validDate(g.released) ? g.released : null,
      coverUrl: cover && cover.startsWith('https://') && cover.length <= 2048 ? cover : null,
      platforms: (g.platforms ?? []).map((p) => p.platform.name),
      playstation: slugs.some((s) => s.startsWith('playstation')),
    });
  }
  return out;
}

export function mapResults(body: unknown): CatalogCandidate[] {
  const out = parseResults(body);
  // Стабильно: PlayStation-версии первыми, внутри групп порядок релевантности RAWG.
  return [...out.filter((c) => c.playstation), ...out.filter((c) => !c.playstation)];
}

/** Один запрос к RAWG: таймаут, лимит размера, разбор JSON. Ошибки только CatalogError без URL и ключа. */
async function requestJson(url: URL, deps: CatalogDeps): Promise<unknown> {
  if (deps.reserve && !(await deps.reserve())) throw new CatalogError('rate_limited');
  const doFetch = deps.fetch ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? RAWG_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await doFetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
    } catch (e) {
      // сообщение исходной ошибки не пробрасываем: оно может содержать URL с ключом
      throw new CatalogError(ctl.signal.aborted || (e instanceof Error && e.name === 'AbortError') ? 'timeout' : 'network');
    }
    if (res.status === 429) throw new CatalogError('rate_limited');
    if (!res.ok) throw new CatalogError('http_error');
    let text: string;
    try {
      text = await res.text();
    } catch {
      throw new CatalogError(ctl.signal.aborted ? 'timeout' : 'network');
    }
    if (text.length > RAWG_MAX_BYTES) throw new CatalogError('bad_response');
    try {
      return JSON.parse(text);
    } catch {
      throw new CatalogError('bad_response');
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function searchCatalog(query: string, deps: CatalogDeps): Promise<CatalogCandidate[]> {
  if (!deps.apiKey) throw new CatalogError('no_key');
  const url = new URL(RAWG_BASE);
  url.searchParams.set('key', deps.apiKey);
  url.searchParams.set('search', query);
  url.searchParams.set('page_size', String(RAWG_PAGE_SIZE));
  if (deps.playstationOnly) url.searchParams.set('platforms', RAWG_PLAYSTATION_PLATFORMS);
  return mapResults(await requestJson(url, deps));
}

// --- предстоящие релизы (контракт 17.13)
export const RAWG_UPCOMING_PAGE_SIZE = 20;
export const RAWG_UPCOMING_DAYS = 365;
export const RAWG_UPCOMING_TTL_MS = 60 * 60 * 1000;

export type UpcomingPage = { candidates: CatalogCandidate[]; page: number; hasMore: boolean };
export type UpcomingCache = Map<string, { at: number; value: UpcomingPage }>;
/** Кэш процесса: ключ = диапазон дат + страница (ключ API не входит). */
const processCache: UpcomingCache = new Map();

export type UpcomingDeps = CatalogDeps & { now?: Date; cache?: UpcomingCache; ttlMs?: number };

const pageEnvelope = z.object({ next: z.string().nullable().optional() });

export async function getUpcoming(page: number, deps: UpcomingDeps): Promise<UpcomingPage> {
  if (!deps.apiKey) throw new CatalogError('no_key');
  const now = deps.now ?? new Date();
  const from = mskDateString(now);
  const to = dayStr(dayNum(from) + RAWG_UPCOMING_DAYS);
  const cache = deps.cache ?? processCache;
  const cacheKey = `${from}|${to}|${page}`;
  const hit = cache.get(cacheKey);
  if (hit && now.getTime() - hit.at < (deps.ttlMs ?? RAWG_UPCOMING_TTL_MS) && now.getTime() >= hit.at) return hit.value;

  const url = new URL(RAWG_BASE);
  url.searchParams.set('key', deps.apiKey);
  url.searchParams.set('dates', `${from},${to}`);
  url.searchParams.set('ordering', 'released');
  url.searchParams.set('platforms', RAWG_PLAYSTATION_PLATFORMS);
  url.searchParams.set('page_size', String(RAWG_UPCOMING_PAGE_SIZE));
  url.searchParams.set('page', String(page));
  const body = await requestJson(url, deps);
  const all = parseResults(body);
  const env = pageEnvelope.safeParse(body);
  const rawCount = (body as { results: unknown[] }).results.length;
  const hasMore = env.success && env.data.next !== undefined ? env.data.next !== null && env.data.next !== '' : rawCount >= RAWG_UPCOMING_PAGE_SIZE;
  const value: UpcomingPage = { candidates: all.filter((c) => c.releaseDate !== null), page, hasMore };
  // Подчищаем протухшее, чтобы Map не рос.
  for (const [k, v] of cache) if (now.getTime() - v.at >= (deps.ttlMs ?? RAWG_UPCOMING_TTL_MS)) cache.delete(k);
  cache.set(cacheKey, { at: now.getTime(), value });
  return value;
}

// --- «У тебя нет» (Фаза 30, контракт «Фаза 30»): каталог лучших PS5/PS4 игр по жанру или общий

export const RAWG_DISCOVER_PAGE_SIZE = 40;
export const RAWG_DISCOVER_MIN_METACRITIC = 75;

export type DiscoverRaw = CatalogCandidate & {
  slug: string | null;
  /** Метки платформ только PS5/PS4 (в таком порядке). */
  psPlatforms: ('PS5' | 'PS4')[];
  /** Слаги жанров RAWG (`action`, `role-playing-games-rpg`...). */
  genreSlugs: string[];
  tagSlugs: string[];
  /** Пользовательский рейтинг RAWG 0..5 или null. */
  rating: number | null;
  metacritic: number | null;
};

export type DiscoverFacet = { kind: 'genres' | 'tags'; slug: string } | null;
export type DiscoverPage = { results: DiscoverRaw[]; hasMore: boolean };

const rawDiscover = raw.extend({
  slug: z.string().nullable().optional(),
  genres: z.array(z.object({ slug: z.string() })).nullable().optional(),
  tags: z.array(z.object({ slug: z.string() })).nullable().optional(),
  rating: z.number().nullable().optional(),
  metacritic: z.number().nullable().optional(),
});

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Разбор страницы выдачи. Кривая запись пропускается, неожиданная форма всей страницы = bad_response. */
export function parseDiscoverPage(body: unknown): DiscoverPage {
  const env = envelope.safeParse(body);
  if (!env.success) throw new CatalogError('bad_response');
  const base = parseResults(body);
  const byId = new Map(base.map((c) => [c.externalId, c]));
  const results: DiscoverRaw[] = [];
  for (const item of env.data.results) {
    const r = rawDiscover.safeParse(item);
    if (!r.success) continue;
    const c = byId.get(String(r.data.id).trim());
    if (!c) continue;
    const slugs = (r.data.platforms ?? []).map((p) => p.platform.slug ?? '');
    const psPlatforms: ('PS5' | 'PS4')[] = [];
    if (slugs.includes('playstation5')) psPlatforms.push('PS5');
    if (slugs.includes('playstation4')) psPlatforms.push('PS4');
    const mc = r.data.metacritic;
    const rt = r.data.rating;
    results.push({
      ...c,
      slug: r.data.slug && SLUG_RE.test(r.data.slug) ? r.data.slug : null,
      psPlatforms,
      genreSlugs: (r.data.genres ?? []).map((g) => g.slug),
      tagSlugs: (r.data.tags ?? []).map((g) => g.slug),
      rating: typeof rt === 'number' && rt > 0 && rt <= 5 ? Math.round(rt * 10) / 10 : null,
      metacritic: typeof mc === 'number' && Number.isInteger(mc) && mc > 0 && mc <= 100 ? mc : null,
    });
  }
  const next = pageEnvelope.safeParse(body);
  const hasMore = next.success && next.data.next !== undefined ? next.data.next !== null && next.data.next !== '' : false;
  return { results, hasMore };
}

/** Одна страница лучших PS5/PS4 игр: жанр или метка (`facet`) либо общий топ (`null`), метакритик не ниже порога, без DLC. */
export async function discoverCatalog(facet: DiscoverFacet, page: number, deps: CatalogDeps): Promise<DiscoverPage> {
  if (!deps.apiKey) throw new CatalogError('no_key');
  const url = new URL(RAWG_BASE);
  url.searchParams.set('key', deps.apiKey);
  url.searchParams.set('platforms', RAWG_PLAYSTATION_PLATFORMS);
  if (facet) {
    if (!SLUG_RE.test(facet.slug)) throw new CatalogError('bad_response');
    url.searchParams.set(facet.kind, facet.slug);
  }
  url.searchParams.set('metacritic', `${RAWG_DISCOVER_MIN_METACRITIC},100`);
  url.searchParams.set('ordering', '-metacritic');
  url.searchParams.set('exclude_additions', 'true');
  url.searchParams.set('page_size', String(RAWG_DISCOVER_PAGE_SIZE));
  url.searchParams.set('page', String(page));
  return parseDiscoverPage(await requestJson(url, deps));
}
