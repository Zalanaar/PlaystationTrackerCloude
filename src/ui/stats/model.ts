// Чистая логика экрана «Статистика»: параметры URL, навигация по периодам, подготовка данных для графиков.
import type { StatsGenreItem } from '@/server/stats/types';
import { mskParts, monthName } from '../format';

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

export function partialNote(firstSnapshotDate: string | null): string {
  const d = formatIsoDay(firstSnapshotDate);
  return d
    ? `Часы считаются с даты первого синка (${d}). Для более ранних периодов показаны только трофеи.`
    : 'Часы начнут считаться после первого синка. Пока показаны только трофеи.';
}

export type HoursBar = { month: number; label: string; value: number | null; heightPct: number; text: string };

/** 12 столбцов: высота в % от максимума (ненулевые не меньше 3%), null без высоты. */
export function hoursBars(byMonth: readonly (number | null)[]): HoursBar[] {
  const max = Math.max(0, ...byMonth.map((v) => v ?? 0));
  return MONTH_LABELS.map((label, i) => {
    const v = byMonth[i] ?? null;
    const full = monthName(i + 1);
    if (v === null) return { month: i + 1, label, value: null, heightPct: 0, text: `${full}: нет данных по часам` };
    const heightPct = max > 0 && v > 0 ? Math.max(3, (v / max) * 100) : 0;
    return { month: i + 1, label, value: v, heightPct, text: `${full}: ${formatHours(v)} ч` };
  });
}

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
