// Хроника (design-system §4.3, §4.8): пройденное и брошенное по годам и месяцам даты завершения (Europe/Moscow).
import type { GameItem, StatusCounts } from '@/server/collection/types';
import { mskParts } from '../format';

export type ChronicleMonth = { month: number; games: GameItem[]; completed: number; dropped: number };
export type ChronicleYear = {
  year: number;
  months: ChronicleMonth[];
  completed: number;
  dropped: number;
  /** сумма полных часов игр группы (не часы периода) */
  seconds: number;
  total: number;
};
export type Chronicle = { years: ChronicleYear[]; undated: GameItem[]; undatedCompleted: number; undatedDropped: number; undatedSeconds: number };

/** Дата завершения: у пройденной completedAt, у брошенной droppedAt (контракт: coalesce). */
export function finishedAt(g: Pick<GameItem, 'status' | 'completedAt' | 'droppedAt'>): string | null {
  if (g.status === 'completed') return g.completedAt ?? null;
  if (g.status === 'dropped') return g.droppedAt ?? null;
  return null;
}

function ms(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Детерминированное сравнение строк без ICU/локали: по toLowerCase через < / >.
 * Тот же алгоритм, что на сервере (src/server/common/compare.ts); UI сервер не импортирует.
 */
export function compareText(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Новые первыми; при равенстве по названию, затем id (стабильно). */
function byFinishedDesc(a: GameItem, b: GameItem): number {
  const d = ms(finishedAt(b) ?? '') - ms(finishedAt(a) ?? '');
  return d || compareText(a.title, b.title) || a.id - b.id;
}

export function groupChronicle(games: readonly GameItem[]): Chronicle {
  const years = new Map<number, Map<number, GameItem[]>>();
  const undated: GameItem[] = [];
  for (const g of games) {
    if (g.status !== 'completed' && g.status !== 'dropped') continue;
    const iso = finishedAt(g);
    if (!iso || Number.isNaN(new Date(iso).getTime())) {
      undated.push(g);
      continue;
    }
    const { y, m } = mskParts(new Date(iso).getTime());
    const ym = years.get(y) ?? new Map<number, GameItem[]>();
    const list = ym.get(m) ?? [];
    list.push(g);
    ym.set(m, list);
    years.set(y, ym);
  }
  const count = (list: GameItem[], s: 'completed' | 'dropped') => list.filter((g) => g.status === s).length;
  const sum = (list: GameItem[]) => list.reduce((a, g) => a + g.playSeconds, 0);
  const outYears: ChronicleYear[] = [...years.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, ym]) => {
      const months: ChronicleMonth[] = [...ym.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([month, list]) => {
          const sorted = [...list].sort(byFinishedDesc);
          return { month, games: sorted, completed: count(sorted, 'completed'), dropped: count(sorted, 'dropped') };
        });
      const all = months.flatMap((m) => m.games);
      return { year, months, completed: count(all, 'completed'), dropped: count(all, 'dropped'), seconds: sum(all), total: all.length };
    });
  undated.sort((a, b) => compareText(a.title, b.title) || a.id - b.id);
  return { years: outYears, undated, undatedCompleted: count(undated, 'completed'), undatedDropped: count(undated, 'dropped'), undatedSeconds: sum(undated) };
}

export type PlayedYear = { year: number; games: GameItem[]; seconds: number; total: number };
export type PlayedGroups = { years: PlayedYear[]; never: GameItem[]; neverSeconds: number };

/**
 * Сортировка «По последней игре» (§4.3): группы по году `lastPlayedAt` (МСК).
 * Годы по `order` (desc: свежие сверху), игры без запуска (нет даты или битая) — группа «Не запускались» в конце.
 * Внутри группы порядок входа сохраняется (порядок сервера), поэтому подгрузка следующей страницы продолжает группу.
 */
export function groupByLastPlayedYear(games: readonly GameItem[], order: 'asc' | 'desc' = 'desc'): PlayedGroups {
  const years = new Map<number, GameItem[]>();
  const never: GameItem[] = [];
  for (const g of games) {
    const t = g.lastPlayedAt ? new Date(g.lastPlayedAt).getTime() : NaN;
    if (Number.isNaN(t)) {
      never.push(g);
      continue;
    }
    const { y } = mskParts(t);
    const list = years.get(y) ?? [];
    list.push(g);
    years.set(y, list);
  }
  const sum = (list: GameItem[]) => list.reduce((a, g) => a + g.playSeconds, 0);
  const dir = order === 'asc' ? 1 : -1;
  return {
    years: [...years.entries()]
      .sort((a, b) => dir * (a[0] - b[0]))
      .map(([year, list]) => ({ year, games: list, seconds: sum(list), total: list.length })),
    never,
    neverSeconds: sum(never),
  };
}

/** Какие годы раскрыты по умолчанию: текущий (МСК), а если его нет в хронике, самый свежий. */
export function defaultExpandedYears(years: readonly number[], nowMs: number): Set<number> {
  if (!years.length) return new Set();
  const cur = mskParts(nowMs).y;
  return new Set([years.includes(cur) ? cur : Math.max(...years)]);
}

/** Сколько обложек в превью одним рядом: cols - 1 и плитка «+N ещё», либо все, если помещаются в ряд. */
export function previewSlots(total: number, cols: number): { shown: number; rest: number } {
  if (total <= cols) return { shown: total, rest: 0 };
  return { shown: Math.max(1, cols - 1), rest: total - Math.max(1, cols - 1) };
}

/** Число колонок сетки по ширине окна (зеркало брейкпоинтов tokens.css). */
export function gridCols(width: number, density: 'comfort' | 'dense'): number {
  const row = width >= 1280 ? [6, 10] : width >= 1024 ? [5, 8] : width >= 768 ? [4, 6] : [2, 3];
  return density === 'dense' ? row[1] : row[0];
}

/** Порядок «Играю/Бэклог/Отложено/Не разобрано»: последний запуск (новые первыми, пустые в конце), затем название. */
export function byLastPlayed(a: GameItem, b: GameItem): number {
  if (a.lastPlayedAt !== b.lastPlayedAt) {
    if (!a.lastPlayedAt) return 1;
    if (!b.lastPlayedAt) return -1;
    return ms(b.lastPlayedAt) - ms(a.lastPlayedAt);
  }
  return compareText(a.title, b.title) || a.id - b.id;
}

export function emptyCounts(): StatusCounts {
  return { all: 0, playing: 0, completed: 0, dropped: 0, backlog: 0, shelved: 0, service: 0, none: 0 };
}
