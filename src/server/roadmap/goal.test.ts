import { describe, expect, it } from 'vitest';
import { computeGoal, type GoalInput } from './goal';

const base: GoalInput = { mode: 'complete', count: 12, year: 2026, today: '2026-07-01', completedInYear: 6, backlogNow: 30 };

describe('computeGoal: пройти N', () => {
  it('темп 6 игр за 182 дня даёт прогноз ~12 на конец года, на курсе', () => {
    const g = computeGoal(base);
    expect(g.current).toBe(6);
    expect(g.remaining).toBe(6);
    expect(g.pacePerMonth).toBe(1);
    expect(g.forecast).toBeCloseTo(12.0, 0);
    expect(g.status).toBe('onTrack');
  });
  it('медленнее: отстаю', () => {
    const g = computeGoal({ ...base, completedInYear: 2 });
    expect(g.status).toBe('behind');
    expect(g.diff).toBeLessThanOrEqual(-1);
    expect(g.forecastAtYearEnd).toBe(Math.floor(g.forecast));
    expect(g.requiredPerMonth).toBeGreaterThan(g.pacePerMonth);
  });
  it('быстрее: опережаю', () => {
    const g = computeGoal({ ...base, completedInYear: 10 });
    expect(g.status).toBe('ahead');
    expect(g.diff).toBeGreaterThanOrEqual(1);
  });
  it('цель выполнена: achieved, требуемый темп 0', () => {
    const g = computeGoal({ ...base, completedInYear: 12 });
    expect(g.status).toBe('achieved');
    expect(g.remaining).toBe(0);
    expect(g.requiredPerMonth).toBe(0);
  });
  it('пустой темп: нет завершений, прогноз = текущее, без экстраполяции', () => {
    const g = computeGoal({ ...base, completedInYear: 0 });
    expect(g.paceEmpty).toBe(true);
    expect(g.pacePerMonth).toBe(0);
    expect(g.forecast).toBe(0);
    expect(g.status).toBe('behind');
    expect(g.requiredPerMonth).toBeGreaterThan(0);
  });
  it('1 января: день 1 учтён, деления на ноль нет', () => {
    const g = computeGoal({ ...base, today: '2026-01-01', completedInYear: 1 });
    expect(Number.isFinite(g.forecast)).toBe(true);
    expect(g.pacePerMonth).toBeGreaterThan(0);
  });
  it('31 декабря: осталось 0 дней, прогноз = текущее', () => {
    const g = computeGoal({ ...base, today: '2026-12-31', completedInYear: 8 });
    expect(g.forecast).toBe(8);
    expect(g.status).toBe('behind');
    expect(g.requiredPerMonth).toBe(0);
  });
  it('прошедший год: прогноз = текущее, achieved или behind', () => {
    expect(computeGoal({ ...base, year: 2025, completedInYear: 12 }).status).toBe('achieved');
    expect(computeGoal({ ...base, year: 2025, completedInYear: 5 }).status).toBe('behind');
  });
  it('будущий год: not_started', () => {
    const g = computeGoal({ ...base, year: 2027, completedInYear: 0 });
    expect(g.status).toBe('not_started');
    expect(g.diff).toBe(0);
  });
});

describe('computeGoal: бэклог до N', () => {
  const b: GoalInput = { ...base, mode: 'backlog_to', count: 10, backlogNow: 30, completedInYear: 6 };
  it('current = бэклог сейчас, remaining = лишние игры', () => {
    const g = computeGoal(b);
    expect(g.current).toBe(30);
    expect(g.remaining).toBe(20);
    expect(g.pacePerMonth).toBe(1);
  });
  it('темп 1 игра/мес: к концу года бэклог ~24, цель 10 недостижима: behind', () => {
    const g = computeGoal(b);
    expect(g.forecast).toBeGreaterThan(23);
    expect(g.status).toBe('behind');
    expect(g.diff).toBeLessThan(0);
    expect(g.forecastAtYearEnd).toBe(Math.ceil(g.forecast));
  });
  it('бэклог уже не больше N: achieved', () => {
    expect(computeGoal({ ...b, backlogNow: 10 }).status).toBe('achieved');
    expect(computeGoal({ ...b, backlogNow: 4 }).remaining).toBe(0);
  });
  it('прогноз не уходит ниже нуля', () => {
    const g = computeGoal({ ...b, backlogNow: 3, count: 0, completedInYear: 50 });
    expect(g.forecast).toBe(0);
    expect(g.status).toBe('onTrack');
  });
  it('пустой темп: прогноз = текущий бэклог', () => {
    const g = computeGoal({ ...b, completedInYear: 0 });
    expect(g.paceEmpty).toBe(true);
    expect(g.forecast).toBe(30);
  });
});
