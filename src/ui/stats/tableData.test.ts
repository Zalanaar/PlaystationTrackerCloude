import { describe, expect, it } from 'vitest';
import { activityTable, hoursTable, patternTable, trophiesTable } from './tableData';
import { hoursBars } from './model';
import { hourBars } from './playPattern';
import { hourRange } from './playPattern';

describe('П15.3 таблицы графиков', () => {
  it('часы: 12 месяцев, «нет данных», колонка оценки только когда она есть', () => {
    const plain = hoursTable(hoursBars([null, 10, 2.5, ...Array(9).fill(null)], Array(12).fill(0), 2026));
    expect(plain.head).toEqual(['Месяц', 'Часы']);
    expect(plain.rows).toHaveLength(12);
    expect(plain.rows[0]).toEqual(['Январь', 'нет данных']);
    expect(plain.rows[1][0]).toBe('Февраль');
    const est = hoursTable(hoursBars([5, 10, ...Array(10).fill(null)], [5, 0, ...Array(10).fill(0)], 2026));
    expect(est.head).toEqual(['Месяц', 'Часы', 'Из них оценка']);
    expect(est.rows[1][2]).toBe('—');
  });
  it('трофеи: по месяцам и видам', () => {
    const z = { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 };
    const t = trophiesTable([{ month: 3, platinum: 1, gold: 2, silver: 3, bronze: 1234, total: 1240 }, { month: 4, ...z }]);
    expect(t.rows[0]).toEqual(['Март', '1\u00a0240', '1', '2', '3', '1\u00a0234']);
    expect(t.rows[1][0]).toBe('Апрель');
  });
  it('«Когда ты играешь»: час, число, доля', () => {
    const byHour = Array(24).fill(0); byHour[21] = 3; byHour[22] = 1;
    const t = patternTable(hourBars({ byHour, total: 4 }), 'Час', (b) => hourRange(b.index));
    expect(t.rows).toHaveLength(24);
    expect(t.rows[21]).toEqual(['21:00-22:00', '3', '75%']);
  });
  it('активность: месяцы с известными днями, игровые дни и время', () => {
    const t = activityTable([
      { date: '2026-01-02', minutes: 90 }, { date: '2026-01-03', minutes: 0 }, { date: '2026-01-04', minutes: null },
      { date: '2026-03-01', minutes: 30 },
    ]);
    expect(t.rows).toEqual([['Январь', '1', '2', '1 ч 30 м'], ['Март', '1', '1', '30 м']]);
  });
});
