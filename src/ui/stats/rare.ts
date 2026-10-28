// Чистая логика «Редких трофеев» (спека Фазы 15 п.7, контракт 14.1). Общая для Статистики и Итогов.
import type { RareTrophy, StatsResponse } from '@/server/stats/types';
import { formatDayMonth } from '../format';
import { formatRate, rarityLabel, raritySegments } from '../collection/trophies';

export type RareScope = 'period' | 'allTime';

export const RARE_SUBTITLE = '5 самых редких из выбитых: чем меньше процент игроков, тем реже';
export const RARE_EMPTY: Record<RareScope, string> = {
  period: 'Редких трофеев за этот период нет',
  allTime: 'Трофеев с известной редкостью пока нет',
};
export const TROPHY_TYPE_WORD: Record<RareTrophy['type'], string> = { platinum: 'Платина', gold: 'Золото', silver: 'Серебро', bronze: 'Бронза' };
export const RARE_SLIDE_TITLE = 'Твои самые редкие трофеи';
export const UNKNOWN_RARITY = 'Редкость неизвестна';

/** Список по выбранной области. Старый ответ без блока даёт пустой список. */
export function rareList(rt: StatsResponse['rareTrophies'] | undefined, scope: RareScope): RareTrophy[] {
  return (rt?.[scope] ?? []).slice(0, 5);
}

export type RareRow = {
  key: string;
  rank: number;
  type: RareTrophy['type'];
  typeWord: string;
  name: string;
  detail: string | null;
  iconUrl: string | null;
  /** название игры или набора, либо «Игра вне коллекции» */
  gameName: string;
  coverUrl: string | null;
  gameId: number | null;
  /** «2 мар. 2026» или «дата неизвестна» */
  date: string;
  rate: string;
  rarity: string;
  segments: number;
  rarityKnown: boolean;
  aria: string;
};

export function rareRows(list: readonly RareTrophy[]): RareRow[] {
  return list.map((t, i) => {
    const rate = formatRate(t.earnedRate) ?? '—';
    const label = rarityLabel(t.rarity);
    const gameName = t.game?.title ?? (t.setName.trim() || 'Игра вне коллекции');
    const date = formatDayMonth(t.earnedAt, true) ?? 'дата неизвестна';
    const name = t.name?.trim() || 'Без названия';
    return {
      key: `${t.setId}-${t.trophyId}`, rank: i + 1, type: t.type, typeWord: TROPHY_TYPE_WORD[t.type], name, detail: t.detail,
      iconUrl: t.iconUrl, gameName, coverUrl: t.game?.coverUrl ?? null, gameId: t.game?.id ?? null, date, rate,
      rarity: label ?? UNKNOWN_RARITY, segments: raritySegments(t.rarity), rarityKnown: label !== null,
      aria: `${i + 1}. ${name}. ${TROPHY_TYPE_WORD[t.type]}. ${gameName}. ${date}. Получили ${rate} игроков${label ? `, ${label.toLowerCase()}` : ''}`,
    };
  });
}
