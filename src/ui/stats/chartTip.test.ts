import { describe, expect, it } from 'vitest';
import { clampShift } from './chartTip';

describe('П10: подсказка графика внутри карточки', () => {
  it('сдвиг к краям и без сдвига внутри', () => {
    expect(clampShift(100, 180, 24, 336)).toBe(0);
    expect(clampShift(300, 380, 24, 336)).toBe(-44);
    expect(clampShift(-10, 70, 24, 336)).toBe(34);
    expect(clampShift(0, 400, 24, 336)).toBe(24); // шире карточки — к левому краю
  });
});
