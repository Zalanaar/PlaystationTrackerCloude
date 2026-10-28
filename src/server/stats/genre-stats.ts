// Жанры периода: вес игры делится по 1/N между эффективными жанрами (контракт 1.9, 10.1). Чистые функции.
import { compareTitleId } from '@/server/common/compare';
import { GENRE_LABELS_RU, effectiveGenres } from './genres';
import type { StatsGenreEntry, StatsGenreGame, StatsGenreItem } from './types';

export const GENRES_TOP = 8;

export type GenreGame = { psnGenres: readonly string[] | null; genresOverride: readonly string[] | null };

export function aggregateGenres(list: readonly GenreGame[], top = GENRES_TOP): { hasData: boolean; items: StatsGenreItem[] } {
  if (list.length === 0) return { hasData: false, items: [] };
  const sums = new Map<keyof typeof GENRE_LABELS_RU, number>();
  for (const g of list) {
    const keys = effectiveGenres(g.psnGenres, g.genresOverride);
    const w = 1 / keys.length;
    for (const k of keys) sums.set(k, (sums.get(k) ?? 0) + w);
  }
  const items = [...sums.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, top)
    .map(([key, v]) => ({ key, label: GENRE_LABELS_RU[key], value: Math.round(v * 10) / 10 }));
  return { hasData: true, items };
}

export const GENRE_GAMES_LIMIT = 50;

/** Игра жанровой выборки с данными для словаря `genres.games` (13.1). */
export type GenreGameInfo = GenreGame & { id: number; title: string; coverUrl: string | null; /** секунды игры в периоде (с оценкой), 0 у завершённых без часов */ seconds: number };

/**
 * Жанры с играми (контракт 13.1): те же веса и топ, что у aggregateGenres, плюс `gameIds` каждого жанра
 * (секунды периода по убыванию, lower(title), id; не больше `perGenre`) и словарь `games` по всем попавшим id.
 */
export function aggregateGenresWithGames(
  list: readonly GenreGameInfo[],
  top = GENRES_TOP,
  perGenre = GENRE_GAMES_LIMIT,
): { hasData: boolean; items: StatsGenreEntry[]; games: Record<string, StatsGenreGame> } {
  const base = aggregateGenres(list, top);
  const sorted = [...list].sort((a, b) => b.seconds - a.seconds || compareTitleId(a, b));
  const byGenre = new Map<string, GenreGameInfo[]>();
  for (const g of sorted) {
    for (const k of effectiveGenres(g.psnGenres, g.genresOverride)) {
      const arr = byGenre.get(k) ?? [];
      arr.push(g);
      byGenre.set(k, arr);
    }
  }
  const games: Record<string, StatsGenreGame> = {};
  const items: StatsGenreEntry[] = base.items.map((it: StatsGenreItem) => {
    const picked = (byGenre.get(it.key) ?? []).slice(0, perGenre);
    for (const g of picked) games[String(g.id)] = { id: g.id, title: g.title, coverUrl: g.coverUrl };
    return { ...it, gameIds: picked.map((g) => g.id) };
  });
  return { hasData: base.hasData, items, games };
}
