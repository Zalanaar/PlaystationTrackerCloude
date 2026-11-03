// Пакет 5: чистая логика блока «Игры с других платформ» в Коллекции и окна записи. Без React.
import { plural } from '../format';
import type { OtherPlatformGame } from './api';

export type OtherStatus = NonNullable<OtherPlatformGame['status']>;
/** Порядок кнопок статуса в окне: △ ○ □ ✕ */
export const OTHER_STATUS_ORDER: readonly OtherStatus[] = ['playing', 'completed', 'backlog', 'dropped'];

export type PlatformChip = 'Switch' | 'Xbox' | 'PC';
export const PLATFORM_CHIPS: readonly PlatformChip[] = ['Switch', 'Xbox', 'PC'];

/** Подпись RAWG («Nintendo Switch», «Xbox Series S/X», «PC», «macOS»…) → чип; не узнали → null. */
export function platformChip(label: string | null): PlatformChip | null {
  if (!label) return null;
  const s = label.toLowerCase();
  if (/switch|nintendo/.test(s)) return 'Switch';
  if (/xbox/.test(s)) return 'Xbox';
  if (/\bpc\b|windows|mac ?os|linux|steam/.test(s)) return 'PC';
  return null;
}

/** Год записи для хроники: год смены статуса у ○ пройдено и ✕ брошено (МСК, как хроника); иначе null → «Не распределено». */
export function otherYear(g: OtherPlatformGame): number | null {
  if ((g.status !== 'completed' && g.status !== 'dropped') || !g.statusChangedAt) return null;
  const t = Date.parse(g.statusChangedAt);
  return Number.isFinite(t) ? new Date(t + 3 * 3600_000).getUTCFullYear() : null;
}

export type OtherGroup = { key: string; year: number | null; title: string; items: OtherPlatformGame[] };

/** Группы блока: годы по убыванию, затем «Не распределено». Внутри: новее статус сверху, затем по названию. */
export function otherGroups(items: readonly OtherPlatformGame[]): OtherGroup[] {
  const by = new Map<number | null, OtherPlatformGame[]>();
  for (const g of items) {
    const y = otherYear(g);
    by.set(y, [...(by.get(y) ?? []), g]);
  }
  const sortIn = (a: OtherPlatformGame, b: OtherPlatformGame) =>
    (b.statusChangedAt ?? '').localeCompare(a.statusChangedAt ?? '') || a.title.localeCompare(b.title, 'ru') || a.id - b.id;
  const years = [...by.keys()].filter((y): y is number => y !== null).sort((a, b) => b - a);
  const out: OtherGroup[] = years.map((y) => ({ key: `op-y${y}`, year: y, title: String(y), items: [...by.get(y)!].sort(sortIn) }));
  const rest = by.get(null);
  if (rest?.length) out.push({ key: 'op-unsorted', year: null, title: 'Не распределено', items: [...rest].sort(sortIn) });
  return out;
}

export type OtherStats = {
  total: number;
  byPlatform: { label: string; n: number }[];
  byStatus: Record<OtherStatus, number>;
  /** средняя оценка с одним знаком, null без оценок */
  avgRating: number | null;
  rated: number;
};

/** Маленькая сводка блока (спека 5.9): только эти записи, ни в какой другой статистике они не участвуют. */
export function otherStats(items: readonly OtherPlatformGame[]): OtherStats {
  const plat = new Map<string, number>();
  const byStatus: Record<OtherStatus, number> = { playing: 0, completed: 0, backlog: 0, dropped: 0 };
  let sum = 0;
  let rated = 0;
  for (const g of items) {
    const p = platformChip(g.platformLabel) ?? (g.platformLabel ? 'Другая' : 'Не указана');
    plat.set(p, (plat.get(p) ?? 0) + 1);
    if (g.status) byStatus[g.status]++;
    if (g.rating !== null) { sum += g.rating; rated++; }
  }
  const order = (l: string) => { const i = (PLATFORM_CHIPS as readonly string[]).indexOf(l); return i < 0 ? (l === 'Другая' ? 3 : 4) : i; };
  return {
    total: items.length,
    byPlatform: [...plat.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => order(a.label) - order(b.label)),
    byStatus,
    avgRating: rated ? Math.round((sum / rated) * 10) / 10 : null,
    rated,
  };
}

export const gamesText = (n: number): string => `${n} ${plural(n, ['игра', 'игры', 'игр'])}`;
