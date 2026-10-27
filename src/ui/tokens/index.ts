export const THEMES = [
  { id: 'night', label: 'Night', attr: null },
  { id: 'memory-card', label: 'Memory Card', attr: 'memory-card' },
  { id: 'crystal-towers', label: 'Crystal Towers', attr: 'crystal-towers' },
  { id: 'wave', label: 'Wave', attr: 'wave' },
  { id: 'tiles', label: 'Tiles', attr: 'tiles' },
  { id: 'activity', label: 'Activity', attr: 'activity' },
  { id: 'graphite', label: 'Dark', attr: 'graphite' }, // подпись "Dark", атрибут graphite
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
  none:      { label: 'Без статуса', icon: 'dashed',  cssVar: '--st-none' },
};

/** SVG-пути иконок статусов. viewBox 0 0 16 16, stroke currentColor, width 1.75, fill none, linecap/linejoin round. */
export const STATUS_ICON_PATHS: Record<string, string> = {
  triangle: 'M8 2.5 L14 13 H2 Z',
  circle: 'M8 2.5 a5.5 5.5 0 1 0 0.001 0 Z',
  square: 'M3 3 H13 V13 H3 Z',
  cross: 'M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5',
  pause: 'M5.5 3 V13 M10.5 3 V13',
  dashed: 'M8 2.5 a5.5 5.5 0 1 0 0.001 0 Z', // рисуется с stroke-dasharray="2 2.5"
};
