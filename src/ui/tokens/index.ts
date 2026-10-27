export const THEMES = [
  { id: 'night', label: 'Night', attr: null },
  { id: 'graphite', label: 'Graphite', attr: 'graphite' },
  { id: 'activity', label: 'Activity', attr: 'activity' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];
export const DEFAULT_THEME: ThemeId = 'night';
export const THEME_STORAGE_KEY = 'ps-theme';

export type GameStatus = 'playing' | 'completed' | 'dropped' | 'backlog' | 'shelved';
export type StatusKey = GameStatus | 'none';

export const STATUS_META: Record<StatusKey, { label: string; icon: 'triangle' | 'circle' | 'square' | 'cross' | 'pause' | 'dashed'; cssVar: string }> = {
  playing:   { label: 'Играю',      icon: 'triangle', cssVar: '--st-playing' },
  completed: { label: 'Пройдено',   icon: 'circle',   cssVar: '--st-completed' },
  backlog:   { label: 'Бэклог',     icon: 'square',   cssVar: '--st-backlog' },
  dropped:   { label: 'Брошено',    icon: 'cross',    cssVar: '--st-dropped' },
  shelved:   { label: 'Отложено',   icon: 'pause',    cssVar: '--st-shelved' },
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
  dashed: 'M8 2.5 a5.5 5.5 0 1 0 0.001 0 Z', // рисуется с stroke-dasharray="2 2.5"
};

/** Плотность сетки обложек. Хранится в URL `?view=` и localStorage['ps-view']; значение `list` = режим списка. */
export const VIEW_MODES = ['comfort', 'dense', 'list'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];
export const DEFAULT_VIEW: ViewMode = 'comfort';
export const VIEW_STORAGE_KEY = 'ps-view';
export const VIEW_LABELS: Record<ViewMode, string> = { comfort: 'Крупно', dense: 'Плотно', list: 'Список' };

/** Порядок блоков Коллекции (docs/design-system.md §4.3). Хроника = годы внутри блока `chronicle`. */
export const COLLECTION_BLOCKS = ['playing', 'chronicle', 'backlog', 'shelved', 'unsorted'] as const;
export type CollectionBlock = (typeof COLLECTION_BLOCKS)[number];

/** «Разбор»: клавиши и свайпы (docs/design-system.md §4.9). */
export const TRIAGE_KEYS: Record<string, GameStatus> = { '1': 'playing', '2': 'completed', '3': 'backlog', '4': 'dropped', '5': 'shelved' };
export const TRIAGE_SWIPE: { right: GameStatus; left: GameStatus; up: GameStatus; down: 'skip' } = { right: 'completed', left: 'dropped', up: 'backlog', down: 'skip' };
