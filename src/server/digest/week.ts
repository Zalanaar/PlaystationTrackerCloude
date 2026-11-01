// Недели сводки (контракт F29.2, F29.5): пн..вс по календарной дате МСК. Чистые функции.
import { dayNumber, fromDayNumber, weekStartOf } from '@/shared/week';
import { mskDate, mskDateString, mskMidnightUtc } from '@/server/stats/period';

export type DigestWeek = {
  /** Понедельник и воскресенье, YYYY-MM-DD (МСК). */
  from: string;
  to: string;
  /** [fromUtc, toUtc): полночь МСК понедельника и полночь МСК следующего понедельника. */
  fromUtc: Date;
  toUtc: Date;
  prevFrom: string;
  prevTo: string;
  nextFrom: string;
  nextTo: string;
};

export const addDays = (date: string, days: number): string => fromDayNumber(dayNumber(date) + days);

const utcOf = (date: string): Date => {
  const [y, m, d] = date.split('-').map(Number);
  return mskMidnightUtc(y, m, d);
};

/** Неделя по её понедельнику. */
export function weekByMonday(monday: string): DigestWeek {
  return {
    from: monday,
    to: addDays(monday, 6),
    fromUtc: utcOf(monday),
    toUtc: utcOf(addDays(monday, 7)),
    prevFrom: addDays(monday, -7),
    prevTo: addDays(monday, -1),
    nextFrom: addDays(monday, 7),
    nextTo: addDays(monday, 13),
  };
}

/** Неделя, содержащая момент `at` (по МСК). */
export const weekOf = (at: Date): DigestWeek => weekByMonday(weekStartOf(mskDateString(at)));

/** День недели МСК: 0 = воскресенье. */
export function mskWeekday(at: Date): number {
  const { year, month, day } = mskDate(at);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export type DigestTarget = { week: DigestWeek; catchUp: boolean };

/**
 * Какую неделю сводить сейчас. Воскресенье МСК: текущая. Понедельник МСК: догоняющий запуск за прошлую (catchUp).
 * Другие дни: null. force: неделя, содержащая now (ручной запуск).
 */
export function digestTarget(now: Date, force = false): DigestTarget | null {
  const dow = mskWeekday(now);
  if (force) return { week: weekOf(now), catchUp: false };
  if (dow === 0) return { week: weekOf(now), catchUp: false };
  if (dow === 1) return { week: weekByMonday(addDays(weekStartOf(mskDateString(now)), -7)), catchUp: true };
  return null;
}

/** Ключ дедупа notify_log (F29.4). */
export const digestKind = (userId: number, monday: string): string => `digest:${userId}:${monday}`;
export const DIGEST_KIND_PREFIX = 'digest:';
