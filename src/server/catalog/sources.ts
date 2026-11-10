// Запасные каталоги (Пакет 7): какой источник отвечает за какой поиск, когда RAWG не ответил.
// Каждый источник независим: свой таймаут, его сбой (или смена неофициального API) не роняет остальные.
//   PS-поиск («Не куплено», подсказки): PlayStation Store -> Giant Bomb (если есть ключ) -> Wikidata (только PS5/PS4).
//   Все платформы («+ Другая платформа»): PlayStation Store + Steam (PC) + Nintendo (Switch) + Microsoft Store (Xbox)
//   [+ Giant Bomb] параллельно; ничего не нашли или все упали -> Wikidata.
import { getGiantBombKey } from '@/server/env';
import type { CatalogFallback } from '@/server/manual/search';
import { rawgBreaker, type CatalogName, type FallbackResult } from './fallback';
import { searchEshop } from './eshop';
import { searchGiantBomb } from './giantbomb';
import { baseTitle, titleKey, type SourceDeps } from './http';
import { searchMsStore } from './msstore';
import { searchPsStore } from './psstore';
import { CatalogError, type CatalogCandidate, type FallbackCatalog } from './rawg';
import { searchSteam } from './steam';
import { searchWikidata } from './wikidata';

export type FallbackSourcesDeps = { fetch?: typeof fetch; timeoutMs?: number; giantBombKey?: string | null };
type Source = { name: FallbackCatalog; search: (q: string, d: SourceDeps) => Promise<CatalogCandidate[]> };

const norm = (s: string) => titleKey(s);
/** Релевантность названия запросу: точное > начинается с > все слова есть > прочее. */
export function relevance(title: string, q: string): number {
  const t = norm(title);
  const n = norm(q);
  if (!n) return 0;
  if (t === n || norm(baseTitle(title)) === n) return 3;
  if (t.startsWith(n)) return 2;
  return n.split(' ').every((w) => t.includes(w)) ? 1 : 0;
}

/** Слияние выдач: по релевантности, затем по месту в своей выдаче; одна игра с разных площадок — одна строка, платформы объединены. */
export function mergeResults(lists: readonly CatalogCandidate[][], q: string, limit: number): CatalogCandidate[] {
  const flat = lists.flatMap((l, src) => l.map((c, pos) => ({ c, pos, src, rel: relevance(c.title, q) })));
  flat.sort((a, b) => b.rel - a.rel || a.pos - b.pos || a.src - b.src);
  const out: CatalogCandidate[] = [];
  const byKey = new Map<string, CatalogCandidate>();
  for (const { c } of flat) {
    const key = norm(baseTitle(c.title));
    const prev = key ? byKey.get(key) : undefined;
    if (prev) {
      prev.platforms = [...new Set([...prev.platforms, ...c.platforms])];
      prev.playstation ||= c.playstation;
      prev.releaseDate ??= c.releaseDate;
      prev.coverUrl ??= c.coverUrl;
      continue;
    }
    if (out.length >= limit) continue;
    const copy = { ...c, platforms: [...c.platforms] };
    out.push(copy);
    if (key) byKey.set(key, copy);
  }
  return out;
}

const catalogOf = (list: readonly CatalogCandidate[], fallback: CatalogName): CatalogName => {
  const set = new Set(list.map((c) => c.catalog ?? 'rawg'));
  return set.size === 0 ? fallback : set.size === 1 ? ([...set][0] as CatalogName) : 'mixed';
};

/** Источники по очереди: первый ответивший непустым; все упали -> CatalogError последней причины; пусто без сбоев -> []. */
async function chain(sources: readonly Source[], q: string, d: SourceDeps, keep: (c: CatalogCandidate) => boolean): Promise<FallbackResult> {
  let err: CatalogError | null = null;
  let answered = false;
  for (const s of sources) {
    try {
      const got = (await s.search(q, d)).filter(keep);
      answered = true;
      if (got.length > 0) return { candidates: got.slice(0, d.limit ?? 10), catalog: s.name };
    } catch (e) {
      err = e instanceof CatalogError ? e : new CatalogError('network');
    }
  }
  if (!answered && err) throw err;
  return { candidates: [], catalog: sources[0]?.name ?? 'psstore' };
}

/** Набор запасных поисков для маршрутов. */
export function catalogFallback(deps: FallbackSourcesDeps = {}): CatalogFallback {
  const gbKey = deps.giantBombKey === undefined ? getGiantBombKey() : deps.giantBombKey;
  const base: SourceDeps = { fetch: deps.fetch, timeoutMs: deps.timeoutMs };
  const gb: Source[] = gbKey ? [{ name: 'giantbomb', search: (q, d) => searchGiantBomb(q, gbKey, d) }] : [];
  const ps: Source = { name: 'psstore', search: searchPsStore };
  const wd: Source = { name: 'wikidata', search: searchWikidata };
  const others: Source[] = [{ name: 'steam', search: searchSteam }, { name: 'eshop', search: searchEshop }, { name: 'msstore', search: searchMsStore }];
  return {
    breaker: rawgBreaker,
    playstation: (q, limit) => chain([ps, ...gb, wd], q, { ...base, limit }, (c) => c.playstation),
    any: async (q, limit) => {
      const parallel = [...gb, ps, ...others];
      const settled = await Promise.allSettled(parallel.map((s) => s.search(q, { ...base, limit })));
      const lists = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
      const merged = mergeResults(lists, q, limit);
      if (merged.length > 0) return { candidates: merged, catalog: catalogOf(merged, 'mixed') };
      // ничего или все упали: последний шанс — Wikidata; если и он упал, а площадки тоже, — ошибка
      try {
        const w = await searchWikidata(q, { ...base, limit });
        return { candidates: w, catalog: 'wikidata' };
      } catch (e) {
        if (lists.length === 0) throw e instanceof CatalogError ? e : new CatalogError('network');
        return { candidates: [], catalog: 'mixed' };
      }
    },
  };
}
