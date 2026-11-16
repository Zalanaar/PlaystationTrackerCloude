// П11.1 «Дневник дня» (контракт «П11. Дневник дня»): игры, трофеи и завершения одного дня МСК. Типы и разбор query, без БД.
import type { TrophyType } from '@/server/trophies/types';

export type DayGame = { id: number; title: string; coverUrl: string | null; /** минуты по снимкам, ≥ 1 */ minutes: number };
export type DayTrophy = { id: number; type: TrophyType; name: string | null; iconUrl: string | null; game: { id: number; title: string } | null };
export type DayFinished = { id: number; title: string; coverUrl: string | null; kind: 'completed' | 'dropped' };
export type DayTrophyCounts = { platinum: number; gold: number; silver: number; bronze: number; total: number };

export type DayResponse = {
  date: string;
  today: string;
  /** у дня есть дельта снимков (известный день); false = до первого синка, пропуск синка или будущее */
  known: boolean;
  minutes: number;
  games: DayGame[];
  trophies: { counts: DayTrophyCounts; items: DayTrophy[] };
  finished: DayFinished[];
  /** соседние игровые дни (минуты > 0), next не позже сегодня; null = нет */
  prev: string | null;
  next: string | null;
};

/** Сколько трофеев дня отдаётся строками (счётчики — все). */
export const DAY_TROPHIES_MAX = 30;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** YYYY-MM-DD реальной даты 2000..2100. */
export function parseDayDate(raw: string | null): string | null {
  const m = raw ? DATE_RE.exec(raw) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return null;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? raw : null;
}

export const secondsToMinutes = (sec: number) => (sec > 0 ? Math.max(1, Math.round(sec / 60)) : 0);
