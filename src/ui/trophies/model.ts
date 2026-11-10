// F3 «Лента трофеев»: чистая часть UI (группы дней МСК, подписи, сводка, адреса). Даты приходят с сервера как «YYYY-MM-DD» МСК.
import type { FeedItem, FeedPeriod, FeedResponse, FeedSummary } from '@/server/trophies/types';
import { plural } from '../format';
import { formatRate } from '../collection/trophies';

export const FEED_PERIODS: readonly { id: FeedPeriod; label: string; head: string }[] = [
  { id: '7d', label: '7 дней', head: 'За 7 дней' },
  { id: 'month', label: 'Месяц', head: 'За 30 дней' },
  { id: 'all', label: 'Все', head: 'За всё время' },
];
export const RARE_CHIP = 'Только редкие';
export const TYPE_WORD: Record<FeedItem['type'], string> = { platinum: 'платина', gold: 'золото', silver: 'серебро', bronze: 'бронза' };
export const NO_DATE = 'Без даты';

const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'] as const;
const MONTHS_SHORT = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];

export function parsePeriod(v: string | string[] | undefined | null): FeedPeriod {
  return v === 'month' || v === 'all' ? v : '7d';
}
export const parseRare = (v: string | string[] | undefined | null): boolean => v === '1';

export function feedUrl(period: FeedPeriod, rare: boolean, cursor: string | null = null): string {
  const p = new URLSearchParams({ period });
  if (rare) p.set('rare', '1');
  if (cursor) p.set('cursor', cursor);
  return `/api/trophies/feed?${p.toString()}`;
}

/** Адрес страницы: `/trophies` для 7 дней без редких, иначе с параметрами (ссылка из чипа ведёт на ?period=7d). */
export function pageUrl(period: FeedPeriod, rare: boolean): string {
  const p = new URLSearchParams();
  if (period !== '7d') p.set('period', period);
  if (rare) p.set('rare', '1');
  const s = p.toString();
  return s ? `/trophies?${s}` : '/trophies';
}

const dayNum = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, dd) / 86_400_000;
};

/** «Сегодня», «Вчера», «Пн, 26 окт.»; другой год — с годом. */
export function dayLabel(day: string | null, today: string): string {
  if (day === null) return NO_DATE;
  const diff = dayNum(today) - dayNum(day);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  const [y, m, d] = day.split('-').map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd}, ${d} ${MONTHS_SHORT[m - 1]}${y !== Number(today.slice(0, 4)) ? ` ${y}` : ''}`;
}

export type FeedGroup = { key: string; label: string; items: FeedItem[] };

/** Подряд идущие строки одного дня — одна группа (порядок с сервера: свежие сверху, без даты в конце). */
export function groupFeed(items: readonly FeedItem[], today: string): FeedGroup[] {
  const out: FeedGroup[] = [];
  for (const it of items) {
    const key = it.day ?? 'none';
    const last = out[out.length - 1];
    if (last && last.key === key) last.items.push(it);
    else out.push({ key, label: dayLabel(it.day, today), items: [it] });
  }
  return out;
}

/** «+11 · 1 золото · 3 серебра · 7 бронз» (только ненулевые типы). */
export function summaryParts(s: FeedSummary): string[] {
  const parts = [`+${s.total}`];
  if (s.platinum) parts.push(`${s.platinum} ${plural(s.platinum, ['платина', 'платины', 'платин'])}`);
  if (s.gold) parts.push(`${s.gold} ${plural(s.gold, ['золото', 'золота', 'золотых'])}`);
  if (s.silver) parts.push(`${s.silver} ${plural(s.silver, ['серебро', 'серебра', 'серебряных'])}`);
  if (s.bronze) parts.push(`${s.bronze} ${plural(s.bronze, ['бронза', 'бронзы', 'бронз'])}`);
  return parts;
}

export function gameLine(it: FeedItem): string {
  const g = it.game?.title?.trim() || it.setName.trim() || 'Игра вне коллекции';
  return `${g} · ${TYPE_WORD[it.type]}`;
}

export const rateText = (it: FeedItem): string => formatRate(it.earnedRate) ?? '—';

/** Цвет редкости `rar-*`: PSN rarity 0 (ultra rare) … 3; без данных — обычный цвет. */
export const rarityTone = (it: FeedItem): string | undefined => (it.rarity !== null && it.rarity >= 0 && it.rarity <= 3 ? String(it.rarity) : undefined);

export function emptyText(period: FeedPeriod, rare: boolean): string {
  if (rare) return period === 'all' ? 'Редких трофеев (меньше 5 % игроков) пока нет' : 'Редких трофеев за этот период нет';
  return period === 'all' ? 'Полученных трофеев пока нет' : 'За этот период трофеев нет';
}

/** Склеить страницы без дублей (повторная догрузка той же страницы не удваивает строки). */
export function mergePages(prev: FeedResponse, next: FeedResponse): FeedResponse {
  const seen = new Set(prev.items.map((i) => i.id));
  return { ...prev, items: [...prev.items, ...next.items.filter((i) => !seen.has(i.id))], nextCursor: next.nextCursor };
}

// Пакет 6, п. 9: раздел «Почти платина» на /trophies (?view=near)
export type TrophiesView = 'feed' | 'near';
export const parseView = (v: string | string[] | undefined | null): TrophiesView => (v === 'near' ? 'near' : 'feed');
export const NEAR_URL = '/api/trophies/near';
export const NEAR_PAGE = '/trophies?view=near';

/** Адрес страницы с учётом раздела: «Почти платина» без параметров ленты. */
export function viewUrl(view: TrophiesView, period: FeedPeriod, rare: boolean): string {
  return view === 'near' ? NEAR_PAGE : pageUrl(period, rare);
}

/** «12 игр с прогрессом к платине»; пусто — подсказка. */
export function nearSummary(n: number): string {
  return `${n} ${plural(n, ['игра', 'игры', 'игр'])} с прогрессом к платине`;
}
export const NEAR_EMPTY = 'Пока нет игр с прогрессом к платине: здесь появятся игры, где получен хотя бы один трофей, а платины ещё нет';
