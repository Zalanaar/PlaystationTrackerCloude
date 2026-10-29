import type { ReactNode } from 'react';
import { STATUS_ICON_PATHS, STATUS_META, type StatusKey } from './tokens';

// Набор линейных иконок (в стиле lucide, viewBox 24). Фигуры статусов отдельно: StatusIcon.
const P: Record<string, ReactNode> = {
  library: <><path d="m16 6 4 14" /><path d="M12 6v14" /><path d="M8 8v12" /><path d="M4 4v16" /></>,
  bookmark: <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />,
  'bar-chart': <><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></>,
  lightbulb: <><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" /><path d="M9 18h6" /><path d="M10 22h4" /></>,
  'thumbs-down': <><path d="M17 14V2" /><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" /></>,
  sparkles: <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />,
  gamepad: <><path d="M6 11h4" /><path d="M8 9v4" /><path d="M15 12h.01" /><path d="M18 10h.01" /><path d="M17.3 5H6.7a4 4 0 0 0-4 3.6C2.6 9.4 2 14.5 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.4-1.4A2 2 0 0 1 9.8 16h4.4a2 2 0 0 1 1.4.6L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.5-.6-6.6-.7-7.300A4 4 0 0 0 17.3 5z" /></>,
  'check-circle': <><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></>,
  trophy: <><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.7V17c0 .6-.5 1-1 1.2C7.9 18.8 7 20.2 7 22" /><path d="M14 14.700V17c0 .6.5 1 1 1.2 1.1.6 2 2 2 3.8" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  play: <path d="M6 3l14 9-14 9z" />,
  search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
  'search-x': <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /><path d="m8.5 8.5 5 5" /><path d="m13.5 8.5-5 5" /></>,
  x: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  more: <><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></>,
  sliders: <><path d="M21 4h-7" /><path d="M10 4H3" /><path d="M21 12h-9" /><path d="M8 12H3" /><path d="M21 20h-5" /><path d="M12 20H3" /><path d="M14 2v4" /><path d="M8 10v4" /><path d="M16 18v4" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></>,
  list: <><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></>,
  'calendar-x': <><path d="M8 2v4" /><path d="M16 2v4" /><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18" /><path d="m14 14-4 4" /><path d="m10 14 4 4" /></>,
  'calendar-plus': <><path d="M8 2v4" /><path d="M16 2v4" /><path d="M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8" /><path d="M3 10h18" /><path d="M16 19h6" /><path d="M19 16v6" /></>,
  'cloud-download': <><path d="M12 13v8l-4-4" /><path d="m12 21 4-4" /><path d="M4.4 14.900A7 7 0 1 1 15.7 8h1.800a4.5 4.5 0 0 1 2.5 8.2" /></>,
  alert: <><path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
  key: <><circle cx="7.5" cy="15.5" r="5.5" /><path d="m21 2-9.6 9.6" /><path d="m15.5 7.5 3 3L22 7l-3-3" /></>,
  'circle-alert': <><circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  info: <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></>,
  'arrow-up': <><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></>,
  'arrow-down': <><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></>,
  upload: <><path d="M12 17V9" /><path d="m8 13 4-4 4 4" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></>,
  download: <><path d="M12 3v12" /><path d="m8 11 4 4 4-4" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>,
  refresh: <><path d="M3 12a9 9 0 0 1 9-9 9.8 9.8 0 0 1 6.7 2.700L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.8 9.8 0 0 1-6.7-2.700L3 16" /><path d="M8 16H3v5" /></>,
  undo: <><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></>,
  'chevron-up': <path d="m18 15-6-6-6 6" />,
  'sliders-h': <><path d="M21 4h-7" /><path d="M10 4H3" /><path d="M21 12h-9" /><path d="M8 12H3" /><path d="M21 20h-5" /><path d="M12 20H3" /><path d="M14 2v4" /><path d="M8 10v4" /><path d="M16 18v4" /></>,
  'arrow-right': <><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>,
  'eye-off': <><path d="M10.7 5.1A10.7 10.7 0 0 1 22 12a13.200 13.200 0 0 1-1.700 2.700" /><path d="M14.1 14.200a3 3 0 0 1-4.200-4.200" /><path d="M17.5 17.500A10.700 10.700 0 0 1 2 12a13.200 13.200 0 0 1 4.400-5.400" /><path d="m2 2 20 20" /></>,
  eye: <><path d="M2 12s3.500-7 10-7 10 7 10 7-3.500 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  flame: <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.4 1-3 .5.5.8 1.5 2.5 2.5z" />,
  roadmap: <><path d="M3 3v18" /><path d="M7 6h9" /><path d="M11 12h10" /><path d="M7 18h7" /></>,
  plus: <><path d="M5 12h14" /><path d="M12 5v14" /></>,
  pencil: <><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></>,
  trash: <><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>,
  'external-link': <><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>,
  'drag-handle': <><path d="M5 9h14" /><path d="M5 15h14" /></>,
  'chevron-left': <path d="m15 18-6-6 6-6" />,
  'chevron-right': <path d="m9 18 6-6-6-6" />,
  'circle-help': <><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></>,
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className}
    >
      {P[name]}
    </svg>
  );
}

/** Фигуры статусов (design-system §3): 16x16, stroke 1.75. */
export function StatusIcon({ status, size = 16, className }: { status: StatusKey; size?: number; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <svg
      viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className}
      style={{ color: `var(${meta.cssVar})` }}
    >
      <path d={STATUS_ICON_PATHS[meta.icon]} strokeDasharray={meta.icon === 'dashed' ? '2 2.5' : undefined} />
    </svg>
  );
}

/**
 * Платиновый кубок как в PS (design-system §4.14): заливка, viewBox 24, цвет = currentColor.
 * Не фигура статуса: только трофей. Цвет задаёт контекст (`var(--plat-1)` на тёмном, `var(--plat-ink)` на заливке бейджа).
 * Размеры: 14 (строка списка), 16 (чип фильтра), 20 (бейдж карточки), 24 (плитка окна), 40 (пустые состояния).
 * Декоративный по умолчанию (`aria-hidden`); передай `title`, если рядом нет текста.
 */
export function PlatinumIcon({ size = 20, className, title }: { size?: number; className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} fill="currentColor" stroke="none"
      aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} aria-label={title} focusable="false" className={className}
    >
      {/* чаша с прорезью-бликом */}
      <path fillRule="evenodd" d="M6.5 3h11v5.5a5.5 5.5 0 0 1-11 0V3ZM9.2 5.2v3.6h1.6V5.2H9.2Z" />
      {/* ручки */}
      <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
        d="M6.5 5H4v1.5A3.5 3.5 0 0 0 7.2 10M17.5 5H20v1.5a3.5 3.5 0 0 1-3.2 3.5" />
      {/* ножка и основание */}
      <path d="M10.5 13.6h3V17h-3Z" />
      <path d="M7.5 21v-1.8A2.2 2.2 0 0 1 9.7 17h4.6a2.2 2.2 0 0 1 2.2 2.2V21h-9Z" />
    </svg>
  );
}

/** Имя из design-system §3: фигура статуса. Размеры 12 / 16 / 20 / 40. */
export const StatusGlyph = StatusIcon;
