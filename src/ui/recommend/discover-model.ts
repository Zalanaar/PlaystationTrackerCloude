// Чистая логика вкладки «У тебя нет» (спека Фазы 31, контракт «Фаза 30»). Без React и сети.
import { recommendHref, type TimeValue } from './model';

export const TABS = [
  { value: 'backlog', label: 'Из бэклога' },
  { value: 'discover', label: 'У тебя нет' },
] as const;
export type TabValue = (typeof TABS)[number]['value'];

/** Неизвестное значение = бэклог. */
export function parseTab(raw: string | null | undefined): TabValue {
  return raw === 'discover' ? 'discover' : 'backlog';
}

export function pageHref(tab: TabValue, time: TimeValue): string {
  return tab === 'discover' ? '/recommend?tab=discover' : recommendHref(time);
}

export const DISCOVER_SUB = 'Игры PlayStation, которых нет в твоей библиотеке';

/** Год выхода `YYYY-MM-DD` -> «2019»; null, если даты нет или она кривая. */
export function releaseYear(date: string | null): string | null {
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(0, 4) : null;
}

/** «Metacritic 91 · Пользователи ★ 4,3»; null, если оценок нет. */
export function scoreLine(metacritic: number | null, rating: number | null): string | null {
  const parts: string[] = [];
  if (metacritic !== null) parts.push(`Metacritic ${metacritic}`);
  if (rating !== null) parts.push(`Пользователи ★ ${rating.toFixed(1).replace('.', ',')}`);
  return parts.length ? parts.join(' · ') : null;
}

/** «Подборка от 31 октября» по Москве. */
export function pickedText(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `Подборка от ${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' }).format(d)}`;
}

export const STALE_NOTE = 'Подборка вчерашняя. Новая появится после ночного синка.';
export const PARTIAL_NOTE = 'Подборка неполная: часть запросов к RAWG не прошла, остальное добавится в следующем синке.';

export type DiscoverView = 'cards' | 'catalog' | 'not_generated' | 'no_candidates';

export function discoverView(d: { items: readonly unknown[]; meta: { catalog: string; reason: string | null } }): DiscoverView {
  if (d.meta.catalog === 'unavailable') return 'catalog';
  if (d.items.length > 0) return 'cards';
  return d.meta.reason === 'not_generated' ? 'not_generated' : 'no_candidates';
}

export const REASON_TITLE = {
  llm: 'Игру выбрал расчёт по твоей истории, ИИ только переписал фразу',
  template: 'Фраза собрана по шаблону из твоей истории',
} as const;
