// П15.3: данные графиков Статистики строками таблицы (для экранных чтецов и тех, кому удобнее цифры). Чистые функции.
import type { TrophyCountsByType } from '@/server/stats/types';
import { formatNumber } from '../format';
import { formatMinutes, type ActivityDay } from './activity';
import { hoursText, type HoursBar } from './model';
import type { PatternBar } from './playPattern';

export type TableData = { head: string[]; rows: string[][] };

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

export function hoursTable(bars: readonly HoursBar[]): TableData {
  const est = bars.some((b) => b.estimated > 0);
  return {
    head: est ? ['Месяц', 'Часы', 'Из них оценка'] : ['Месяц', 'Часы'],
    rows: bars.map((b) => {
      const v = b.value === null ? 'нет данных' : hoursText(b.value);
      return est ? [MONTHS[b.month - 1], v, b.estimated > 0 ? hoursText(b.estimated) : '—'] : [MONTHS[b.month - 1], v];
    }),
  };
}

export function trophiesTable(byMonth: readonly (TrophyCountsByType & { month: number })[]): TableData {
  return {
    head: ['Месяц', 'Всего', 'Платина', 'Золото', 'Серебро', 'Бронза'],
    rows: byMonth.map((m) => [MONTHS[m.month - 1], m.total, m.platinum, m.gold, m.silver, m.bronze].map((x) => (typeof x === 'number' ? formatNumber(x) : x))),
  };
}

export function patternTable(bars: readonly PatternBar[], first: string, name: (b: PatternBar) => string): TableData {
  return { head: [first, 'Трофеи', 'Доля'], rows: bars.map((b) => [name(b), formatNumber(b.value), `${b.pct}%`]) };
}

/** Карта активности по месяцам: игровые дни из известных и время. Месяцы без единого известного дня пропускаются. */
export function activityTable(days: readonly ActivityDay[]): TableData {
  const by = new Map<number, { played: number; known: number; minutes: number }>();
  for (const d of days) {
    if (d.minutes === null) continue;
    const m = Number(d.date.slice(5, 7));
    const a = by.get(m) ?? { played: 0, known: 0, minutes: 0 };
    a.known++;
    if (d.minutes > 0) { a.played++; a.minutes += d.minutes; }
    by.set(m, a);
  }
  return {
    head: ['Месяц', 'Игровых дней', 'Известных дней', 'Время'],
    rows: [...by.entries()].sort((a, b) => a[0] - b[0]).map(([m, a]) => [MONTHS[m - 1], String(a.played), String(a.known), formatMinutes(a.minutes)]),
  };
}
