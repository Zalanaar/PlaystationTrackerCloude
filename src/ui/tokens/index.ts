export const THEMES = [
  { id: 'night', label: 'Night', attr: null },
  { id: 'graphite', label: 'Graphite', attr: 'graphite' },
  { id: 'ps1', label: 'PS1', attr: 'ps1' },
  { id: 'ps2', label: 'PS2', attr: 'ps2' },
  { id: 'ps3', label: 'PS3', attr: 'ps3' },
  { id: 'ps4', label: 'PS4', attr: 'ps4' },
  { id: 'ps5', label: 'PS5', attr: 'ps5' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

/** Старые id тем -> актуальные. Применяется к сохранённому выбору (localStorage, cookie) до проверки по THEMES. Activity слита в PS5. */
export const LEGACY_THEME_ALIASES: Readonly<Record<string, ThemeId>> = { activity: 'ps5' };

/** PS3: месяц (1..12) для атрибута data-xmb-month на html; значения градиента в themes.css. */
export const XMB_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export const DEFAULT_THEME: ThemeId = 'night';
export const THEME_STORAGE_KEY = 'ps-theme';

export type GameStatus = 'playing' | 'completed' | 'dropped' | 'backlog' | 'shelved' | 'service';
export type StatusKey = GameStatus | 'none';

export const STATUS_META: Record<StatusKey, { label: string; icon: 'triangle' | 'circle' | 'square' | 'cross' | 'pause' | 'diamond' | 'dashed'; cssVar: string; title?: string }> = {
  playing:   { label: 'Играю',      icon: 'triangle', cssVar: '--st-playing' },
  completed: { label: 'Пройдено',   icon: 'circle',   cssVar: '--st-completed' },
  backlog:   { label: 'Бэклог',     icon: 'square',   cssVar: '--st-backlog' },
  dropped:   { label: 'Брошено',    icon: 'cross',    cssVar: '--st-dropped' },
  shelved:   { label: 'Отложено',   icon: 'pause',    cssVar: '--st-shelved' },
  service:   { label: 'Сервис',     icon: 'diamond',  cssVar: '--st-service', title: 'Игра-сервис' },
  none:      { label: 'Без статуса', icon: 'dashed',  cssVar: '--st-none' }, // пункт меню «сбросить статус»
};
/** Подпись «без статуса» в чипе фильтра, блоке коллекции и Разборе. */
export const UNSORTED_LABEL = 'Не разобрано';

/** SVG-пути иконок статусов. viewBox 0 0 16 16, stroke currentColor, width 1.75, fill none, linecap/linejoin round. */
export const STATUS_ICON_PATHS: Record<string, string> = {
  triangle: 'M8 2.5 L14 13 H2 Z',
  circle: 'M8 2.5 a5.5 5.5 0 1 0 0.001 0 Z',
  square: 'M3 3 H13 V13 H3 Z',
  cross: 'M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5',
  pause: 'M5.5 3 V13 M10.5 3 V13',
  diamond: 'M8 1.75 L14.25 8 L8 14.25 L1.75 8 Z',
  dashed: 'M8 2.5 a5.5 5.5 0 1 0 0.001 0 Z', // рисуется с stroke-dasharray="2 2.5"
};

/** Плотность сетки обложек. Хранится в URL `?view=` и localStorage['ps-view']; значение `list` = режим списка. */
export const VIEW_MODES = ['comfort', 'dense', 'list'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];
export const DEFAULT_VIEW: ViewMode = 'comfort';
export const VIEW_STORAGE_KEY = 'ps-view';
export const VIEW_LABELS: Record<ViewMode, string> = { comfort: 'Крупно', dense: 'Плотно', list: 'Список' };

/** Порядок блоков Коллекции (docs/design-system.md §4.3). Хроника = годы внутри блока `chronicle`. */
export const COLLECTION_BLOCKS = ['playing', 'chronicle', 'backlog', 'service', 'shelved', 'unsorted'] as const;
export type CollectionBlock = (typeof COLLECTION_BLOCKS)[number];

/** Фаза 18 (docs/design-system.md §8): 4 вкладки. `match` = префиксы путей, на которых вкладка подсвечена; `href` ведёт на корень группы. */
export const NAV_TABS = [
  { id: 'collection', href: '/', label: 'Коллекция', icon: 'library', match: ['/'], exact: true },
  { id: 'backlog', href: '/backlog', label: 'Бэклог', icon: 'bookmark', match: ['/backlog', '/roadmap', '/recommend'] },
  { id: 'stats', href: '/stats', label: 'Статистика', icon: 'bar-chart', match: ['/stats', '/wrapped'] },
  { id: 'triage', href: '/triage', label: 'Разбор', icon: 'list-checks', match: ['/triage'] },
] as const;
/** Подвкладки группы «Бэклог» (ссылки, не кнопки). */
export const BACKLOG_SUBNAV = [
  { href: '/backlog', label: 'Бэклог' },
  { href: '/roadmap', label: 'План' },
  { href: '/recommend', label: 'Подскажи' },
] as const;
/** Сколько строк показывает свёрнутый список («Не успеваю», «Не распределено», §8.2). */
export const COLLAPSED_LIST_LIMIT = 5;
/** Месяцы (МСК), когда на Статистике показан баннер «Итоги года»: декабрь и январь (в январе речь о прошлом годе). */
export const WRAPPED_BANNER_MONTHS = [12, 1] as const;
/** theme-color и полоса под статус-баром = --statusbar-bg темы (у всех = --bg, кроме светлой PS1). */
export const THEME_COLORS: Record<ThemeId, string> = {
  night: '#0e0f16', graphite: '#111113', ps1: '#1c1c22', ps2: '#070b1a', ps3: '#10070b', ps4: '#02173d', ps5: '#0a0a0c',
};

/** «Разбор»: клавиши и свайпы (docs/design-system.md §4.9). */
export const TRIAGE_KEYS: Record<string, GameStatus> = { '1': 'playing', '2': 'completed', '3': 'backlog', '4': 'dropped', '5': 'shelved', '6': 'service' };
export const TRIAGE_SWIPE: { right: GameStatus; left: GameStatus; up: GameStatus; down: 'skip' } = { right: 'completed', left: 'dropped', up: 'backlog', down: 'skip' };
/** Режим «Проверить» (design-system §13.5): вправо = принять подсказку, влево = оставить как есть; вверх и вниз отключены. */
export const TRIAGE_SWIPE_CHECK: { right: 'accept'; left: 'keep' } = { right: 'accept', left: 'keep' };
