// Идея 6 (аудит UX): экран «Мои оценки» — распределение 0–10, оценка против часов, лучшие жанры, пройденные без оценки.
// Чистые функции над списком игр (/api/games), без DOM и React.
import type { GameItem } from '@/server/collection/types';
import { formatHoursApprox } from '../format';

export type Rated = GameItem & { rating: number };

export const isRated = (g: GameItem): g is Rated => typeof g.rating === 'number';

/** «7,4» — одна цифра после запятой. */
export const avgText = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');

/** Сколько игр на каждую оценку 0..10 (индекс = оценка). */
export function distribution(rated: readonly Rated[]): number[] {
  const out = Array.from({ length: 11 }, () => 0);
  for (const g of rated) if (g.rating >= 0 && g.rating <= 10) out[Math.round(g.rating)] += 1;
  return out;
}

export function average(rated: readonly Rated[]): number | null {
  return rated.length ? rated.reduce((s, g) => s + g.rating, 0) / rated.length : null;
}

export type Band = { label: string; from: number; to: number; count: number; medianHours: number | null };
const BANDS: readonly [string, number, number][] = [['0–4', 0, 4], ['5–6', 5, 6], ['7–8', 7, 8], ['9–10', 9, 10]];

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Оценка против часов: медиана наигранного по группам оценок (игры без часов не учитываются). */
export function hoursByBand(rated: readonly Rated[]): Band[] {
  return BANDS.map(([label, from, to]) => {
    const inBand = rated.filter((g) => g.rating >= from && g.rating <= to);
    return { label, from, to, count: inBand.length, medianHours: median(inBand.filter((g) => g.hours > 0).map((g) => g.hours)) };
  });
}

export const bandHoursText = (b: Band) => (b.medianHours === null ? '—' : formatHoursApprox(b.medianHours));

export type GenreScore = { key: string; label: string; avg: number; count: number };

/** Лучшие жанры: средняя оценка по жанру, не меньше `min` оценённых игр; по убыванию средней, затем по числу. */
export function topGenres(rated: readonly Rated[], min = 2, limit = 5): GenreScore[] {
  const by = new Map<string, { label: string; sum: number; count: number }>();
  for (const g of rated) {
    for (const ge of g.genres ?? []) {
      const x = by.get(ge.key) ?? { label: ge.label, sum: 0, count: 0 };
      x.sum += g.rating;
      x.count += 1;
      by.set(ge.key, x);
    }
  }
  return [...by.entries()]
    .filter(([, x]) => x.count >= min)
    .map(([key, x]) => ({ key, label: x.label, avg: x.sum / x.count, count: x.count }))
    .sort((a, b) => b.avg - a.avg || b.count - a.count || a.label.localeCompare(b.label, 'ru'))
    .slice(0, limit);
}

/** Пройденные без оценки: сначала недавно пройденные. */
export function completedUnrated(games: readonly GameItem[]): GameItem[] {
  return games
    .filter((g) => g.status === 'completed' && !isRated(g))
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '') || a.id - b.id);
}
