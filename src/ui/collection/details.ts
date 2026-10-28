// Чистая логика окна игры (design-system §4.15): плитки цифр и строки «Обзора». Без DOM и React.
import type { GameItem } from '@/server/collection/types';
import { formatDate, formatDateLong, formatDayMonth, formatPlayTime, launchesText, relativeAgo } from '../format';

export type Tile =
  | { id: 'hours'; label: string; value: string; sub: string; muted: boolean }
  | { id: 'launches'; label: string; value: string; sub: string; muted: boolean }
  | { id: 'trophies'; label: string; value: string; sub: string; muted: boolean; progress: number | null }
  | { id: 'platinum'; label: string; value: string; sub: string; muted: boolean; state: 'earned' | 'locked' | 'unknown' };

/**
 * Четыре плитки окна. `platinumAt` = дата платины из списка трофеев (ещё не загружен или нет даты = null).
 * Нулевые часы и запуски: «нет данных».
 */
export function detailTiles(g: GameItem, now: number, platinumAt: string | null): Tile[] {
  const time = formatPlayTime(g.playSeconds);
  const t = g.trophies;
  const plat: Tile = !t
    ? { id: 'platinum', label: 'Платина', value: 'нет данных', sub: '', muted: true, state: 'unknown' }
    : t.platinumEarned
      ? { id: 'platinum', label: 'Платина', value: 'Получена', sub: formatDayMonth(platinumAt, true) ?? '', muted: false, state: 'earned' }
      : { id: 'platinum', label: 'Платина', value: 'Нет', sub: t.platinumDefined ? 'не получена' : 'в игре нет платины', muted: true, state: 'locked' };
  return [
    { id: 'hours', label: 'Часы', value: time ?? 'нет данных', sub: time ? 'наиграно' : '', muted: !time },
    {
      id: 'launches', label: 'Запуски', value: g.playCount > 0 ? launchesText(g.playCount) : 'нет данных',
      sub: g.playCount > 0 && g.lastPlayedAt ? `последний ${relativeAgo(g.lastPlayedAt, now)}` : '', muted: g.playCount <= 0,
    },
    t && t.defined > 0
      ? { id: 'trophies', label: 'Трофеи', value: `${t.earned}/${t.defined}`, sub: `${t.progress}%`, muted: false, progress: Math.min(100, Math.max(0, t.progress)) }
      : { id: 'trophies', label: 'Трофеи', value: 'нет данных', sub: '', muted: true, progress: null },
    plat,
  ];
}

/** Подзаголовок под названием: «PlayStation · PS5» и жанры. */
export function detailSubtitle(g: Pick<GameItem, 'platform' | 'genres'>): string {
  return ['PlayStation · ' + g.platform, ...(g.genres.length ? [g.genres.map((x) => x.label).join(', ')] : [])].join(' · ');
}

/** Значение «Последнего запуска»: «5 октября 2026 г. (3 дн. назад)» или «нет данных». */
export function lastPlayedText(iso: string | null, now: number): string {
  const long = formatDateLong(iso);
  return long ? `${long} (${relativeAgo(iso, now)})` : 'нет данных';
}

/** Дата для строки Обзора: «05.10.2026» или «нет данных». */
export function dateOrNone(iso: string | null | undefined): string {
  return formatDate(iso) ?? 'нет данных';
}

/** Заголовок/метка даты завершения. */
export function doneLabel(kind: 'completed' | 'dropped'): string {
  return kind === 'completed' ? 'Дата прохождения' : 'Дата броска';
}

/** Вкладки: `?tab=trophies` не используется, состояние вкладки локальное; порядок и id фиксированы. */
export const DETAIL_TABS = [{ id: 'overview', label: 'Обзор' }, { id: 'trophies', label: 'Трофеи' }] as const;
export type DetailTab = (typeof DETAIL_TABS)[number]['id'];

/** Следующая вкладка по стрелкам, Home и End (замкнуто по кругу для стрелок). */
export function nextTab(current: DetailTab, key: string): DetailTab | null {
  const i = DETAIL_TABS.findIndex((t) => t.id === current);
  if (key === 'ArrowRight') return DETAIL_TABS[(i + 1) % DETAIL_TABS.length].id;
  if (key === 'ArrowLeft') return DETAIL_TABS[(i - 1 + DETAIL_TABS.length) % DETAIL_TABS.length].id;
  if (key === 'Home') return DETAIL_TABS[0].id;
  if (key === 'End') return DETAIL_TABS[DETAIL_TABS.length - 1].id;
  return null;
}
