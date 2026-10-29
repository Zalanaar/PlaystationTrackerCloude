// Профиль вкуса для «Новое от ИИ» (контракт 19.3). Чистая функция: без env, БД, сети и Date.now.
// В Groq уходит ТОЛЬКО результат buildProfile: названия игр библиотеки и RU-подписи жанров. Никаких id, дат, трофеев, service и скрытых.
import { createHash } from 'node:crypto';
import { GENRE_LABELS_RU, type GenreKey } from '@/shared/genres';
import { affinityOf, genreStats, penalized } from './score';
import type { HistoryGame } from './types';

export const PROFILE_TOP_GAMES = 15;
export const PROFILE_RECENT_COMPLETED = 10;
export const PROFILE_DROPPED = 8;
export const PROFILE_TOP_GENRES = 5;
export const PROFILE_NAME_MAX = 80;
/** Шаг округления часов в хэше: игра в процессе не сбрасывает кэш суток из-за пары часов. */
export const PROFILE_HASH_HOURS_STEP = 10;

export type ProfileGame = HistoryGame & {
  name: string;
  /** Только для сортировки «последние completed»; в профиль не попадает. */
  completedAt: Date | null;
};

export type TasteProfile = {
  platform: 'PlayStation';
  topGames: { name: string; hours: number }[];
  recentCompleted: string[];
  dropped: string[];
  favoriteGenres: string[];
  droppedGenres: string[];
};

/**
 * Название из библиотеки попадает в промпт как данные. Убираем управляющие символы и переводы строк, схлопываем пробелы,
 * обрезаем. Остальную защиту от prompt injection даёт системный промпт и JSON-обёртка (название не может выйти из строки).
 */
export function sanitizeName(name: string): string {
  const s = name.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > PROFILE_NAME_MAX ? `${s.slice(0, PROFILE_NAME_MAX - 1).trimEnd()}…` : s;
}

const hoursOf = (g: ProfileGame) => Math.round((g.playSeconds / 3600) * 10) / 10;

export function buildProfile(games: readonly ProfileGame[]): TasteProfile {
  const known = games.filter((g) => g.name.trim() !== '' && (g.status === 'completed' || g.status === 'playing' || g.status === 'dropped'));
  const byId = (a: ProfileGame, b: ProfileGame) => a.id - b.id;

  const topGames = known
    .filter((g) => g.status === 'completed' || g.status === 'playing')
    .sort((a, b) => b.playSeconds - a.playSeconds || byId(a, b))
    .slice(0, PROFILE_TOP_GAMES)
    .map((g) => ({ name: sanitizeName(g.name), hours: hoursOf(g) }));

  const recentCompleted = known
    .filter((g) => g.status === 'completed')
    .sort((a, b) => (b.completedAt?.getTime() ?? -Infinity) - (a.completedAt?.getTime() ?? -Infinity) || byId(a, b))
    .slice(0, PROFILE_RECENT_COMPLETED)
    .map((g) => sanitizeName(g.name));

  const dropped = known
    .filter((g) => g.status === 'dropped')
    .sort((a, b) => b.playSeconds - a.playSeconds || byId(a, b))
    .slice(0, PROFILE_DROPPED)
    .map((g) => sanitizeName(g.name));

  const stats = genreStats(known);
  const maxHours = Math.max(0, ...[...stats.values()].map((s) => s.hours));
  const keys = [...stats.keys()].sort();
  const favoriteGenres = keys
    .map((k) => ({ k, v: affinityOf(stats.get(k), maxHours) }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v || (a.k < b.k ? -1 : 1))
    .slice(0, PROFILE_TOP_GENRES)
    .map((x) => GENRE_LABELS_RU[x.k as GenreKey]);
  const droppedGenres = keys.filter((k) => penalized(stats.get(k))).map((k) => GENRE_LABELS_RU[k as GenreKey]);

  return { platform: 'PlayStation', topGames, recentCompleted, dropped, favoriteGenres, droppedGenres };
}

/** sha256 от округлённого профиля (часы с шагом 10, остальное как есть). */
export function profileHash(p: TasteProfile): string {
  const rounded = { ...p, topGames: p.topGames.map((g) => ({ name: g.name, hours: Math.round(g.hours / PROFILE_HASH_HOURS_STEP) * PROFILE_HASH_HOURS_STEP })) };
  return createHash('sha256').update(JSON.stringify(rounded)).digest('hex').slice(0, 32);
}
