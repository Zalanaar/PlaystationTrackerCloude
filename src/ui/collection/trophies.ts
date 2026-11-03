// Чистая логика вкладки «Трофеи» окна игры (design-system §4.15): фильтр, сортировка, редкость, подписи.
import type { GameTrophyGroup, GameTrophyItem } from '@/server/collection/types';
import { plural } from '../format';

export type TrophyFilter = 'all' | 'earned' | 'locked';
export type TrophySort = 'game' | 'rare' | 'common' | 'recent';

export const TROPHY_FILTERS: readonly { id: TrophyFilter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'earned', label: 'Получено' },
  { id: 'locked', label: 'Не получено' },
];

export const TROPHY_SORTS: readonly { id: TrophySort; label: string }[] = [
  { id: 'game', label: 'Как в игре' },
  { id: 'rare', label: 'Сначала редкие' },
  { id: 'common', label: 'Сначала обычные' },
  { id: 'recent', label: 'Недавно полученные' },
];

/** Длинный список: больше LONG_LIST строк показываем по PAGE штук. */
export const TROPHY_PAGE = 100;
export const TROPHY_LONG_LIST = 200;

export const RARITY_LABELS = ['Ультра-редкий', 'Очень редкий', 'Редкий', 'Обычный'] as const;
export const TROPHY_TYPE_LABELS: Record<GameTrophyItem['type'], string> = {
  platinum: 'Платина', gold: 'Золото', silver: 'Серебро', bronze: 'Бронза',
};
export const HIDDEN_TITLE = 'Скрытый трофей';
export const HIDDEN_DETAIL = 'Описание откроется после получения';

export function trophyCounts(list: readonly GameTrophyItem[]): { all: number; earned: number; locked: number } {
  const earned = list.filter((t) => t.earned).length;
  return { all: list.length, earned, locked: list.length - earned };
}

export function filterTrophies(list: readonly GameTrophyItem[], f: TrophyFilter): GameTrophyItem[] {
  return list.filter((t) => f === 'all' || (f === 'earned' ? t.earned : !t.earned));
}

const byId = (a: GameTrophyItem, b: GameTrophyItem) => a.setId - b.setId || a.trophyId - b.trophyId;
/** null всегда в конце; сравнение по возрастанию, `dir` меняет порядок только у не-null. */
const nullsLast = (a: number | null, b: number | null, dir: 1 | -1): number => (a === b ? 0 : a === null ? 1 : b === null ? -1 : dir * (a - b));

/** Сортировка (новый массив). Ничья везде: `setId`, `trophyId`. */
export function sortTrophies(list: readonly GameTrophyItem[], sort: TrophySort): GameTrophyItem[] {
  const out = [...list];
  switch (sort) {
    case 'game':
      return out.sort(byId);
    case 'rare':
      return out.sort((a, b) => nullsLast(a.rarity, b.rarity, 1) || nullsLast(a.earnedRate, b.earnedRate, 1) || byId(a, b));
    case 'common':
      return out.sort((a, b) => nullsLast(a.rarity, b.rarity, -1) || nullsLast(a.earnedRate, b.earnedRate, -1) || byId(a, b));
    case 'recent': {
      const at = (t: GameTrophyItem) => (t.earned && t.earnedAt ? new Date(t.earnedAt).getTime() : null);
      // получен с датой (новые первыми) -> получен без даты -> не получен
      const rank = (t: GameTrophyItem) => (at(t) !== null ? 0 : t.earned ? 1 : 2);
      return out.sort((a, b) => rank(a) - rank(b) || (at(b) ?? 0) - (at(a) ?? 0) || byId(a, b));
    }
  }
}

/** DLC-трофей: группа задана и не `default` (контракт 15.3). Платина всегда в базе. */
export const isDlcTrophy = (t: Pick<GameTrophyItem, 'groupId' | 'type'>): boolean =>
  t.type !== 'platinum' && t.groupId != null && t.groupId !== 'default';

export const trophyTitle = (t: Pick<GameTrophyItem, 'name'>): string => t.name ?? HIDDEN_TITLE;

/** «Ультра-редкий» и т.д.; null = редкость неизвестна. */
export function rarityLabel(rarity: number | null): string | null {
  return rarity !== null && rarity >= 0 && rarity <= 3 ? RARITY_LABELS[rarity] : null;
}

/** Сколько из 4 сегментов заполнено: 0 -> 4, 1 -> 3, 2 -> 2, 3 -> 1, null -> 0. */
export function raritySegments(rarity: number | null): number {
  return rarity !== null && rarity >= 0 && rarity <= 3 ? 4 - rarity : 0;
}

/** «2,4%», меньше 0,1 -> «<0,1%», null -> null. */
export function formatRate(rate: number | null): string | null {
  if (rate === null || !Number.isFinite(rate)) return null;
  if (rate < 0.1) return '<0,1%';
  return `${rate.toFixed(1).replace('.', ',')}%`;
}

/** Сколько строк показать: до TROPHY_LONG_LIST все, дальше порциями по TROPHY_PAGE. */
export function visibleTrophyCount(total: number, shown: number): number {
  return total <= TROPHY_LONG_LIST ? total : Math.min(total, Math.max(TROPHY_PAGE, shown));
}

/** Дата получения платины игры (из списка трофеев) или null. */
export function platinumEarnedAt(list: readonly GameTrophyItem[]): string | null {
  const p = list.find((t) => t.type === 'platinum' && t.earned);
  return p?.earnedAt ?? null;
}

/** aria-label строки: тип, название, состояние. */
export function trophyAria(t: GameTrophyItem): string {
  return `${TROPHY_TYPE_LABELS[t.type]}: ${trophyTitle(t)}${isDlcTrophy(t) ? ', DLC' : ''}${t.hidden ? ', скрытый' : ''}${t.earned ? '' : ', не получено'}`;
}

/** Пакет 5: раздел списка трофеев — основная игра или одно дополнение (сет + группа). */
export type TrophySection = { key: string; title: string; dlc: boolean; items: GameTrophyItem[]; earned: number; total: number };

const sectionKey = (t: GameTrophyItem): string => (isDlcTrophy(t) ? `${t.setId}:${t.groupId}` : 'base');

/**
 * Пакет 5: делит уже отфильтрованный и отсортированный список на «Основная игра» и дополнения (порядок внутри сохраняется).
 * Название дополнения из групп PSN, без названия — «Дополнение N». earned/total считаются по полному списку `all`. Без дополнений — один раздел.
 */
export function trophySections(rows: readonly GameTrophyItem[], all: readonly GameTrophyItem[], groups: readonly GameTrophyGroup[] = []): TrophySection[] {
  const name = new Map<string, string | null>(groups.map((g) => [`${g.setId}:${g.groupId}`, g.name]));
  const keys = [...new Set(all.map(sectionKey))].sort((a, b) => (a === 'base' ? -1 : b === 'base' ? 1 : a.localeCompare(b, 'en', { numeric: true })));
  const dlcNo = new Map(keys.filter((k) => k !== 'base').map((k, i) => [k, i + 1] as const));
  const out: TrophySection[] = [];
  for (const key of keys) {
    const items = rows.filter((t) => sectionKey(t) === key);
    if (items.length === 0) continue;
    const full = all.filter((t) => sectionKey(t) === key);
    const title = key === 'base' ? 'Основная игра' : (name.get(key)?.trim() || `Дополнение ${dlcNo.get(key)}`);
    out.push({ key, title, dlc: key !== 'base', items, earned: full.filter((t) => t.earned).length, total: full.length });
  }
  return out;
}

export const launchWord = (n: number) => plural(n, ['запуск', 'запуска', 'запусков']);
