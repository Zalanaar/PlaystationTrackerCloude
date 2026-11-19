import { describe, expect, it } from 'vitest';
import { serviceLine } from './serviceLine';

describe('serviceLine (F11)', () => {
  it('наиграно и последний запуск, без «осталось»', () => {
    expect(serviceLine(89 * 3600, '2026-07-14T19:50:32Z')).toBe('наиграно 89 ч · запуск 14 июл. 2026');
    expect(serviceLine(0, null)).toBe('не запускалась');
  });
});
