import { describe, expect, it } from 'vitest';
import {
  activityMode, buildHeat, formatMinutes, heatLevel, initialHeatFocus, moveHeatFocus, noYearNote, streakDaysText, streakRange, streakTiles,
  unknownNote, weekdayIndex, yearRange, type ActivityData,
} from './activity';

/** Дни года как в контракте 14.3. */
function yearDays(year: number, minutes: (date: string) => number | null = () => null) {
  const out: { date: string; minutes: number | null }[] = [];
  for (let t = Date.UTC(year, 0, 1); new Date(t).getUTCFullYear() === year; t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    out.push({ date, minutes: minutes(date) });
  }
  return out;
}

describe('heatLevel: пороги --heat', () => {
  const T = '2026-10-28';
  it.each([
    [0, 0], [1, 1], [29, 1], [30, 2], [89, 2], [90, 3], [179, 3], [180, 4], [600, 4],
  ])('%i мин -> уровень %i', (m, lvl) => {
    expect(heatLevel(m, '2026-10-20', T)).toBe(lvl);
  });
  it('null: прошлое или сегодня = неизвестный, будущее = «ещё не наступил»', () => {
    expect(heatLevel(null, '2026-10-20', T)).toBe('unknown');
    expect(heatLevel(null, T, T)).toBe('unknown');
    expect(heatLevel(null, '2026-10-29', T)).toBe('future');
  });
  it('пороги не зависят от года', () => {
    expect(heatLevel(95, '2020-01-02', '2026-10-28')).toBe(heatLevel(95, '2026-10-02', '2026-10-28'));
  });
});

describe('buildHeat: раскладка по неделям', () => {
  it('2026: 1 января = четверг, смещение 3, 53 колонки, 365 клеток', () => {
    const days = yearDays(2026);
    expect(weekdayIndex('2026-01-01')).toBe(3);
    const h = buildHeat(days, '2026-10-28', null);
    expect(h.offset).toBe(3);
    expect(h.cols).toBe(53);
    expect(h.cells).toHaveLength(365);
    expect(h.cells[0]).toMatchObject({ date: '2026-01-01', row: 3, col: 0 });
    // понедельник 5 января открывает вторую колонку
    expect(h.cells[4]).toMatchObject({ date: '2026-01-05', row: 0, col: 1 });
    // 31 декабря = четверг последней колонки
    expect(h.cells[364]).toMatchObject({ date: '2026-12-31', row: 3, col: 52 });
  });

  it('високосный 2024 начинается с понедельника: без смещения, 366 дней, 53 колонки', () => {
    const h = buildHeat(yearDays(2024), '2024-12-31', null);
    expect(h.offset).toBe(0);
    expect(h.cells).toHaveLength(366);
    expect(h.cols).toBe(53);
    expect(h.cells[0]).toMatchObject({ row: 0, col: 0 });
  });

  it('каждая строка = один день недели, колонка растёт раз в 7 дней', () => {
    const h = buildHeat(yearDays(2026), '2026-10-28', null);
    for (const c of h.cells) expect(c.row).toBe(weekdayIndex(c.date));
    expect(h.cells[10].col).toBe(Math.floor((3 + 10) / 7));
  });

  it('подписи месяцев: 12 штук, у колонки первого числа, не ближе трёх колонок', () => {
    const h = buildHeat(yearDays(2026), '2026-10-28', null);
    expect(h.months.map((m) => m.label)).toEqual(['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']);
    expect(h.months[0].col).toBe(0);
    for (let i = 1; i < h.months.length; i++) expect(h.months[i].col - h.months[i - 1].col).toBeGreaterThanOrEqual(3);
    // 1 февраля 2026: позиция 3 + 31 = 34 -> колонка 4
    expect(h.months[1].col).toBe(4);
  });

  it('сегодня отмечено, неизвестные и будущие дни получают свои уровни и подписи', () => {
    const days = yearDays(2026, (d) => (d <= '2026-10-20' ? null : d === '2026-10-21' ? 95 : d <= '2026-10-28' ? 0 : null));
    const h = buildHeat(days, '2026-10-28', '2026-10-20');
    const by = (d: string) => h.cells.find((c) => c.date === d)!;
    expect(by('2026-10-28').isToday).toBe(true);
    expect(h.cells.filter((c) => c.isToday)).toHaveLength(1);
    expect(by('2026-10-05')).toMatchObject({ level: 'unknown', detail: 'Нет данных: синк ещё не шёл' });
    expect(by('2026-10-20')).toMatchObject({ level: 'unknown', detail: 'Данных нет: первый день синка' });
    expect(by('2026-10-21')).toMatchObject({ level: 3, detail: '1 ч 35 м', aria: 'Ср, 21 октября 2026: 1 ч 35 м' });
    expect(by('2026-10-22')).toMatchObject({ level: 0, detail: 'Не играл' });
    expect(by('2026-11-05')).toMatchObject({ level: 'future', detail: 'Ещё не наступил' });
    expect(by('2026-10-21').title).toBe('Ср, 21 окт. 2026');
  });

  it('пропущенный синк после первого дня подписан отдельно', () => {
    const h = buildHeat(yearDays(2026, () => null), '2026-10-28', '2026-10-01');
    expect(h.cells.find((c) => c.date === '2026-10-10')!.detail).toBe('Нет данных: синк не отработал в этот день');
  });

  it('пустой ответ не падает', () => {
    expect(buildHeat([], '2026-10-28', null)).toEqual({ offset: 0, cols: 0, cells: [], months: [] });
  });
});

describe('moveHeatFocus', () => {
  const offset = 3;
  const total = 365;
  it('стрелки: неделя и день', () => {
    expect(moveHeatFocus(10, 'ArrowRight', offset, total)).toBe(17);
    expect(moveHeatFocus(10, 'ArrowLeft', offset, total)).toBe(3);
    expect(moveHeatFocus(10, 'ArrowDown', offset, total)).toBe(11);
    expect(moveHeatFocus(10, 'ArrowUp', offset, total)).toBe(9);
  });
  it('Home / End: понедельник и воскресенье недели', () => {
    // i = 10: позиция 13 -> строка 6 (воскресенье)
    expect(moveHeatFocus(10, 'Home', offset, total)).toBe(4);
    expect(moveHeatFocus(10, 'End', offset, total)).toBe(10);
    expect(moveHeatFocus(1, 'Home', offset, total)).toBe(0); // первая неделя неполная
    expect(moveHeatFocus(363, 'End', offset, total)).toBe(364);
  });
  it('края и чужие клавиши', () => {
    expect(moveHeatFocus(0, 'ArrowLeft', offset, total)).toBe(0);
    expect(moveHeatFocus(364, 'ArrowRight', offset, total)).toBe(364);
    expect(moveHeatFocus(0, 'a', offset, total)).toBeNull();
  });
  it('начальный tab-stop: сегодня, иначе последний известный день', () => {
    const days = yearDays(2026, (d) => (d > '2026-10-20' && d <= '2026-10-25' ? 10 : null));
    expect(initialHeatFocus(buildHeat(days, '2026-10-28', '2026-10-20').cells)).toBe(days.findIndex((d) => d.date === '2026-10-28'));
    expect(initialHeatFocus(buildHeat(days, '2027-02-01', '2026-10-20').cells)).toBe(days.findIndex((d) => d.date === '2026-10-25'));
  });
});

describe('форматирование', () => {
  it('formatMinutes', () => {
    expect([0, 1, 45, 60, 75, 95, 125, 610].map(formatMinutes)).toEqual(['0 м', '1 м', '45 м', '1 ч', '1 ч 15 м', '1 ч 35 м', '2 ч 5 м', '10 ч 10 м']);
  });
  it('streakDaysText: склонение и короткая форма', () => {
    expect([0, 1, 2, 4, 5, 11, 21].map((n) => streakDaysText(n))).toEqual(['0 дней', '1 день', '2 дня', '4 дня', '5 дней', '11 дней', '21 день']);
    expect(streakDaysText(3, true)).toBe('3 дн.');
  });
  it('streakRange', () => {
    expect(streakRange('2026-10-25', '2026-10-27', false)).toBe('25–27 окт.');
    expect(streakRange('2026-10-21', '2026-10-24', true)).toBe('21–24 окт. 2026');
    expect(streakRange('2026-10-28', '2026-11-02', false)).toBe('28 окт. – 2 нояб.');
    expect(streakRange('2025-12-30', '2026-01-02', true)).toBe('30 дек. 2025 – 2 янв. 2026');
    expect(streakRange('2026-10-25', '2026-10-25', false)).toBe('25 окт.');
    expect(streakRange(null, null, false)).toBeNull();
  });
  it('yearRange: от года первого снимка до года «сегодня»', () => {
    expect(yearRange('2024-03-04', '2026-10-28')).toEqual({ min: 2024, max: 2026 });
    expect(yearRange(null, '2026-10-28')).toEqual({ min: 2026, max: 2026 });
  });
});

describe('streakTiles и режимы', () => {
  const base: Pick<ActivityData, 'streak' | 'totals' | 'year'> = {
    year: 2026,
    totals: { playedDays: 5, knownDays: 7, minutes: 610, maxMinutes: 180 },
    streak: {
      current: { days: 3, from: '2026-10-25', to: '2026-10-27', hasGaps: false },
      best: { days: 4, from: '2026-10-21', to: '2026-10-24', hasGaps: true },
      bestInYear: { days: 4, from: '2026-10-21', to: '2026-10-24', hasGaps: true },
    },
  };
  it('значения, подписи, пропуски', () => {
    const [cur, best, year] = streakTiles(base);
    expect(cur).toMatchObject({ label: 'Текущая серия', value: '3 дня', valueShort: '3 дн.', caption: '25–27 окт.', hasGaps: false, aria: '3 дня' });
    expect(best).toMatchObject({ label: 'Лучшая серия', value: '4 дня', caption: '21–24 окт. 2026', hasGaps: true, aria: '4 дня, в серии есть дни без данных' });
    expect(year).toMatchObject({ label: 'Лучшая в 2026', caption: '21–24 окт.' });
  });
  it('нет серии: «0 дней», «серия не идёт»; год без данных: «нет данных»', () => {
    const none = { days: 0, from: null, to: null, hasGaps: false };
    const [cur, , year] = streakTiles({ ...base, totals: { playedDays: 0, knownDays: 0, minutes: 0, maxMinutes: 0 }, streak: { current: none, best: base.streak.best, bestInYear: none } });
    expect(cur).toMatchObject({ value: '0 дней', caption: 'серия не идёт' });
    expect(year).toMatchObject({ value: '0 дней', caption: 'нет данных' });
  });
  it('activityMode', () => {
    const t0 = { playedDays: 0, knownDays: 0, minutes: 0, maxMinutes: 0 };
    expect(activityMode({ year: 2026, firstSnapshotDate: null, totals: t0 })).toBe('empty');
    expect(activityMode({ year: 2025, firstSnapshotDate: '2026-03-04', totals: t0 })).toBe('noYear');
    expect(activityMode({ year: 2026, firstSnapshotDate: '2026-10-28', totals: t0 })).toBe('ok'); // первый день синка, мало данных
    expect(activityMode({ year: 2026, firstSnapshotDate: '2026-03-04', totals: base.totals })).toBe('ok');
  });
  it('тексты с датой первого синка', () => {
    expect(noYearNote(2025, '2026-03-04')).toBe('В 2025 данных нет: синк начался 04.03.2026');
    expect(unknownNote('2026-10-20')).toContain('Дни до 20.10.2026 (первый синк) неизвестны');
    expect(unknownNote(null)).toContain('Дни до первого синка неизвестны');
  });
});
