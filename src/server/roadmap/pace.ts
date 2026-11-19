// Пакет 6, п. 11: прогноз бэклога. F4 (аудит UX): темп по 90 дням, не меньше 30 дней истории, плюс вариант по бюджету плана. Чистая функция, без БД.
import { gameSecondsInRange } from '@/server/stats/hours';
import { dayNum, dayStr } from './dates';
import { round1 } from './plan';

export const PACE_DAYS = 90;
/** F4: меньше 30 дней истории часов — прогноз по факту не показываем (23 дня дали «2050 год»). */
export const PACE_MIN_DAYS = 30;

export type BacklogPaceStatus = 'ok' | 'empty' | 'no_hours' | 'no_data' | 'no_pace';

export type BacklogPace = {
  status: BacklogPaceStatus;
  /** Окно темпа (МСК, включительно): последние 4 недели по сегодня; короче, если история часов моложе. */
  from: string;
  to: string;
  days: number;
  /** Сыграно за окно во всех видимых играх, кроме сервисов. */
  playedHours: number;
  hoursPerWeek: number;
  /** Игр в бэклоге и сколько из них без длительности (не входят в часы). */
  games: number;
  unknownGames: number;
  /** Остаток часов бэклога (как в плане: длительность минус сыграно). */
  backlogHours: number;
  /** Недель до конца бэклога в этом темпе и дата (МСК); null, если не считается. */
  weeks: number | null;
  closeDate: string | null;
  /** F4: тот же остаток по бюджету плана (ч/нед из настроек); null — бюджета нет или считать нечего. */
  budgetHoursPerWeek?: number | null;
  budgetWeeks?: number | null;
  budgetCloseDate?: string | null;
};

export type PaceInput = {
  today: string;
  firstSnapshotDate: string | null;
  /** Снимки по играм (отсортированы), уже без сервисов и скрытых. */
  by: Map<number, { date: string; seconds: number }[]>;
  /** Остатки часов игр бэклога; null = длительность неизвестна. */
  backlog: readonly (number | null)[];
};

export function computeBacklogPace(i: PaceInput): BacklogPace {
  const to = i.today;
  const windowFrom = dayStr(dayNum(to) - (PACE_DAYS - 1));
  // первый снимок — только база, часы считаются со следующего дня (как в «Прогрессе»)
  const coveredFrom = i.firstSnapshotDate === null ? null : dayStr(dayNum(i.firstSnapshotDate) + 1);
  const from = coveredFrom !== null && coveredFrom > windowFrom ? coveredFrom : windowFrom;
  const days = Math.max(0, dayNum(to) - dayNum(from) + 1);
  const known = i.backlog.filter((h): h is number => h !== null);
  const games = i.backlog.length;
  const unknownGames = games - known.length;
  const backlogHours = round1(known.reduce((a, h) => a + Math.max(0, h), 0));
  let sec = 0;
  if (coveredFrom !== null && days > 0) for (const arr of i.by.values()) sec += gameSecondsInRange(arr, from, to);
  const playedHours = round1(sec / 3600);
  const hoursPerWeek = days > 0 ? round1((playedHours / days) * 7) : 0;
  const base = { from, to, days, playedHours, hoursPerWeek, games, unknownGames, backlogHours, weeks: null, closeDate: null };
  if (games === 0) return { ...base, status: 'empty' };
  if (backlogHours <= 0) return { ...base, status: 'no_hours' };
  if (coveredFrom === null || days < PACE_MIN_DAYS) return { ...base, status: 'no_data' };
  if (playedHours <= 0) return { ...base, status: 'no_pace' };
  const perDay = playedHours / days;
  const daysLeft = Math.ceil(backlogHours / perDay);
  return { ...base, status: 'ok', weeks: round1(backlogHours / (perDay * 7)), closeDate: dayStr(dayNum(to) + daysLeft) };
}

/** F4: дата конца бэклога по бюджету плана (часов в неделю из настроек «Плана»). */
export function withBudget(p: BacklogPace, hoursPerWeek: number | null | undefined): BacklogPace {
  const ok = typeof hoursPerWeek === 'number' && Number.isFinite(hoursPerWeek) && hoursPerWeek > 0 && p.backlogHours > 0;
  if (!ok) return { ...p, budgetHoursPerWeek: null, budgetWeeks: null, budgetCloseDate: null };
  const perDay = hoursPerWeek / 7;
  return { ...p, budgetHoursPerWeek: hoursPerWeek, budgetWeeks: round1(p.backlogHours / hoursPerWeek), budgetCloseDate: dayStr(dayNum(p.to) + Math.ceil(p.backlogHours / perDay)) };
}
