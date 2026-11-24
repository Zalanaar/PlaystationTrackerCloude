import { describe, expect, it } from 'vitest';
import { yearGamesHint } from '@/shared/month-goals';
import { barPercent, fieldHint, gamesHintLabel, hoursHintLabel, monthTitle, parseField, planHoursHintLabel, progressLine, yearGoalBridgeLabel } from './model';

describe('подписи целей месяца', () => {
  it('заголовок, строка прогресса, шкала, разбор поля', () => {
    expect(monthTitle(11)).toBe('ноябрь');
    expect(progressLine('games', 2, 3)).toBe('2 из 3 игр');
    expect(progressLine('hours', 5, 20)).toBe('5 из 20 ч');
    expect(progressLine('trophies', 1, 1)).toBe('1 из 1 трофея');
    expect(barPercent(2, 4)).toBe(50);
    expect(barPercent(5, 4)).toBe(100);
    expect(parseField('', 'games')).toEqual({ ok: true, value: null });
    expect(parseField('3', 'games')).toEqual({ ok: true, value: 3 });
    expect(parseField('0', 'games')).toEqual({ ok: false });
    expect(parseField('101', 'games')).toEqual({ ok: false });
    expect(fieldHint('hours')).toContain('744');
    expect(hoursHintLabel(42)).toBe('В среднем 42 ч в месяц');
    expect(planHoursHintLabel(43, 10)).toBe('По плану: 43 ч (10 ч в неделю)');
    expect(yearGoalBridgeLabel({ mode: 'complete', current: 7, count: 12 })).toBe('Год: 7 из 12');
    expect(yearGoalBridgeLabel({ mode: 'backlog_to', current: 24, count: 12 })).toBe('Год: бэклог 24, цель 12');
    expect(gamesHintLabel(1)).toBe('По темпу года — 1 игра в месяц');
    expect(gamesHintLabel(3)).toBe('По темпу года — 3 игры в месяц');
    expect(yearGamesHint(1.4, 5, 2026, 2026, false)).toBe(1);
    expect(yearGamesHint(0.4, 5, 2026, 2026, false)).toBe(1);
    expect(yearGamesHint(2.6, 5, 2026, 2026, false)).toBe(3);
    expect(yearGamesHint(3, 5, 2026, 2026, true)).toBeNull();
    expect(yearGamesHint(3, 5, 2027, 2026, false)).toBeNull();
    expect(yearGamesHint(3, 0, 2026, 2026, false)).toBeNull();
  });
});
