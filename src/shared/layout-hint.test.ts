import { describe, expect, it } from 'vitest';
import { formatLayoutHint, layoutHintCookie, parseLayoutHint } from './layout-hint';

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
});
