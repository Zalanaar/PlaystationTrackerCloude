// Прогресс по плану (контракт 17.6): факт часов по снимкам против плана на вчера. Чистая функция.
import { secondsByGame, secondsToHours, sumSeconds } from '@/server/stats/hours';
import { dayNum, dayStr } from './dates';
import { plannedHoursBetween, round1 } from './plan';
import type { Plan, Progress } from './types';

export const PROGRESS_TOLERANCE_HOURS = 2;

export type ProgressInput = {
  plan: Plan;
  /** Сегодня по МСК, YYYY-MM-DD. */
  today: string;
  /** Самая ранняя дата снимка в БД (по всем играм) или null. */
  firstSnapshotDate: string | null;
  /** Снимки по играм за год и по одному базовому снимку до года (как groupSnapshots в статистике). */
  by: Map<number, { date: string; seconds: number }[]>;
  hoursPerWeek: number;
  /** Игры плана: games.id из roadmap_order и бэклога (17.6). Факт и план считаются только по ним. */
  planGameIds: ReadonlySet<number>;
};

const empty = (status: Progress['status'], from: string, asOf: string): Progress => ({
  status,
  from,
  asOf,
  plannedHours: 0,
  actualHours: 0,
  diffHours: 0,
  toleranceHours: PROGRESS_TOLERANCE_HOURS,
  budgetHours: 0,
});

export function computeProgress(i: ProgressInput): Progress | null {
  const { plan, today, firstSnapshotDate } = i;
  if (plan.status !== 'ok') return null;
  const yearFrom = plan.range.from;
  const yearTo = plan.range.to;
  const yesterday = dayStr(dayNum(today) - 1);
  const asOf = yesterday < yearTo ? yesterday : yearTo;
  if (asOf < yearFrom) return empty('not_started', yearFrom, asOf);
  // До первого синка истории часов нет; сам первый снимок только база, поэтому покрытие с дня после него.
  const from = firstSnapshotDate === null ? null : firstSnapshotDate >= yearFrom ? dayStr(dayNum(firstSnapshotDate) + 1) : yearFrom;
  if (from === null || from > asOf) return empty('no_data', from ?? yearFrom, asOf);

  const actualTo = today < yearTo ? today : yearTo;
  const actualHours = secondsToHours(sumSeconds(secondsByGame(new Map([...i.by].filter(([id]) => i.planGameIds.has(id))), from, actualTo)));
  const plannedHours = round1(plannedHoursBetween(plan.items, from, asOf, i.planGameIds));
  const diffHours = round1(actualHours - plannedHours);
  const status = diffHours > PROGRESS_TOLERANCE_HOURS ? 'ahead' : diffHours < -PROGRESS_TOLERANCE_HOURS ? 'behind' : 'onTrack';
  return {
    status,
    from,
    asOf,
    plannedHours,
    actualHours,
    diffHours,
    toleranceHours: PROGRESS_TOLERANCE_HOURS,
    budgetHours: round1((i.hoursPerWeek * (dayNum(asOf) - dayNum(from) + 1)) / 7),
  };
}
