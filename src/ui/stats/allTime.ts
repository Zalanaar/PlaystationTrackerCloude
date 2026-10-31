// Чистая логика режима «Всё время» (Фаза 25, design-system §12.2-12.5): годы, столбцы, плашка охвата.
import type { HoursYear, StatsResponse, TrophyCountsByType } from '@/server/stats/types';
import { formatNumber, plural } from '../format';
import { formatHours, formatIsoDay } from './model';

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Порог показа «Не отнесено к годам»: меньше 0,1 ч скрываем (шум округления). */
export const UNATTRIBUTED_MIN = 0.1;

export const showUnattributed = (u: number | null | undefined): u is number => typeof u === 'number' && Math.abs(u) >= UNATTRIBUTED_MIN;

/** «Не отнесено к годам: 40 ч» (минус как есть: «−12 ч»). null, если |значение| < 0,1. */
export function unattributedText(u: number | null | undefined): string | null {
  if (!showUnattributed(u)) return null;
  return `Не отнесено к годам: ${u < 0 ? '−' : ''}${formatHours(Math.abs(u))} ч`;
}

/** «2014 – 2026»; один год = «2026». */
export function yearRange(years: readonly number[], currentYear: number): string {
  const first = years.length ? Math.min(...years, currentYear) : currentYear;
  return first >= currentYear ? String(currentYear) : `${first} – ${currentYear}`;
}

/**
 * Плашка охвата снимками (§12.3). Нет оценочных часов: плашки нет (null).
 * «Итог равен сумме PSN» не пишем, если unattributed != 0 (решение оркестратора): итог тогда не равен сумме по годам.
 */
export function coverageNote(firstSnapshotDate: string | null, hasEstimate: boolean, unattributed: number | null | undefined): string | null {
  if (!hasEstimate) return null;
  const rule = 'часы оценены (равномерно между первым и последним запуском игры).';
  const tail = showUnattributed(unattributed) ? '' : ' Итог за всё время равен сумме PSN.';
  const d = formatIsoDay(firstSnapshotDate);
  return d
    ? `Точные часы по дням ведутся с ${d}. До этой даты PSN историю не отдавал: ${rule}${tail}`
    : `Все часы оценены: PSN отдаёт только сумму. Точные данные появятся после ежедневных синков.`;
}

export type YearHoursBar = {
  year: number; label: string; value: number; real: number; estimated: number;
  /** высота столбца, % от максимума, ненулевые не ниже 3 */
  heightPct: number; realShare: number;
  /** пустой слот (часов нет): подпись остаётся, фокуса нет */
  empty: boolean;
  /** оценочная доля >= 50% */
  mostlyEstimated: boolean;
  /** год целиком оценка */
  allEstimated: boolean;
  text: string;
};

export function yearHoursBars(byYear: readonly HoursYear[]): YearHoursBar[] {
  const max = Math.max(0, ...byYear.map((y) => y.hours));
  return byYear.map((y) => {
    const value = Math.max(0, y.hours);
    const estimated = Math.min(value, Math.max(0, y.estimatedHours));
    const real = round1(Math.max(0, value - estimated));
    const est = round1(estimated);
    const empty = value <= 0;
    const text = empty ? `${y.year}: часов нет` : est > 0 ? `${y.year}: ${formatHours(value)} ч, из них ${formatHours(est)} ч оценка` : `${y.year}: ${formatHours(value)} ч`;
    return {
      year: y.year, label: String(y.year), value, real, estimated: est,
      heightPct: empty || max <= 0 ? 0 : Math.max(3, (value / max) * 100),
      realShare: value > 0 ? (real / value) * 100 : 0,
      empty, mostlyEstimated: !empty && est / value >= 0.5, allEstimated: !empty && real <= 0 && est > 0, text,
    };
  });
}

export type TrophyKind = 'platinum' | 'gold' | 'silver' | 'bronze';
/** Снизу вверх (§12.5). */
export const TROPHY_STACK: readonly { kind: TrophyKind; label: string }[] = [
  { kind: 'bronze', label: 'Бронза' }, { kind: 'silver', label: 'Серебро' }, { kind: 'gold', label: 'Золото' }, { kind: 'platinum', label: 'Платина' },
];

export type YearTrophyBar = {
  year: number; label: string; counts: TrophyCountsByType; heightPct: number; empty: boolean; text: string;
};

export const trophiesWord = (n: number) => `${formatNumber(n)} ${plural(n, ['трофей', 'трофея', 'трофеев'])}`;

export function yearTrophyBars(byYear: readonly (TrophyCountsByType & { year: number })[]): YearTrophyBar[] {
  const max = Math.max(0, ...byYear.map((y) => y.total));
  return byYear.map((y) => {
    const empty = y.total <= 0;
    const text = empty
      ? `${y.year}: трофеев нет`
      : `${y.year}: ${trophiesWord(y.total)}${y.platinum > 0 ? `, платин ${y.platinum}` : ''}`;
    return { year: y.year, label: String(y.year), counts: y, heightPct: empty || max <= 0 ? 0 : Math.max(3, (y.total / max) * 100), empty, text };
  });
}

export type FinishedYearRow = { year: number; completed: number; dropped: number; completedPct: number; droppedPct: number; text: string };

/** Строки по убыванию года, годы без пройденных и брошенных не выводятся; шкала общая, максимум среди ○ и ✕. */
export function finishedYearRows(byYear: readonly { year: number; completed: number; dropped: number }[]): FinishedYearRow[] {
  const rows = byYear.filter((y) => y.completed > 0 || y.dropped > 0);
  const max = Math.max(0, ...rows.flatMap((y) => [y.completed, y.dropped]));
  return rows
    .map((y) => ({
      year: y.year, completed: y.completed, dropped: y.dropped,
      completedPct: max > 0 ? (y.completed / max) * 100 : 0, droppedPct: max > 0 ? (y.dropped / max) * 100 : 0,
      text: `${y.year}: пройдено ${y.completed}, брошено ${y.dropped}. Открыть год`,
    }))
    .sort((a, b) => b.year - a.year);
}

/** Есть ли что показать в блоке часов по годам. */
export const hasYearHours = (d: StatsResponse) => (d.hours.byYear ?? []).some((y) => y.hours > 0);
