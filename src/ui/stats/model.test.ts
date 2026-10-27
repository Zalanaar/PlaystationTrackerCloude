import { describe, expect, it } from 'vitest';
import {
  barsHaveEstimate, estimateNote, formatHours, formatIsoDay, genreBars, highlightedMonth, hoursBars, linePath, linePoints, parseSelection,
  periodLabel, selectionToParams, setPeriodType, shiftSelection, todayMsk,
} from './model';

const today = { year: 2026, month: 10 };
const sp = (q: string) => new URLSearchParams(q);

describe('параметры URL', () => {
  it('по умолчанию текущий год', () => {
    expect(parseSelection(sp(''), today)).toEqual({ period: 'year', year: 2026, month: null });
  });
  it('мусор заменяется значениями по умолчанию, будущее обрезается', () => {
    expect(parseSelection(sp('period=x&year=abc'), today)).toEqual({ period: 'year', year: 2026, month: null });
    expect(parseSelection(sp('year=2031'), today).year).toBe(2026);
    expect(parseSelection(sp('period=month&year=2026&month=12'), today).month).toBe(10);
    expect(parseSelection(sp('period=month&year=2025&month=0'), today).month).toBe(12);
  });
  it('месяц читается и пишется обратно', () => {
    const s = parseSelection(sp('period=month&year=2026&month=3'), today);
    expect(s).toEqual({ period: 'month', year: 2026, month: 3 });
    expect(selectionToParams(s).toString()).toBe('period=month&year=2026&month=3');
  });
  it('переключение года на месяц', () => {
    expect(setPeriodType({ period: 'year', year: 2026, month: null }, 'month', today).month).toBe(10);
    expect(setPeriodType({ period: 'year', year: 2025, month: null }, 'month', today).month).toBe(12);
    expect(setPeriodType({ period: 'month', year: 2025, month: 4 }, 'year', today)).toEqual({ period: 'year', year: 2025, month: null });
  });
});

describe('стрелки', () => {
  const years = [2026, 2025, 2024];
  it('год: не уходит за доступные и в будущее', () => {
    const y = (n: number) => ({ period: 'year' as const, year: n, month: null });
    expect(shiftSelection(y(2026), 1, years, today)).toBeNull();
    expect(shiftSelection(y(2026), -1, years, today)?.year).toBe(2025);
    expect(shiftSelection(y(2024), -1, years, today)).toBeNull();
  });
  it('месяц: переходит через границу года, не уходит в будущее', () => {
    const m = (y: number, mo: number) => ({ period: 'month' as const, year: y, month: mo });
    expect(shiftSelection(m(2026, 1), -1, years, today)).toEqual(m(2025, 12));
    expect(shiftSelection(m(2025, 12), 1, years, today)).toEqual(m(2026, 1));
    expect(shiftSelection(m(2026, 10), 1, years, today)).toBeNull();
    expect(shiftSelection(m(2024, 1), -1, years, today)).toBeNull();
  });
  it('пустой список лет: только текущий', () => {
    expect(shiftSelection({ period: 'year', year: 2026, month: null }, -1, [], today)).toBeNull();
  });
});

describe('форматирование', () => {
  it('часы', () => {
    expect(formatHours(31.54)).toBe('31,5');
    expect(formatHours(40)).toBe('40');
    expect(formatHours(0)).toBe('0');
    expect(formatHours(1234.5)).toBe('1 234,5');
  });
  it('дата первого синка', () => {
    expect(formatIsoDay('2026-03-04')).toBe('04.03.2026');
    expect(formatIsoDay(null)).toBeNull();
    expect(estimateNote('2026-03-04')).toBe(
      'До 04.03.2026 часы оценены: распределены равномерно между первым и последним запуском игры. С этой даты часы измеряются по ежедневным снимкам.',
    );
    expect(estimateNote(null)).toBe(
      'Часы оценены: распределены равномерно между первым и последним запуском игры. Точные данные появятся после ежедневных синков.',
    );
  });
  it('подпись периода и сегодня по Москве', () => {
    expect(periodLabel({ period: 'month', year: 2026, month: 10 })).toBe('Октябрь 2026');
    expect(periodLabel({ period: 'year', year: 2026, month: null })).toBe('2026');
    expect(todayMsk(Date.parse('2026-12-31T22:00:00Z'))).toEqual({ year: 2027, month: 1 });
  });
});

describe('графики', () => {
  it('столбцы часов: null без высоты, максимум 100%, ноль без столбца', () => {
    const bars = hoursBars([null, 0, 10, 20, null, null, null, null, null, null, null, null]);
    expect(bars).toHaveLength(12);
    expect(bars[0]).toMatchObject({ value: null, heightPct: 0, text: 'Январь: нет данных по часам' });
    expect(bars[1]).toMatchObject({ value: 0, heightPct: 0, text: 'Февраль: 0 ч' });
    expect(bars[2].heightPct).toBe(50);
    expect(bars[3]).toMatchObject({ heightPct: 100, text: 'Апрель: 20 ч' });
  });
  it('стек: измеренная часть снизу, оценочная сверху, aria-label с обеими частями', () => {
    const bars = hoursBars([null, 12, 10, 20, ...Array(8).fill(null)], [0, 7, 0, 0, ...Array(8).fill(0)], 2026);
    expect(bars[1]).toMatchObject({ value: 12, real: 5, estimated: 7, title: 'Февраль 2026', text: 'Февраль 2026: 12 ч, из них 7 ч оценка' });
    expect(bars[1].realShare).toBeCloseTo((5 / 12) * 100);
    expect(bars[1].heightPct).toBe(60);
    expect(bars[2]).toMatchObject({ real: 10, estimated: 0, realShare: 100, text: 'Март 2026: 10 ч' });
    expect(bars[0]).toMatchObject({ value: null, heightPct: 0, text: 'Январь 2026: нет данных по часам' });
    expect(barsHaveEstimate(bars)).toBe(true);
    expect(barsHaveEstimate(hoursBars([1, 2], [0, 0]))).toBe(false);
  });
  it('месяц целиком оценочный; оценка не больше всего; пустой месяц без столбца', () => {
    const [a, b, c] = hoursBars([10, 4, 0, ...Array(9).fill(null)], [10, 9, 0, ...Array(9).fill(0)]);
    expect(a).toMatchObject({ real: 0, estimated: 10, realShare: 0 });
    expect(b).toMatchObject({ real: 0, estimated: 4 });
    expect(c).toMatchObject({ heightPct: 0, estimated: 0 });
  });
  it('все null и крошечные значения', () => {
    expect(hoursBars(Array(12).fill(null)).every((b) => b.heightPct === 0)).toBe(true);
    expect(hoursBars([0.1, 100, ...Array(10).fill(null)])[0].heightPct).toBe(3);
  });
  it('подсветка месяца', () => {
    expect(highlightedMonth({ period: 'year', year: 2026, month: null }, today)).toBe(10);
    expect(highlightedMonth({ period: 'year', year: 2025, month: null }, today)).toBeNull();
    expect(highlightedMonth({ period: 'month', year: 2025, month: 3 }, today)).toBe(3);
  });
  it('жанры: ширина от максимума, значение с одним знаком', () => {
    const g = genreBars([{ key: 'A', label: 'Экшен', value: 14.5 }, { key: 'B', label: 'Гонки', value: 7.25 }]);
    expect(g[0]).toMatchObject({ widthPct: 100, text: '14,5' });
    expect(g[1].widthPct).toBeCloseTo(50);
    expect(genreBars([])).toEqual([]);
  });
  it('линия трофеев: колонки по центру, нули на дне', () => {
    const pts = linePoints([0, 5, 10, 0], 400, 100, 10);
    expect(pts.map((p) => p.x)).toEqual([50, 150, 250, 350]);
    expect(pts[2].y).toBe(10);
    expect(pts[0].y).toBe(90);
    expect(linePoints([0, 0], 100, 50, 5).every((p) => p.y === 45)).toBe(true);
    expect(linePath(pts)).toBe('M50.0 90.0 L150.0 50.0 L250.0 10.0 L350.0 90.0');
  });
});
