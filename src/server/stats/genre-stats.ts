// Жанры периода: вес игры делится по 1/N между эффективными жанрами (контракт 1.9, 10.1). Чистые функции.
import { GENRE_LABELS_RU, effectiveGenres } from './genres';
import type { StatsGenreItem } from './types';

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
