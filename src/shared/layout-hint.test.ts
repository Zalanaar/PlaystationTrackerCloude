import { describe, expect, it } from 'vitest';
import { formatLayoutHint, isMobileDevice, layoutHintCookie, MOBILE_HINT_WIDTH, parseLayoutHint, withDeviceWidth } from './layout-hint';

describe('layout hint (item 4)', () => {
  it('туда и обратно', () => {
    const v = formatLayoutHint({ view: 'list', near: true, width: 390.4 });
    expect(v).toBe('list.1.390.');
    expect(parseLayoutHint(v)).toEqual({ view: 'list', near: true, width: 390 });
    const d = formatLayoutHint({ view: 'cards', near: false, width: 1440, day: '2026-11-03' });
    expect(parseLayoutHint(d)).toEqual({ view: 'cards', near: false, width: 1440, day: '2026-11-03' });
    expect(layoutHintCookie(v)).toMatch(/^ps-layout=list\.1\.390\.; path=\/; max-age=\d+; samesite=lax$/);
  });
  it('мусор и пусто: без подсказки', () => {
    expect(parseLayoutHint(undefined)).toEqual({});
    expect(parseLayoutHint('')).toEqual({});
    expect(parseLayoutHint('.0.')).toEqual({ near: false });
    expect(parseLayoutHint('<x>.2.99999.zz')).toEqual({});
    expect(formatLayoutHint({ view: 'a;b', near: false, width: 1440, day: 'x;y' })).toBe('.0.1440.');
  });
  it('первый визит без ширины: телефон по Client Hint или UA', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
    expect(isMobileDevice(null, iphone)).toBe(true);
    expect(isMobileDevice('?1', ipad)).toBe(true);
    expect(isMobileDevice('?0', iphone)).toBe(false);
    expect(isMobileDevice(null, ipad)).toBe(false);
    expect(isMobileDevice(null, null)).toBe(false);
    expect(withDeviceWidth({}, '?1', null)).toEqual({ width: MOBILE_HINT_WIDTH });
    expect(withDeviceWidth({ view: 'list' }, null, ipad)).toEqual({ view: 'list' });
    // фактическая ширина из cookie важнее устройства
    expect(withDeviceWidth({ width: 1024 }, '?1', iphone)).toEqual({ width: 1024 });
  });
});
