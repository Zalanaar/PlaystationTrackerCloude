// Цель года в штуках и прогноз по темпу completed_at (контракт 17.3a, Фаза 32, N2). Чистые функции: без env, БД и сети.
import { dayNum, yearBounds } from './dates';

export const GOAL_MODES = ['complete', 'backlog_to'] as const;
export type GoalMode = (typeof GOAL_MODES)[number];
export const GOAL_MAX = 1000;
/** Допуск «на курсе», игр: |diff| < 1. */
export const GOAL_TOLERANCE = 1;
const DAYS_PER_MONTH = 30.44;

export type GoalStatus = 'achieved' | 'ahead' | 'onTrack' | 'behind' | 'not_started';

export type GoalView = {
  mode: GoalMode;
  count: number;
  year: number;
  current: number;
  target: number;
  remaining: number;
  pacePerMonth: number;
  paceEmpty: boolean;
  forecast: number;
  forecastAtYearEnd: number;
  requiredPerMonth: number;
  status: GoalStatus;
  diff: number;
  asOf: string;
};

const r1 = (n: number): number => Math.round(n * 10) / 10;

export type GoalInput = {
  mode: GoalMode;
  count: number;
  year: number;
  /** Сегодня МСК, YYYY-MM-DD. */
  today: string;
  /** Завершённые в году игры (по completed_at МСК). */
  completedInYear: number;
  /** Игр в бэклоге сейчас (нужно для backlog_to). */
  backlogNow: number;
};

export function computeGoal(i: GoalInput): GoalView {
  const { from, to, days } = yearBounds(i.year);
  const todayN = dayNum(i.today);
  const fromN = dayNum(from);
  const toN = dayNum(to);
  const elapsed = Math.min(days, Math.max(0, todayN - fromN + 1));
  const daysLeft = Math.max(0, toN - todayN);
  const done = Math.max(0, i.completedInYear);
  const current = i.mode === 'complete' ? done : Math.max(0, i.backlogNow);
  const remaining = i.mode === 'complete' ? Math.max(0, i.count - current) : Math.max(0, current - i.count);

  const perDay = elapsed > 0 ? done / elapsed : 0;
  const paceEmpty = done === 0;
  const projected = perDay * daysLeft;
  const forecastRaw = i.mode === 'complete' ? current + projected : Math.max(0, current - projected);
  const achieved = i.mode === 'complete' ? current >= i.count : current <= i.count;
  const diffRaw = i.mode === 'complete' ? forecastRaw - i.count : i.count - forecastRaw;

  let status: GoalStatus;
  if (elapsed === 0) status = 'not_started';
  else if (achieved) status = 'achieved';
  else if (diffRaw >= GOAL_TOLERANCE) status = 'ahead';
  else if (diffRaw <= -GOAL_TOLERANCE) status = 'behind';
  else status = 'onTrack';

  return {
    mode: i.mode,
    count: i.count,
    year: i.year,
    current,
    target: i.count,
    remaining,
    pacePerMonth: r1(perDay * DAYS_PER_MONTH),
    paceEmpty,
    forecast: r1(forecastRaw),
    forecastAtYearEnd: i.mode === 'complete' ? Math.floor(forecastRaw + 1e-9) : Math.ceil(forecastRaw - 1e-9),
    requiredPerMonth: status === 'achieved' || daysLeft === 0 ? 0 : r1((remaining / daysLeft) * DAYS_PER_MONTH),
    status,
    diff: status === 'not_started' ? 0 : r1(diffRaw),
    asOf: i.today,
  };
}
