import { describe, expect, it } from 'vitest';
import { parseTodayOpen, todayOpenCookie } from './today-open';

describe('today-open', () => {
  it('parseTodayOpen: только 1 — раскрыт, иначе свёрнут', () => {
    expect(parseTodayOpen('1')).toBe(true);
    expect(parseTodayOpen('0')).toBe(false);
    expect(parseTodayOpen(undefined)).toBe(false);
    expect(parseTodayOpen('x')).toBe(false);
  });
  it('todayOpenCookie', () => {
    expect(todayOpenCookie(true)).toMatch(/^ps-today-open=1; path=\/; max-age=\d+; samesite=lax$/);
    expect(todayOpenCookie(false)).toMatch(/^ps-today-open=0;/);
  });
});
