import { describe, expect, it } from 'vitest';
import {
  coverageNote, finishedYearRows, unattributedText, yearHoursBars, yearRange, yearTrophyBars,
} from './allTime';
import { parseSelection, periodLabel, selectionKey, selectionToParams, setPeriodType, shiftSelection } from './model';

const today = { year: 2026, month: 10 };
const sp = (q: string) => new URLSearchParams(q);

describe('период «Всё время» в URL', () => {
  it('period=all: year и month игнорируются, в URL не пишутся', () => {
    const s = parseSelection(sp('period=all&year=2019&month=3'), today);
    expect(s).toEqual({ period: 'all', year: 2026, month: null });
    expect(selectionToParams(s).toString()).toBe('period=all');
    expect(selectionKey(s)).toBe('period=all');
    expect(parseSelection(sp('period=all&year=abc'), today).period).toBe('all');
    expect(periodLabel(s)).toBe('Всё время');
  });
  it('стрелок в режиме all нет', () => {
    expect(shiftSelection({ period: 'all', year: 2026, month: null }, -1, [2026, 2025], today)).toBeNull();
  });
  it('возврат на «Год» берёт последний выбранный год, иначе текущий', () => {
    const all = { period: 'all' as const, year: 2026, month: null };
    expect(setPeriodType(all, 'year', today, 2023)).toEqual({ period: 'year', year: 2023, month: null });
    expect(setPeriodType(all, 'year', today)).toEqual({ period: 'year', year: 2026, month: null });
    expect(setPeriodType(all, 'month', today, 2023).month).toBe(12);
    expect(setPeriodType({ period: 'year', year: 2023, month: null }, 'all', today)).toEqual(all);
  });
});

describe('«Не отнесено к годам»', () => {
  it('показывается от 0,1 ч по модулю, иначе скрыта', () => {
    expect(unattributedText(40)).toBe('Не отнесено к годам: 40 ч');
    expect(unattributedText(-12.5)).toBe('Не отнесено к годам: −12,5 ч');
    expect(unattributedText(0.1)).toBe('Не отнесено к годам: 0,1 ч');
    expect(unattributedText(0.04)).toBeNull();
    expect(unattributedText(-0.09)).toBeNull();
    expect(unattributedText(0)).toBeNull();
    expect(unattributedText(undefined)).toBeNull();
  });
});

describe('плашка охвата', () => {
  it('нет оценки: плашки нет', () => {
    expect(coverageNote('2026-03-04', false, 0)).toBeNull();
  });
  it('есть снимки и оценка: дата и «Итог равен сумме PSN»', () => {
    const t = coverageNote('2026-03-04', true, 0);
    expect(t).toContain('Точные часы по дням ведутся с 04.03.2026.');
    expect(t).toContain('Итог за всё время равен сумме PSN.');
  });
  it('unattributed != 0: фразы «Итог равен сумме» нет', () => {
    expect(coverageNote('2026-03-04', true, 40)).not.toContain('равен сумме');
    expect(coverageNote('2026-03-04', true, -3)).not.toContain('равен сумме');
    expect(coverageNote('2026-03-04', true, 0.05)).toContain('равен сумме');
  });
  it('снимков нет', () => {
    expect(coverageNote(null, true, 0)).toBe('Все часы оценены: PSN отдаёт только сумму. Точные данные появятся после ежедневных синков.');
  });
});

describe('график часов по годам', () => {
  const bars = yearHoursBars([
    { year: 2024, hours: 900.1, estimatedHours: 900.1, measuredHours: 0 },
    { year: 2025, hours: 1200, estimatedHours: 300, measuredHours: 900 },
    { year: 2026, hours: 0, estimatedHours: 0, measuredHours: 0 },
  ]);
  it('высота от максимума, пустой год без столбца', () => {
    expect(bars[1].heightPct).toBe(100);
    expect(bars[2].empty).toBe(true);
    expect(bars[2].heightPct).toBe(0);
  });
  it('оценка: целиком оценочный год и доля', () => {
    expect(bars[0].allEstimated).toBe(true);
    expect(bars[0].mostlyEstimated).toBe(true);
    expect(bars[1].mostlyEstimated).toBe(false);
    expect(bars[1].realShare).toBe(75);
  });
  it('aria-label', () => {
    expect(bars[1].text).toBe('2025: 1 200 ч, из них 300 ч оценка');
    expect(bars[2].text).toBe('2026: часов нет');
  });
});

describe('трофеи и завершённые по годам', () => {
  it('подпись трофеев с платинами', () => {
    const [a, b] = yearTrophyBars([
      { year: 2024, platinum: 4, gold: 18, silver: 60, bronze: 230, total: 312 },
      { year: 2025, platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 },
    ]);
    expect(a.text).toBe('2024: 312 трофеев, платин 4');
    expect(b.empty).toBe(true);
  });
  it('строки: по убыванию года, пустые годы скрыты, общая шкала', () => {
    const rows = finishedYearRows([
      { year: 2023, completed: 0, dropped: 0 }, { year: 2024, completed: 8, dropped: 3 }, { year: 2025, completed: 2, dropped: 4 },
    ]);
    expect(rows.map((r) => r.year)).toEqual([2025, 2024]);
    expect(rows[1].completedPct).toBe(100);
    expect(rows[0].droppedPct).toBe(50);
    expect(rows[1].text).toBe('2024: пройдено 8, брошено 3. Открыть год');
  });
  it('диапазон лет', () => {
    expect(yearRange([2026, 2014], 2026)).toBe('2014 – 2026');
    expect(yearRange([2026], 2026)).toBe('2026');
  });
});
