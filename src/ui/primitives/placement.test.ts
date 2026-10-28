import { describe, expect, it } from 'vitest';
import { placePanel } from './placement';

const vp = { width: 1280, height: 800 };
const trig = (left: number, top: number, w = 300, h = 24) => ({ left, top, right: left + w, bottom: top + h });
const panel = { width: 304, height: 240 };

describe('placePanel', () => {
  it('места снизу хватает: вниз, без сдвига', () => {
    expect(placePanel(trig(100, 200), panel, vp)).toEqual({ flip: false, shiftX: 0 });
  });
  it('снизу тесно, сверху просторнее: вверх', () => {
    expect(placePanel(trig(100, 700), panel, vp).flip).toBe(true);
  });
  it('тесно и снизу, и сверху: остаётся вниз (там больше места нет, но не хуже)', () => {
    expect(placePanel(trig(100, 20), { width: 304, height: 900 }, vp).flip).toBe(false);
  });
  it('у правого края панель сдвигается влево', () => {
    expect(placePanel(trig(1100, 200), panel, vp).shiftX).toBe(1280 - 8 - 1404);
  });
  it('у левого края не уходит за экран', () => {
    expect(placePanel(trig(2, 200), panel, vp).shiftX).toBe(6);
  });
});
