// «У тебя нет» (Фаза 30, контракт «Фаза 30», 30.3): чистые функции отбора и ранжирования кандидатов RAWG.
// Без env, БД, сети и Date.now. Игры выбирает каталог и эти правила, LLM состав не меняет.
import { GENRE_LABELS_RU, type GenreKey } from '@/shared/genres';
import { normalizeGameName } from '@/server/sync/duplicates';
import { normalizeTitle, titleMatches } from './match';
import { sanitizeName } from './profile';
import { affinityOf, genreStats, penalized, type GenreStat } from './score';
import type { HistoryGame } from './types';

export const DISCOVER_LIMIT = 12;
export const STORED_LIMIT = 24;
export const POOL_LIMIT = 120;
export const MAX_FACETS = 3;
export const MIN_PER_FACET = 6;
export const MAX_PAGES_PER_FACET = 3;
export const MIN_METACRITIC = 75;
export const AFFINITY_WEIGHT = 0.6;
export const QUALITY_WEIGHT = 0.4;

/** Запись пула: всё, что нужно для ранжирования и выдачи (хранится в payload). */
export type PoolEntry = {
  externalId: string;
  title: string;
  slug: string | null;
  releaseDate: string | null;
  coverUrl: string | null;
  platforms: ('PS5' | 'PS4')[];
  genres: GenreKey[];
  rating: number | null;
  metacritic: number | null;
};

export type StoredCandidate = PoolEntry & { score: number; reason: { text: string; source: 'llm' | 'template' } };

// --- жанры

/** Фасет запроса RAWG по жанру пользователя. null = в RAWG соответствия нет. */
export const GENRE_FACETS: Readonly<Record<GenreKey, { kind: 'genres' | 'tags'; slug: string } | null>> = {
  ACTION: { kind: 'genres', slug: 'action' },
  ADVENTURE: { kind: 'genres', slug: 'adventure' },
  ROLE_PLAYING_GAMES: { kind: 'genres', slug: 'role-playing-games-rpg' },
  SHOOTER: { kind: 'genres', slug: 'shooter' },
  HORROR: { kind: 'tags', slug: 'horror' },
  RACING: { kind: 'genres', slug: 'racing' },
  SIMULATION: { kind: 'genres', slug: 'simulation' },
  FIGHTING: { kind: 'genres', slug: 'fighting' },
  ARCADE: { kind: 'genres', slug: 'arcade' },
  MUSIC_RHYTHM: null,
  CASUAL: { kind: 'genres', slug: 'casual' },
  STRATEGY: { kind: 'genres', slug: 'strategy' },
  PUZZLE: { kind: 'genres', slug: 'puzzle' },
  FAMILY: { kind: 'genres', slug: 'family' },
  PARTY: null,
  OTHER: null,
};

const RAWG_GENRE_TO_KEY: Readonly<Record<string, GenreKey>> = {
  action: 'ACTION',
  adventure: 'ADVENTURE',
  'role-playing-games-rpg': 'ROLE_PLAYING_GAMES',
  shooter: 'SHOOTER',
  racing: 'RACING',
  simulation: 'SIMULATION',
  fighting: 'FIGHTING',
  arcade: 'ARCADE',
  platformer: 'ARCADE',
  casual: 'CASUAL',
  strategy: 'STRATEGY',
  puzzle: 'PUZZLE',
  family: 'FAMILY',
};

/** Жанры RAWG (и метка horror) -> ключи GenreKey в порядке появления, без повторов. */
export function mapGenres(genreSlugs: readonly string[], tagSlugs: readonly string[] = []): GenreKey[] {
  const out: GenreKey[] = [];
  for (const s of genreSlugs) {
    const k = RAWG_GENRE_TO_KEY[s];
    if (k && !out.includes(k)) out.push(k);
  }
  if (tagSlugs.includes('horror') && !out.includes('HORROR')) out.push('HORROR');
  return out;
}

export type Facet = { id: string; kind: 'genres' | 'tags'; slug: string } | { id: 'all'; kind: null; slug: null };

export const ALL_FACET: Facet = { id: 'all', kind: null, slug: null };

export type TasteModel = { stats: Map<GenreKey, GenreStat>; maxHours: number; affinity: (g: GenreKey) => number };

export function tasteOf(history: readonly HistoryGame[]): TasteModel {
  const stats = genreStats(history);
  const maxHours = Math.max(0, ...[...stats.values()].map((s) => s.hours));
  return { stats, maxHours, affinity: (g) => affinityOf(stats.get(g), maxHours) };
}

/** До 3 любимых жанров (affinity > 0, не «наказаны», есть фасет RAWG) и общий фасет `all` последним. */
export function pickFacets(taste: TasteModel): Facet[] {
  const keys = [...taste.stats.keys()].sort();
  const top = keys
    .map((k) => ({ k, v: taste.affinity(k) }))
    .filter((x) => x.v > 0 && !penalized(taste.stats.get(x.k)) && GENRE_FACETS[x.k] !== null)
    .sort((a, b) => b.v - a.v || (a.k < b.k ? -1 : 1))
    .slice(0, MAX_FACETS);
  const facets: Facet[] = top.map((x) => {
    const f = GENRE_FACETS[x.k]!;
    return { id: `${f.kind}:${f.slug}`, kind: f.kind, slug: f.slug };
  });
  return [...facets, ALL_FACET];
}

// --- библиотека

const EDITION_WORDS = new Set([
  'edition', 'complete', 'definitive', 'deluxe', 'ultimate', 'gold', 'premium', 'standard', 'digital', 'remastered', 'remaster', 'goty',
  'enhanced', 'anniversary', 'collectors', 'collector', 'legendary', 'special', 'director', 'directors', 'cut', 'game', 'of', 'the', 'year',
  'bundle', 'collection', 'version',
]);

/** Ключ для сравнения с библиотекой: без скобок, меток PS4/PS5, слов издания и знаков. «The Witcher 3: Wild Hunt - Complete Edition» = «witcher 3 wild hunt». */
export function libraryKey(name: string): string {
  const base = normalizeGameName(name.replace(/[™®©℠]/g, ' '));
  const norm = normalizeTitle(base);
  const words = norm.split(' ').filter((w) => w !== '');
  // слова издания отбрасываем только с хвоста, чтобы не потерять «of the» внутри названия («Shadow of the Colossus»)
  while (words.length > 1 && EDITION_WORDS.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}

export type LibraryIndex = { keys: Set<string>; titles: string[] };

export function buildLibraryIndex(names: readonly string[]): LibraryIndex {
  const keys = new Set<string>();
  const titles: string[] = [];
  for (const n of names) {
    const k = libraryKey(n);
    if (k) keys.add(k);
    if (normalizeTitle(n)) titles.push(n);
  }
  return { keys, titles };
}

export function inLibrary(title: string, lib: LibraryIndex): boolean {
  const k = libraryKey(title);
  if (k && lib.keys.has(k)) return true;
  return lib.titles.some((t) => titleMatches(title, t));
}

// --- ранжирование

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** null = кандидат отбрасывается (метакритик ниже порога, все известные жанры «наказаны»). */
export function scoreEntry(e: PoolEntry, taste: TasteModel): number | null {
  if (e.metacritic === null || e.metacritic < MIN_METACRITIC) return null;
  const known = e.genres.filter((g) => taste.stats.has(g));
  if (known.length > 0 && known.every((g) => penalized(taste.stats.get(g)))) return null;
  const affinity = e.genres.length ? Math.max(...e.genres.map((g) => taste.affinity(g))) : 0;
  const quality = clamp01((e.metacritic - MIN_METACRITIC) / (100 - MIN_METACRITIC));
  return r6(AFFINITY_WEIGHT * affinity + QUALITY_WEIGHT * quality);
}

export type RankInput = {
  pool: readonly PoolEntry[];
  taste: TasteModel;
  lib: LibraryIndex;
  /** externalId и ключи названий, которые исключаются (Не интересно, активный План). */
  excludedIds: ReadonlySet<string>;
  excludedKeys: ReadonlySet<string>;
  limit?: number;
};

/** Исключения + score + сортировка + схлопывание дублей. Возвращает лучших без причин. */
export function rankPool(input: RankInput): Array<PoolEntry & { score: number }> {
  const out: Array<PoolEntry & { score: number }> = [];
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  for (const e of input.pool) {
    if (seenIds.has(e.externalId) || input.excludedIds.has(e.externalId)) continue;
    const key = libraryKey(e.title);
    if (key && (seenKeys.has(key) || input.excludedKeys.has(key))) continue;
    if (inLibrary(e.title, input.lib)) continue;
    const score = scoreEntry(e, input.taste);
    if (score === null) continue;
    seenIds.add(e.externalId);
    if (key) seenKeys.add(key);
    out.push({ ...e, score });
  }
  out.sort((a, b) => b.score - a.score || (b.metacritic ?? 0) - (a.metacritic ?? 0) || (a.externalId < b.externalId ? -1 : a.externalId > b.externalId ? 1 : 0));
  return out.slice(0, input.limit ?? STORED_LIMIT);
}

// --- причина

export type NamedHistory = HistoryGame & { name: string };

/** До двух игр истории (completed/playing), пересекающихся по жанру с кандидатом, по часам убыв. */
export function similarGames(e: Pick<PoolEntry, 'genres'>, history: readonly NamedHistory[], limit = 2): string[] {
  if (e.genres.length === 0) return [];
  const set = new Set<GenreKey>(e.genres);
  return history
    .filter((h) => (h.status === 'completed' || h.status === 'playing') && h.name.trim() !== '' && h.genres.some((g) => set.has(g)))
    .sort((a, b) => b.playSeconds - a.playSeconds || a.id - b.id)
    .slice(0, limit)
    .map((h) => sanitizeName(h.name));
}

/** Жанр кандидата с наибольшим affinity (при равенстве первый по порядку RAWG). null, если жанров нет. */
export function topGenreOf(e: Pick<PoolEntry, 'genres'>, taste: TasteModel): GenreKey | null {
  let best: GenreKey | null = null;
  let bestV = -Infinity;
  for (const g of e.genres) {
    const v = taste.affinity(g);
    if (v > bestV) {
      best = g;
      bestV = v;
    }
  }
  return best;
}

export function templateReason(e: Pick<PoolEntry, 'genres' | 'metacritic'>, similar: readonly string[], taste: TasteModel): string {
  const g = topGenreOf(e, taste);
  const label = g ? GENRE_LABELS_RU[g] : null;
  if (similar.length >= 2 && label) return `Похожа на «${similar[0]}» и «${similar[1]}», жанр «${label}».`;
  if (similar.length >= 1 && label) return `Похожа на «${similar[0]}», жанр «${label}».`;
  if (similar.length >= 2) return `Похожа на «${similar[0]}» и «${similar[1]}».`;
  if (similar.length === 1) return `Похожа на «${similar[0]}».`;
  const mc = e.metacritic !== null ? `Metacritic ${e.metacritic}` : null;
  if (label && taste.affinity(g!) > 0) return `Жанр «${label}» тебе заходит${mc ? `, ${mc}` : ''}.`;
  return mc ? `Высоко оценена на PlayStation: ${mc}.` : 'Высоко оценена на PlayStation.';
}
