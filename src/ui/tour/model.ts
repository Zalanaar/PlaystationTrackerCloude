// Чистая логика тура: выбор шага и варианта (десктоп/моб.), маршруты, возобновление, геометрия. Без DOM и React.
import { TOUR_STEPS, TOUR_TOTAL, ROUTE_PAGE, type TourPlace, type TourRoute, type TourStep } from './steps';

export const TOUR_STEP_KEY = 'ps-tour-step';
export const TOUR_SHOWN_KEY = 'ps-tour-shown';
export const TOUR_SEEN_KEY = 'ps-tour-seen';
/** Ожидание data-tour-ready после смены пути (design-system §10.3) */
export const READY_WAIT_MS = 3000;
/** Общий таймаут навигации */
export const NAV_TIMEOUT_MS = 8000;
/** Пауза между готовой страницей и автозапуском */
export const AUTO_DELAY_MS = 600;

export function stepIndexById(id: string | null | undefined): number | null {
  if (!id) return null;
  const i = TOUR_STEPS.findIndex((s) => s.id === id);
  return i < 0 ? null : i;
}

/** Шаг для возобновления после перезагрузки: id из sessionStorage, неизвестный id = нет тура */
export function parseResume(raw: string | null | undefined): number | null {
  return stepIndexById(raw);
}

export type Variant = { targetId: string | null; text: string; note: string | null; mobile: boolean };

/** Вариант шага для ширины экрана. Нет мобильной заметки: берётся общая (§10.6 «Если поле Моб. не заполнено, как у десктопа»). */
export function variantFor(step: TourStep, mobile: boolean): Variant {
  return {
    targetId: mobile ? step.targetMobile : step.target,
    text: mobile ? step.textMobile : step.text,
    note: mobile ? (step.noteMobile ?? step.note) : step.note,
    mobile,
  };
}

/** Порядок поиска якоря: свой вариант, затем другой (планшет 768–999: в Разборе нет клавиш, но есть стопка). */
export function anchorCandidates(step: TourStep, mobile: boolean): string[] {
  const own = mobile ? step.targetMobile : step.target;
  const other = mobile ? step.target : step.targetMobile;
  return [own, other].filter((x, i, a): x is string => !!x && a.indexOf(x) === i);
}

/** Текст под фактически найденный якорь: если сработал запасной якорь другого варианта, берётся его текст. */
export function textForAnchor(step: TourStep, mobile: boolean, foundId: string | null): string {
  if (foundId && foundId !== (mobile ? step.targetMobile : step.target) && foundId === (mobile ? step.target : step.targetMobile)) {
    return mobile ? step.text : step.textMobile;
  }
  return variantFor(step, mobile).text;
}

export function clampIndex(i: number): number {
  return Math.min(Math.max(i, 0), TOUR_TOTAL - 1);
}
export const nextIndex = (i: number): number => clampIndex(i + 1);
export const prevIndex = (i: number): number => clampIndex(i - 1);
export const isLast = (i: number): boolean => i >= TOUR_TOTAL - 1;
export const isFirst = (i: number): boolean => i <= 0;

/** Страница шага: '*' = остаться где есть */
export function needsNavigation(route: TourRoute, pathname: string): boolean {
  return route !== '*' && pathname !== route;
}
export function pageMarkerFor(route: TourRoute): string | null {
  return route === '*' ? null : ROUTE_PAGE[route];
}

export type AutoStartInput = {
  pathname: string;
  search: string;
  apiShouldStart: boolean;
  shownThisSession: boolean;
  seenFlag: string | null;
  version: number;
  tourActive: boolean;
};

const NO_AUTO_PREFIX = ['/wrapped', '/onboarding', '/login'];

/** Можно ли автозапускать тур (design-system §10.5). Открытые окна проверяются отдельно в DOM. */
export function canAutoStart(i: AutoStartInput): boolean {
  if (!i.apiShouldStart || i.shownThisSession || i.tourActive) return false;
  if (i.seenFlag === String(i.version)) return false;
  if (NO_AUTO_PREFIX.some((p) => i.pathname === p || i.pathname.startsWith(`${p}/`))) return false;
  if (new URLSearchParams(i.search).has('game')) return false;
  return true;
}

// ---------- Геометрия ----------
export type Box = { x: number; y: number; w: number; h: number };

/** Сторона элемента меньше этого порога расширяется до `minSide` (design-system §10.2: <32 -> 44) */
export const SMALL_SIDE = 32;

/** Рамка прожектора: элемент + pad; сторона < 32 расширяется до `minSide` (центр сохраняется); клампится в экран с полем `edge`. */
export function spotBox(el: Box, pad: number, minSide: number, vp: { w: number; h: number }, edge: number): Box {
  let { x, y, w, h } = el;
  if (w < SMALL_SIDE) { x -= (minSide - w) / 2; w = minSide; }
  if (h < SMALL_SIDE) { y -= (minSide - h) / 2; h = minSide; }
  x -= pad; y -= pad; w += 2 * pad; h += 2 * pad;
  const x1 = Math.max(x, edge);
  const y1 = Math.max(y, edge);
  const x2 = Math.min(x + w, vp.w - edge);
  const y2 = Math.min(y + h, vp.h - edge);
  return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
}

export type Side = 'bottom' | 'top' | 'right' | 'left';
const OPPOSITE: Record<Side, Side> = { bottom: 'top', top: 'bottom', right: 'left', left: 'right' };

export function sideOrder(place: TourPlace): Side[] {
  const first: Side = place === 'center' ? 'bottom' : place;
  const opp = OPPOSITE[first];
  const rest = (['bottom', 'top', 'right', 'left'] as Side[]).filter((s) => s !== first && s !== opp);
  return [first, opp, ...rest];
}

export type Placed = { left: number; top: number; side: Side | 'fallback' };

/**
 * Позиция поповера рядом с рамкой (десктоп). Сторона по приоритету `sideOrder`; поперечная ось зажимается в экран с полем `gutter`.
 * Не поместилось ни на одной стороне: нижний центр экрана.
 */
export function placePopover(spot: Box, pop: { w: number; h: number }, vp: { w: number; h: number }, place: TourPlace, gap: number, gutter: number): Placed {
  const clampX = (x: number) => Math.min(Math.max(x, gutter), Math.max(gutter, vp.w - gutter - pop.w));
  const clampY = (y: number) => Math.min(Math.max(y, gutter), Math.max(gutter, vp.h - gutter - pop.h));
  for (const side of sideOrder(place)) {
    if (side === 'bottom') {
      const top = spot.y + spot.h + gap;
      if (top + pop.h <= vp.h - gutter) return { left: clampX(spot.x + spot.w / 2 - pop.w / 2), top, side };
    } else if (side === 'top') {
      const top = spot.y - gap - pop.h;
      if (top >= gutter) return { left: clampX(spot.x + spot.w / 2 - pop.w / 2), top, side };
    } else if (side === 'right') {
      const left = spot.x + spot.w + gap;
      if (left + pop.w <= vp.w - gutter) return { left, top: clampY(spot.y + spot.h / 2 - pop.h / 2), side };
    } else {
      const left = spot.x - gap - pop.w;
      if (left >= gutter) return { left, top: clampY(spot.y + spot.h / 2 - pop.h / 2), side };
    }
  }
  return { left: clampX(vp.w / 2 - pop.w / 2), top: clampY(vp.h - gutter - pop.h), side: 'fallback' };
}

/**
 * Прокрутка, чтобы элемент оказался в видимой области [top, bottom]: 0 = ничего не делать.
 * Не помещается по высоте: выравнивание по верху области.
 */
export function scrollDelta(rect: { top: number; bottom: number }, area: { top: number; bottom: number }): number {
  const h = rect.bottom - rect.top;
  if (rect.top >= area.top && rect.bottom <= area.bottom) return 0;
  if (h >= area.bottom - area.top) return rect.top - area.top;
  return (rect.top + rect.bottom) / 2 - (area.top + area.bottom) / 2;
}

/** Высота экранной клавиатуры по visualViewport (design-system §10.4); 0 = клавиатуры нет */
export function keyboardHeight(innerHeight: number, vv: { height: number; offsetTop: number } | null): number {
  if (!vv || vv.height >= innerHeight - 120) return 0;
  return Math.max(0, innerHeight - vv.height - vv.offsetTop);
}

/** Текст live-региона: «Шаг 3 из 14. Карточка игры. Текст» */
export function announce(index: number, title: string, text: string): string {
  return `Шаг ${index + 1} из ${TOUR_TOTAL}. ${title}. ${text}`;
}
