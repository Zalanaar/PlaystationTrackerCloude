// «Входящие» (контракт Фазы 28): чистая часть. Окна, недели МСК, часы по снимкам, isEmpty.
import { groupSnapshots, secondsByGame, sumSeconds, type Snapshot } from '@/server/stats/hours';
import { mskDateString, ymd } from '@/server/stats/period';

export type InboxWindow = '24h' | '7d';
const DAY_MS = 86_400_000;

/** Нижняя граница окна (строгая): событие должно быть позже неё и не позже now. */
export const windowSince = (w: InboxWindow, now: Date): Date => new Date(now.getTime() - (w === '24h' ? 1 : 7) * DAY_MS);

export const inWindow = (at: Date | null, since: Date, now: Date): boolean =>
  at !== null && at.getTime() > since.getTime() && at.getTime() <= now.getTime();

/** Считает события по двум окнам; окно 24h, если там > 0, иначе 7d, иначе null. */
export function countByWindow(times: readonly (Date | null)[], now: Date): { h24: number; d7: number; window: InboxWindow | null } {
  const s24 = windowSince('24h', now);
  const s7 = windowSince('7d', now);
  const h24 = times.filter((t) => inWindow(t, s24, now)).length;
  const d7 = times.filter((t) => inWindow(t, s7, now)).length;
  return { h24, d7, window: h24 > 0 ? '24h' : d7 > 0 ? '7d' : null };
}

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export type WeekRanges = { from: string; to: string; prevFrom: string; prevTo: string };

/** Текущая неделя = 7 дат МСК, заканчивающихся сегодня; прошлая = 7 дат перед ней. */
export function weekRanges(now: Date): WeekRanges {
  const to = mskDateString(now);
  return { from: shiftDate(to, -6), to, prevFrom: shiftDate(to, -13), prevTo: shiftDate(to, -7) };
}

export type InboxHours = { hoursWeek: number | null; hoursPrevWeek: number | null; hoursNoHistory: boolean };

const hours2 = (sec: number) => Math.round(sec / 36) / 100;

/**
 * Часы недели и прошлой недели по снимкам (дубли склеены вызывающим). Без снимков: нет истории, оба null.
 * Прошлая неделя null, если первый снимок не раньше её начала (неделя неполная).
 */
export function calcInboxHours(snaps: readonly Snapshot[], firstSnapshotDate: string | null, now: Date): InboxHours {
  if (firstSnapshotDate === null) return { hoursWeek: null, hoursPrevWeek: null, hoursNoHistory: true };
  const r = weekRanges(now);
  const by = groupSnapshots(snaps);
  return {
    hoursWeek: hours2(sumSeconds(secondsByGame(by, r.from, r.to))),
    hoursPrevWeek: firstSnapshotDate < r.prevFrom ? hours2(sumSeconds(secondsByGame(by, r.prevFrom, r.prevTo))) : null,
    hoursNoHistory: false,
  };
}

export type NewGamesPart = { newGames: number; newGamesWindow: InboxWindow | null; newUnsorted: number };
export type TrophiesPart = { trophies: number; platinums: number; trophiesWindow: InboxWindow | null };

export type InboxParts = {
  newGames: NewGamesPart | null;
  trophies: TrophiesPart | null;
  hours: InboxHours | null;
  checkCount: number | null;
  forgottenCount: number | null;
};

export const INBOX_PARTS = ['newGames', 'trophies', 'hours', 'checkCount', 'forgottenCount'] as const;

/** Пусто = все успешно посчитанные части нулевые (упавшие не входят). */
export function isInboxEmpty(d: InboxParts): boolean {
  return (
    (d.newGames?.newGames ?? 0) === 0 &&
    (d.trophies?.trophies ?? 0) === 0 &&
    (d.hours?.hoursWeek ?? 0) <= 0 &&
    (d.checkCount ?? 0) === 0 &&
    (d.forgottenCount ?? 0) === 0
  );
}
