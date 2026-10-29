// Чипы месяцев и сплошная сетка Хроники (docs/design-system.md §8.2). Чистая логика, без React.
import type { GameItem } from '@/server/collection/types';
import { monthName } from '../format';
import type { ChronicleYear } from './chronicle';

export const MONTH_CHIP_LABELS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'] as const;

export type MonthChip = {
  /** YYYY-MM */
  key: string;
  month: number;
  label: string;
  count: number;
  /** «Октябрь: 3 пройдено, 1 брошено» */
  aria: string;
  /** id первой карточки месяца в сетке: `m2026-10` */
  anchorId: string;
};

const pad = (n: number) => String(n).padStart(2, '0');

/** `m2026-10`: id первой карточки (строки) месяца. */
export function monthAnchorId(year: number, month: number): string {
  return `m${year}-${pad(month)}`;
}

/** «Октябрь: 3 пройдено, 1 брошено»; нулевая часть опускается. */
export function monthChipAria(month: number, completed: number, dropped: number): string {
  const parts: string[] = [];
  if (completed > 0) parts.push(`${completed} пройдено`);
  if (dropped > 0) parts.push(`${dropped} брошено`);
  return `${monthName(month)}: ${parts.join(', ')}`;
}

/** Чипы года: только месяцы с играми, в порядке сетки (новые первыми). Меньше двух месяцев: чипов нет. */
export function yearMonthChips(y: Pick<ChronicleYear, 'year' | 'months'>): MonthChip[] {
  const months = y.months.filter((m) => m.games.length > 0);
  if (months.length < 2) return [];
  return months.map((m) => ({
    key: `${y.year}-${pad(m.month)}`,
    month: m.month,
    label: MONTH_CHIP_LABELS[m.month - 1] ?? '',
    count: m.games.length,
    aria: monthChipAria(m.month, m.completed, m.dropped),
    anchorId: monthAnchorId(y.year, m.month),
  }));
}

/** Игры раскрытого года одной лентой: месяцы новыми первыми, внутри месяца по дате завершения (уже отсортированы groupChronicle). */
export function flatYearGames(y: Pick<ChronicleYear, 'months'>): GameItem[] {
  return y.months.flatMap((m) => m.games);
}

/** gameId первой игры месяца -> id якоря. */
export function anchorsByGame(y: Pick<ChronicleYear, 'year' | 'months'>): Map<number, string> {
  const out = new Map<number, string>();
  for (const m of y.months) if (m.games.length > 0) out.set(m.games[0].id, monthAnchorId(y.year, m.month));
  return out;
}

/**
 * Текущий месяц: последний (нижний) якорь, верх которого уже не ниже границы под полосой;
 * если ни один не дошёл, первый. `tops` в порядке DOM (сверху вниз), `limit` = граница, `eps` = допуск.
 */
export function currentMonthIndex(tops: readonly number[], limit: number, eps = 2): number {
  if (tops.length === 0) return -1;
  let cur = 0;
  for (let i = 0; i < tops.length; i++) if (tops[i] <= limit + eps) cur = i;
  return cur;
}
