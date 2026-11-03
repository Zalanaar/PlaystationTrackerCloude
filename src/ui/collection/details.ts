// Чистая логика окна игры (design-system §4.15): плитки цифр и строки «Обзора». Без DOM и React.
import type { GameItem } from '@/server/collection/types';
import { formatDate, formatDayMonth, formatPlayTime, relativeAgo } from '../format';

export type Tile =
  | { id: 'hours'; label: string; value: string; sub: string; muted: boolean }
  | { id: 'launches'; label: string; value: string; sub: string; muted: boolean }
  | {
    id: 'trophies'; label: string; value: string; sub: string; muted: boolean; progress: number | null;
    /** D-P4: платина живёт в ячейке трофеев (отдельной плитки нет). */
    plat: { state: 'earned' | 'locked' | 'none' | 'unknown'; text: string };
  };

/**
 * Три ячейки окна (D-P4, design-system §4.15): часы · запуски · трофеи с полосой; платина — строкой в ячейке трофеев.
 * `platinumAt` = дата платины из списка трофеев (ещё не загружен или нет даты = null).
 * Нулевые часы и запуски: «нет данных». Значения короткие и не переносятся.
 */
export function detailTiles(g: GameItem, now: number, platinumAt: string | null): Tile[] {
  const time = formatPlayTime(g.playSeconds);
  const t = g.trophies;
  const platDate = formatDayMonth(platinumAt, true);
  const plat: Extract<Tile, { id: 'trophies' }>['plat'] = !t
    ? { state: 'unknown', text: '' }
    : t.platinumEarned
      ? { state: 'earned', text: platDate ? `платина ${platDate}` : 'платина получена' }
      : t.platinumDefined
        ? { state: 'locked', text: 'платина не получена' }
        : { state: 'none', text: 'без платины' };
  return [
    { id: 'hours', label: 'Часы', value: time ?? 'нет данных', sub: time ? 'наиграно' : '', muted: !time },
    {
      id: 'launches', label: 'Запуски', value: g.playCount > 0 ? String(g.playCount) : 'нет данных',
      sub: g.playCount <= 0 ? '' : g.lastPlayedAt ? `посл. ${relativeAgo(g.lastPlayedAt, now)}` : 'посл. запуск неизвестен', muted: g.playCount <= 0,
    },
    t && t.defined > 0
      ? { id: 'trophies', label: 'Трофеи', value: `${t.earned}/${t.defined}`, sub: `${t.progress}%`, muted: false, progress: Math.min(100, Math.max(0, t.progress)), plat }
      : { id: 'trophies', label: 'Трофеи', value: 'нет данных', sub: '', muted: true, progress: null, plat },
  ];
}

/** Подзаголовок под названием: «PlayStation · PS5» и жанры. */
export function detailSubtitle(g: Pick<GameItem, 'platform' | 'genres'>): string {
  return ['PlayStation · ' + g.platform, ...(g.genres.length ? [g.genres.map((x) => x.label).join(', ')] : [])].join(' · ');
}

/** Значение «Последнего запуска»: «5 окт. 2026 · 3 дн. назад» или «нет данных». */
export function lastPlayedText(iso: string | null, now: number): string {
  const d = formatDayMonth(iso, true);
  return d ? `${d} · ${relativeAgo(iso, now)}` : 'нет данных';
}

/** Режим арта шапки окна (спека 9.1 п.2.2): баннер, размытая обложка (компактная лента) или ничего. */
export type ArtMode = 'banner' | 'blur' | 'none';
export function artMode(bannerOk: boolean, hasCover: boolean): ArtMode {
  return bannerOk ? 'banner' : hasCover ? 'blur' : 'none';
}

/** Дата для строки Обзора: «05.10.2026» или «нет данных». */
export function dateOrNone(iso: string | null | undefined): string {
  return formatDate(iso) ?? 'нет данных';
}

/** Заголовок/метка даты завершения. */
export function doneLabel(kind: 'completed' | 'dropped'): string {
  return kind === 'completed' ? 'Дата прохождения' : 'Дата броска';
}

/** Вкладки: `?tab=trophies` не используется, состояние вкладки локальное; порядок и id фиксированы. «Гайды» (F2-A) — не у игр-сервисов. */
export const DETAIL_TABS = [{ id: 'overview', label: 'Обзор' }, { id: 'trophies', label: 'Трофеи' }, { id: 'guides', label: 'Гайды' }] as const;
export type DetailTab = (typeof DETAIL_TABS)[number]['id'];
type TabDef = (typeof DETAIL_TABS)[number];

/** Видимые вкладки игры: у live-service (`service`) гайдов нет. */
export function detailTabs(g: Pick<GameItem, 'status'> | null): readonly TabDef[] {
  return g?.status === 'service' ? DETAIL_TABS.filter((t) => t.id !== 'guides') : DETAIL_TABS;
}

/** Следующая вкладка по стрелкам, Home и End (замкнуто по кругу для стрелок) среди `tabs`. */
export function nextTab(current: DetailTab, key: string, tabs: readonly TabDef[] = DETAIL_TABS): DetailTab | null {
  const i = Math.max(0, tabs.findIndex((t) => t.id === current));
  if (key === 'ArrowRight') return tabs[(i + 1) % tabs.length].id;
  if (key === 'ArrowLeft') return tabs[(i - 1 + tabs.length) % tabs.length].id;
  if (key === 'Home') return tabs[0].id;
  if (key === 'End') return tabs[tabs.length - 1].id;
  return null;
}
