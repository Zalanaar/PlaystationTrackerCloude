import { describe, expect, it } from 'vitest';
import { goalBarPercent, goalForecastText, goalSaveError, goalState, parseGoalCount, type GoalView } from './goal-model';

const g = (p: Partial<GoalView>): GoalView => ({
  mode: 'complete', count: 12, year: 2026, current: 7, target: 12, remaining: 5, pacePerMonth: 0.8, paceEmpty: false, forecast: 8.9, forecastAtYearEnd: 9,
  requiredPerMonth: 2.4, status: 'behind', diff: -3.1, asOf: '2026-11-01', ...p,
});

describe('goal-model (Фаза 32)', () => {
  it('parseGoalCount: границы режимов', () => {
    expect(parseGoalCount('0', 'complete')).toBeNull();
    expect(parseGoalCount('0', 'backlog_to')).toBe(0);
    expect(parseGoalCount('1000', 'complete')).toBe(1000);
    expect(parseGoalCount('1001', 'complete')).toBeNull();
    expect(parseGoalCount('1,5', 'complete')).toBeNull();
    expect(parseGoalCount('', 'complete')).toBeNull();
  });
  it('статус из goal.status и diff', () => {
    expect(goalState(g({})).text).toBe('Отстаю на 3 игры');
    expect(goalState(g({ status: 'ahead', diff: 2.2 })).text).toBe('Опережаю на 2 игры');
    expect(goalState(g({ status: 'onTrack', diff: 0.3 })).text).toBe('Успеваю');
    expect(goalState(g({ status: 'achieved', current: 12 })).kind).toBe('done');
  });
  it('мало данных: paceEmpty или меньше 2 пройденных', () => {
    expect(goalState(g({ paceEmpty: true, current: 0 })).kind).toBe('no_data');
    expect(goalState(g({ current: 1, pacePerMonth: 0.1 })).kind).toBe('no_data');
  });
  it('прошлый и будущий год', () => {
    expect(goalState(g({ year: 2025, current: 9 })).text).toBe('Итог 2025: пройдено 9 из 12');
    expect(goalState(g({ year: 2027, status: 'not_started', diff: 0 })).kind).toBe('future_year');
  });
  it('полоса: complete current/N; backlog_to N/current', () => {
    expect(goalBarPercent({ mode: 'complete', count: 12, current: 3 })).toBe(25);
    expect(goalBarPercent({ mode: 'backlog_to', count: 10, current: 40 })).toBe(25);
    expect(goalBarPercent({ mode: 'backlog_to', count: 10, current: 8 })).toBe(100);
    expect(goalForecastText(g({}))).toContain('≈ 9 игр');
  });
  it('409 = сначала настройки', () => {
    expect(goalSaveError(409, 'settings_required').settings).toBe(true);
  });
});
