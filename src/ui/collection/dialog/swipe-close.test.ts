import { describe, expect, it } from 'vitest';
import { shouldClose, SWIPE_CLOSE_PX, SWIPE_FLICK_PX } from './swipe-close';

describe('П15.2 shouldClose', () => {
  it('длинный жест закрывает при любой скорости', () => {
    expect(shouldClose(SWIPE_CLOSE_PX, 2000)).toBe(true);
    expect(shouldClose(SWIPE_CLOSE_PX - 1, 2000)).toBe(false);
  });
  it('короткий быстрый «флик» закрывает, короткий медленный — нет', () => {
    expect(shouldClose(SWIPE_FLICK_PX + 10, 60)).toBe(true);
    expect(shouldClose(SWIPE_FLICK_PX + 10, 400)).toBe(false);
    expect(shouldClose(SWIPE_FLICK_PX - 1, 10)).toBe(false);
  });
  it('без движения вниз — не закрывает', () => {
    expect(shouldClose(0, 0)).toBe(false);
    expect(shouldClose(-50, 10)).toBe(false);
  });
});
