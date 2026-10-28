// Чистая логика карты активности и стрика (спека Фазы 15 п.9, контракт 14.3). Без DOM и React.
import type { ActivityResponse } from '@/server/stats/activity';
import { plural } from '../format';

export type ActivityData = ActivityResponse;
export type ActivityDay = ActivityResponse['days'][number];
export type StreakInfo = ActivityResponse['streak']['current'];

/** Уровни клетки: фиксированные пороги, не зависят от `maxMinutes` и года. */
export type HeatLevel = 'unknown' | 'future' | 0 | 1 | 2 | 3 | 4;
/** Нижние границы уровней 1..4, минуты. */
export const HEAT_FROM = { 1: 1, 2: 30, 3: 90, 4: 180 } as const;

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
const MONTHS_ABBR = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
/** Подписи строк слева: Пн, Ср, Пт (строки 1, 3, 5). */
export const HEAT_ROW_LABELS: readonly (string | null)[] = ['Пн', null, 'Ср', null, 'Пт', null, null];
/** Минимум колонок между подписями месяцев. */
export const MONTH_LABEL_GAP = 3;

export const GAPS_NOTE = 'есть дни без данных';
export const GAPS_HELP = 'В серии были дни без данных: синк мог пропускать дни. Фактическая серия может отличаться.';

export function heatLevel(minutes: number | null, date: string, today: string): HeatLevel {
  if (minutes === null) return date > today ? 'future' : 'unknown';
  if (minutes <= 0) return 0;
  if (minutes >= HEAT_FROM[4]) return 4;
  if (minutes >= HEAT_FROM[3]) return 3;
  if (minutes >= HEAT_FROM[2]) return 2;
  return 1;
}

/** «45 м», «1 ч 35 м», «2 ч», «0 м». */
export function formatMinutes(total: number): string {
  const t = Math.max(0, Math.round(total));
  const h = Math.floor(t / 60);
  const m = t % 60;
  if (h === 0) return `${m} м`;
  const hh = h.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return m === 0 ? `${hh} ч` : `${hh} ч ${m} м`;
}

const parts = (date: string) => ({ y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)), d: Number(date.slice(8, 10)) });
/** Пн = 0 … Вс = 6 для YYYY-MM-DD. */
export function weekdayIndex(date: string): number {
  const p = parts(date);
  return (new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() + 6) % 7;
}

/** «Вт, 21 октября 2026». */
export function dateLong(date: string): string {
  const p = parts(date);
  return `${WEEKDAYS[weekdayIndex(date)]}, ${p.d} ${MONTHS_GEN[p.m - 1]} ${p.y}`;
}
/** «Вт, 21 окт. 2026». */
export function dateShort(date: string): string {
  const p = parts(date);
  return `${WEEKDAYS[weekdayIndex(date)]}, ${p.d} ${MONTHS_SHORT[p.m - 1]} ${p.y}`;
}

export type HeatCell = {
  date: string;
  minutes: number | null;
  level: HeatLevel;
  isToday: boolean;
  /** строка 0..6 (Пн..Вс) */
  row: number;
  /** колонка-неделя */
  col: number;
  /** aria-label: «Вт, 21 октября 2026: 1 ч 35 м» */
  aria: string;
  /** первая строка подсказки */
  title: string;
  /** вторая строка подсказки */
  detail: string;
};

export type HeatLayout = {
  /** сколько пустых клеток до 1 января в первой колонке (не рисуются) */
  offset: number;
  cols: number;
  cells: HeatCell[];
  /** подписи месяцев над колонками */
  months: { col: number; label: string }[];
};

function describe(level: HeatLevel, minutes: number | null, date: string, firstSnapshotDate: string | null): { aria: string; detail: string } {
  if (level === 'future') return { aria: 'ещё не наступил', detail: 'Ещё не наступил' };
  if (level === 'unknown') {
    if (firstSnapshotDate !== null && date === firstSnapshotDate) return { aria: 'нет данных', detail: 'Данных нет: первый день синка' };
    if (firstSnapshotDate === null || date < firstSnapshotDate) return { aria: 'нет данных', detail: 'Нет данных: синк ещё не шёл' };
    return { aria: 'нет данных', detail: 'Нет данных: синк не отработал в этот день' };
  }
  if (level === 0) return { aria: 'не играл', detail: 'Не играл' };
  const t = formatMinutes(minutes ?? 0);
  return { aria: t, detail: t };
}

/**
 * Раскладка года по неделям с понедельника. Клетки идут в порядке дат; позиция клетки i: строка (offset + i) % 7, колонка floor((offset + i) / 7).
 * Первая колонка содержит 1 января (клетки до него не рисуются). Подпись месяца стоит над колонкой, где он начинается,
 * но не ближе MONTH_LABEL_GAP колонок к предыдущей.
 */
export function buildHeat(days: readonly ActivityDay[], today: string, firstSnapshotDate: string | null): HeatLayout {
  if (days.length === 0) return { offset: 0, cols: 0, cells: [], months: [] };
  const offset = weekdayIndex(days[0].date);
  const cells: HeatCell[] = [];
  const months: { col: number; label: string }[] = [];
  let lastLabelCol = -MONTH_LABEL_GAP;
  days.forEach((day, i) => {
    const pos = offset + i;
    const level = heatLevel(day.minutes, day.date, today);
    const d = describe(level, day.minutes, day.date, firstSnapshotDate);
    cells.push({
      date: day.date, minutes: day.minutes, level, isToday: day.date === today, row: pos % 7, col: Math.floor(pos / 7),
      aria: `${dateLong(day.date)}: ${d.aria}`, title: dateShort(day.date), detail: d.detail,
    });
    if (day.date.endsWith('-01')) {
      const col = Math.floor(pos / 7);
      if (col - lastLabelCol >= MONTH_LABEL_GAP) {
        months.push({ col, label: MONTHS_ABBR[Number(day.date.slice(5, 7)) - 1] });
        lastLabelCol = col;
      }
    }
  });
  return { offset, cols: Math.ceil((offset + days.length) / 7), cells, months };
}

/**
 * Клавиатура по карте (roving tabindex). i = индекс дня. Стрелки влево/вправо = неделя назад/вперёд, вверх/вниз = день,
 * Home/End = понедельник/воскресенье недели. null: клавиша не навигационная; на краю остаёмся на месте.
 */
export function moveHeatFocus(i: number, key: string, offset: number, total: number): number | null {
  const row = (offset + i) % 7;
  let next: number;
  switch (key) {
    case 'ArrowRight': next = i + 7; break;
    case 'ArrowLeft': next = i - 7; break;
    case 'ArrowDown': next = i + 1; break;
    case 'ArrowUp': next = i - 1; break;
    case 'Home': next = Math.max(0, i - row); break;
    case 'End': next = Math.min(total - 1, i + (6 - row)); break;
    default: return null;
  }
  return next < 0 || next > total - 1 ? i : next;
}

/** Индекс дня, на котором стоит tab-stop при открытии: сегодня, иначе последний известный день, иначе первый. */
export function initialHeatFocus(cells: readonly HeatCell[]): number {
  const t = cells.findIndex((c) => c.isToday);
  if (t >= 0) return t;
  for (let i = cells.length - 1; i >= 0; i--) if (cells[i].minutes !== null) return i;
  return 0;
}

// ---------- стрик ----------
export function streakDaysText(n: number, short = false): string {
  return `${n} ${short ? 'дн.' : plural(n, ['день', 'дня', 'дней'])}`;
}

/** «25–27 окт.», «28 окт. – 2 нояб.», с годом: «21–24 окт. 2026». null-границы дают null. */
export function streakRange(from: string | null, to: string | null, withYear: boolean): string | null {
  if (!from || !to) return null;
  const a = parts(from);
  const b = parts(to);
  const sameYear = a.y === b.y;
  const y = (p: { y: number }) => (withYear ? ` ${p.y}` : '');
  if (from === to) return `${a.d} ${MONTHS_SHORT[a.m - 1]}${y(a)}`;
  if (sameYear && a.m === b.m) return `${a.d}–${b.d} ${MONTHS_SHORT[b.m - 1]}${y(b)}`;
  if (sameYear) return `${a.d} ${MONTHS_SHORT[a.m - 1]} – ${b.d} ${MONTHS_SHORT[b.m - 1]}${y(b)}`;
  return `${a.d} ${MONTHS_SHORT[a.m - 1]} ${a.y} – ${b.d} ${MONTHS_SHORT[b.m - 1]} ${b.y}`;
}

export type StreakTile = {
  id: 'current' | 'best' | 'bestInYear';
  label: string;
  /** «3 дня» */
  value: string;
  /** «3 дн.» на мобильном */
  valueShort: string;
  /** одна строка под значением */
  caption: string;
  hasGaps: boolean;
  /** aria-label значения */
  aria: string;
};

function tile(id: StreakTile['id'], label: string, s: StreakInfo, withYear: boolean, zero: string): StreakTile {
  const value = streakDaysText(s.days);
  const range = s.days > 0 ? streakRange(s.from, s.to, withYear) : null;
  return {
    id, label, value, valueShort: streakDaysText(s.days, true), caption: range ?? zero, hasGaps: s.hasGaps && s.days > 0,
    aria: s.hasGaps && s.days > 0 ? `${value}, в серии есть дни без данных` : value,
  };
}

/** Три плитки стрика. «Лучшая в {год}» без данных за год: значение «0 дней», подпись «нет данных». */
export function streakTiles(d: Pick<ActivityData, 'streak' | 'totals' | 'year'>): StreakTile[] {
  return [
    tile('current', 'Текущая серия', d.streak.current, false, 'серия не идёт'),
    tile('best', 'Лучшая серия', d.streak.best, true, 'серий ещё нет'),
    tile('bestInYear', `Лучшая в ${d.year}`, d.streak.bestInYear, false, d.totals.knownDays === 0 ? 'нет данных' : 'серий не было'),
  ];
}

// ---------- годы и состояния ----------
export const yearOf = (iso: string | null): number | null => (iso && /^\d{4}-/.test(iso) ? Number(iso.slice(0, 4)) : null);

/** Границы переключателя: минимум = год первого снимка (или текущий), максимум = текущий. */
export function yearRange(firstSnapshotDate: string | null, today: string): { min: number; max: number } {
  const max = yearOf(today) ?? new Date().getUTCFullYear();
  const first = yearOf(firstSnapshotDate);
  return { min: first === null ? max : Math.min(first, max), max };
}

export type ActivityMode = 'empty' | 'noYear' | 'ok';

/**
 * empty: снимков нет совсем; noYear: в выбранном году нет ни одного известного дня, а снимки начались в другом;
 * ok: карта и плитки как есть (в том числе «мало данных»).
 */
export function activityMode(d: Pick<ActivityData, 'firstSnapshotDate' | 'totals' | 'year'>): ActivityMode {
  if (d.firstSnapshotDate === null) return 'empty';
  if (d.totals.knownDays === 0 && yearOf(d.firstSnapshotDate) !== d.year) return 'noYear';
  return 'ok';
}

/** ДД.ММ.ГГГГ из YYYY-MM-DD. */
export function dmy(day: string | null): string | null {
  const m = day ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

export const noYearNote = (year: number, firstSnapshotDate: string | null) =>
  `В ${year} данных нет${dmy(firstSnapshotDate) ? `: синк начался ${dmy(firstSnapshotDate)}` : ''}`;

export const unknownNote = (firstSnapshotDate: string | null) =>
  `Дни до ${dmy(firstSnapshotDate) ? `${dmy(firstSnapshotDate)} (первый синк)` : 'первого синка'} неизвестны: PSN отдаёт только суммарное время. Игра после ночного снимка попадает в следующий день.`;

/** Подписи легенды по порогам (hover/title). */
export const LEGEND_TITLES = ['не играл', 'до 30 м', '30–90 м', '1,5–3 ч', '3 ч и больше'] as const;

/** Итоги над картой: «Игровых дней 5 из 7 известных» и «Всего 10 ч 10 м». */
export function totalsText(t: ActivityData['totals']): { days: { played: string; known: string }; total: string } {
  return { days: { played: String(t.playedDays), known: String(t.knownDays) }, total: formatMinutes(t.minutes) };
}
