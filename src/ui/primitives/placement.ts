// Чистая геометрия плавающих панелей (HoverCard): куда открывать и на сколько сдвинуть, чтобы панель не вышла за экран.
export type Box = { left: number; top: number; right: number; bottom: number };

export const CARD_GAP = 6;
export const VIEWPORT_MARGIN = 8;

/**
 * Панель по умолчанию под триггером по левому краю. Не помещается снизу и сверху места больше = откроется вверх (`flip`).
 * `shiftX`: сдвиг по горизонтали, чтобы панель не вылезала за правый и левый край окна.
 */
export function placePanel(trigger: Box, panel: { width: number; height: number }, vp: { width: number; height: number }): { flip: boolean; shiftX: number } {
  const below = vp.height - trigger.bottom - CARD_GAP - VIEWPORT_MARGIN;
  const above = trigger.top - CARD_GAP - VIEWPORT_MARGIN;
  const flip = panel.height > below && above > below;
  let shiftX = 0;
  const right = trigger.left + panel.width;
  if (right > vp.width - VIEWPORT_MARGIN) shiftX = vp.width - VIEWPORT_MARGIN - right;
  if (trigger.left + shiftX < VIEWPORT_MARGIN) shiftX = VIEWPORT_MARGIN - trigger.left;
  return { flip, shiftX };
}

/** Задержки HoverCard (design-system §4.17.1). */
export const HOVER_OPEN_MS = 150;
export const HOVER_CLOSE_MS = 100;
