// Чистая логика экрана «Статистика»: параметры URL, навигация по периодам, подготовка данных для графиков.
import type { PlayedGroup, StatsGenreItem, StatsResponse } from '@/server/stats/types';
import { formatPlayTime, mskParts, monthName } from '../format';

export type PeriodType = 'year' | 'month';
export type Selection = { period: PeriodType; year: number; month: number | null };
export type Today = { year: number; month: number };

export const MONTH_LABELS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'] as const;

export function todayMsk(nowMs: number): Today {
  const p = mskParts(nowMs);
  return { year: p.y, month: p.m };
}

function intParam(raw: string | null, min: number, max: number): number | null {
  if (raw === null || !/^\d{1,5}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

/** Период по умолчанию при переходе на месяц: текущий месяц для текущего года, иначе декабрь. */
export function defaultMonth(year: number, today: Today): number {
  return year === today.year ? today.month : 12;
}

/** Выбор из searchParams. Мусор заменяется значениями по умолчанию, будущее обрезается до сегодняшнего дня. */
export function parseSelection(sp: URLSearchParams, today: Today): Selection {
  const period: PeriodType = sp.get('period') === 'month' ? 'month' : 'year';
  let year = intParam(sp.get('year'), 2000, 2100) ?? today.year;
  if (year > today.year) year = today.year;
  if (period === 'year') return { period, year, month: null };
  let month = intParam(sp.get('month'), 1, 12) ?? defaultMonth(year, today);
  if (year === today.year && month > today.month) month = today.month;
  return { period, year, month };
}

export function selectionToParams(s: Selection): URLSearchParams {
  const p = new URLSearchParams({ period: s.period, year: String(s.year) });
  if (s.period === 'month' && s.month !== null) p.set('month', String(s.month));
  return p;
}

export function selectionKey(s: Selection): string {
  return selectionToParams(s).toString();
}

export function setPeriodType(s: Selection, period: PeriodType, today: Today): Selection {
  if (period === s.period) return s;
  return period === 'year' ? { period, year: s.year, month: null } : { period, year: s.year, month: defaultMonth(s.year, today) };
}

/** Шаг стрелками. null, если уходит за доступные годы (минимум из `years`) или в будущее. */
export function shiftSelection(s: Selection, dir: -1 | 1, years: readonly number[], today: Today): Selection | null {
  const minYear = years.length ? Math.min(...years, today.year) : today.year;
  if (s.period === 'year') {
    const y = s.year + dir;
    return y < minYear || y > today.year ? null : { period: 'year', year: y, month: null };
  }
  let y = s.year;
  let m = (s.month ?? 1) + dir;
  if (m < 1) { m = 12; y -= 1; }
  if (m > 12) { m = 1; y += 1; }
  if (y < minYear || y > today.year || (y === today.year && m > today.month)) return null;
  return { period: 'month', year: y, month: m };
}

export function periodLabel(s: Selection): string {
  return s.period === 'year' ? String(s.year) : `${monthName(s.month ?? 1)} ${s.year}`;
}

/** Часы с одним знаком: «31,5», «40» (без «,0»). */
export function formatHours(n: number): string {
  const r = Math.round(n * 10) / 10;
  const [int, frac] = r.toFixed(1).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return frac === '0' ? grouped : `${grouped},${frac}`;
}

/** «2026-03-04» -> «04.03.2026». Невалидное -> null. */
export function formatIsoDay(day: string | null): string | null {
  const m = day ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

const ESTIMATE_RULE = 'распределены равномерно между первым и последним запуском игры.';

/**
 * Плашка оценки часов (design-system §4.11). Показывается, если в периоде есть оценочные часы.
 * `firstSnapshotDate` = граница: до неё часы оценены, после измеряются по снимкам. Снимков нет вообще: вариант без даты.
 */
export function estimateNote(firstSnapshotDate: string | null): string {
  const d = formatIsoDay(firstSnapshotDate);
  return d
    ? `До ${d} часы оценены: ${ESTIMATE_RULE} С этой даты часы измеряются по ежедневным снимкам.`
    : `Часы оценены: ${ESTIMATE_RULE} Точные данные появятся после ежедневных синков.`;
}

export type HoursBar = {
  month: number; label: string;
  /** полные часы месяца (измеренные + оценка), null = нет данных */
  value: number | null;
  /** измеренная часть (снизу) */
  real: number;
  /** оценочная часть (сверху) */
  estimated: number;
  /** высота всего столбца, % от максимума (ненулевые не меньше 3%) */
  heightPct: number;
  /** доля измеренной части в высоте столбца, 0..100 (оценочная = остаток) */
  realShare: number;
  /** название месяца с годом: «Март 2026» */
  title: string;
  /** aria-label столбца */
  text: string;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * 12 столбцов-стеков: измеренная часть снизу (`byMonth - estimatedByMonth`), оценочная сверху.
 * Месяц без часов (null или 0) без столбца, высота 0.
 */
export function hoursBars(byMonth: readonly (number | null)[], estimatedByMonth: readonly number[] = [], year?: number): HoursBar[] {
  const max = Math.max(0, ...byMonth.map((v) => v ?? 0));
  return MONTH_LABELS.map((label, i) => {
    const v = byMonth[i] ?? null;
    const full = monthName(i + 1);
    const title = year === undefined ? full : `${full} ${year}`;
    if (v === null) {
      return { month: i + 1, label, value: null, real: 0, estimated: 0, heightPct: 0, realShare: 0, title, text: `${title}: нет данных по часам` };
    }
    const estimated = Math.min(v, Math.max(0, estimatedByMonth[i] ?? 0));
    const real = round1(Math.max(0, v - estimated));
    const est = round1(estimated);
    const heightPct = max > 0 && v > 0 ? Math.max(3, (v / max) * 100) : 0;
    const realShare = v > 0 ? (real / v) * 100 : 0;
    const text = est > 0 ? `${title}: ${formatHours(v)} ч, из них ${formatHours(est)} ч оценка` : `${title}: ${formatHours(v)} ч`;
    return { month: i + 1, label, value: v, real, estimated: est, heightPct, realShare, title, text };
  });
}

/** Есть ли в столбцах года оценочная часть (определяется по `estimatedByMonth`, контракт §10.1). */
export const barsHaveEstimate = (bars: readonly HoursBar[]) => bars.some((b) => b.estimated > 0);

/** Какой столбец подсвечен: выбранный месяц, иначе текущий месяц текущего года. */
export function highlightedMonth(s: Selection, today: Today): number | null {
  if (s.period === 'month') return s.month;
  return s.year === today.year ? today.month : null;
}

export type GenreBar = { key: string; label: string; widthPct: number; text: string };

export function genreBars(items: readonly StatsGenreItem[]): GenreBar[] {
  const max = Math.max(0, ...items.map((i) => i.value));
  return items.slice(0, 8).map((i) => ({
    key: i.key,
    label: i.label,
    widthPct: max > 0 ? Math.max(2, (i.value / max) * 100) : 0,
    text: formatHours(i.value),
  }));
}

export type LinePoint = { month: number; value: number; x: number; y: number };

/** Точки линии в координатах viewBox: колонка i по центру (как столбцы часов), ось Y перевёрнута. */
export function linePoints(values: readonly number[], width: number, height: number, pad: number): LinePoint[] {
  const max = Math.max(0, ...values);
  const inner = height - pad * 2;
  return values.map((v, i) => ({
    month: i + 1,
    value: v,
    x: ((i + 0.5) / values.length) * width,
    y: max > 0 ? pad + inner * (1 - v / max) : height - pad,
  }));
}

export function linePath(points: readonly LinePoint[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

/**
 * Нет ничего показывать за период. `hours.byMonth` контракт отдаёт за весь год, поэтому для месяца его не учитываем:
 * иначе пустой месяц внутри года с данными не покажет пустое состояние.
 */
export function isEmptyPeriod(d: StatsResponse, period: PeriodType): boolean {
  const hoursEmpty = period === 'month' || d.hours.byMonth.every((v) => v === null || v === 0);
  return d.header.completed === 0 && d.header.dropped === 0 && (d.header.hours ?? 0) === 0 && d.trophies.counts.total === 0
    && d.played.groups.length === 0 && !d.genres.hasData && hoursEmpty;
}

/**
 * Часы игры за месяц в «Играх месяца»: «12 ч 30 м», при оценке «≈ 12 ч 30 м».
 * 0 часов (игра попала в месяц только по завершению) = null, строка не выводится. label для скринридера без «≈».
 */
export function monthHoursText(hours: number, estimated: boolean): { text: string; label: string } | null {
  if (!Number.isFinite(hours) || hours <= 0) return null;
  const t = formatPlayTime(Math.round(hours * 3600));
  if (!t) return null;
  return estimated ? { text: `≈ ${t}`, label: `примерно ${t} за месяц` } : { text: t, label: `${t} за месяц` };
}

/** Число разных игр в «Играх месяца» (одна игра может быть в нескольких месяцах). */
export function playedGamesCount(groups: readonly PlayedGroup[]): number {
  return new Set(groups.flatMap((g) => g.items.map((i) => i.game.id))).size;
}
