// Подписи и разбор формы целей месяца.
import { formatNumber, monthName, plural } from '../format';
import { GOAL_LIMITS, type GoalFields, type GoalKey, type GoalProgress } from '@/shared/month-goals';

export { GOAL_LIMITS };
export type { GoalFields, GoalKey, GoalProgress };

export const GOAL_ORDER: readonly GoalKey[] = ['games', 'hours'];

export const GOAL_LABEL: Record<GoalKey, string> = {
  games: 'Игр пройти',
  hours: 'Часов наиграть',
  trophies: 'Трофеев взять',
};

export function monthTitle(monthNum: number): string {
  return monthName(monthNum).toLowerCase();
}

export function progressLine(key: GoalKey, current: number, goal: number): string {
  const cur = formatNumber(key === 'hours' ? Math.round(current) : current);
  const target = formatNumber(goal);
  if (key === 'hours') return `${cur} из ${target} ч`;
  if (key === 'games') return `${cur} из ${target} ${plural(goal, ['игры', 'игр', 'игр'])}`;
  return `${cur} из ${target} ${plural(goal, ['трофея', 'трофеев', 'трофеев'])}`;
}

export function barPercent(current: number, goal: number): number {
  if (goal <= 0) return 0;
  return Math.min(100, Math.round((current / goal) * 100));
}

export function parseField(raw: string, key: GoalKey): { ok: true; value: number | null } | { ok: false } {
  const t = raw.trim();
  if (t === '') return { ok: true, value: null };
  if (!/^\d+$/.test(t)) return { ok: false };
  const n = Number(t);
  if (n < GOAL_LIMITS[key].min || n > GOAL_LIMITS[key].max) return { ok: false };
  return { ok: true, value: n };
}

export function fieldHint(key: GoalKey): string {
  const { min, max } = GOAL_LIMITS[key];
  return `От ${min} до ${formatNumber(max)}. Пусто — без этой цели.`;
}

export function hoursHintLabel(n: number): string {
  return `В среднем ${formatNumber(n)} ч в месяц`;
}
