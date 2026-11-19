import { describe, expect, it } from 'vitest';
import { BOOT_MAX_MS, BOOT_NO_MARKER_MS, bootReady } from './bootRelease';

describe('bootReady', () => {
  it('страница с маркером: ждёт data-tour-ready', () => {
    expect(bootReady({ hasPage: true, pageReady: false, elapsed: 1000 })).toBe(false);
    expect(bootReady({ hasPage: true, pageReady: true, elapsed: 10 })).toBe(true);
  });
  it('без маркера: короткая пауза на монтирование', () => {
    expect(bootReady({ hasPage: false, pageReady: false, elapsed: BOOT_NO_MARKER_MS - 1 })).toBe(false);
    expect(bootReady({ hasPage: false, pageReady: false, elapsed: BOOT_NO_MARKER_MS })).toBe(true);
  });
  it('предел ожидания', () => {
    expect(bootReady({ hasPage: true, pageReady: false, elapsed: BOOT_MAX_MS })).toBe(true);
  });
});
