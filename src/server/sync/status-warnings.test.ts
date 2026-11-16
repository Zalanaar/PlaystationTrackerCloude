import { describe, expect, it } from 'vitest';
import { recentWarnings } from './status';

describe('П10: тексты предупреждений синка', () => {
  it('последние 5, мусор отброшен, длина ограничена', () => {
    const raw = [
      ...Array.from({ length: 7 }, (_, i) => ({ code: `c${i}`, message: `текст ${i}` })),
      null, 'x', { code: 1, message: '' }, { code: 'long', message: 'я'.repeat(300) },
    ];
    const r = recentWarnings(raw);
    expect(r).toHaveLength(5);
    expect(r.map((w) => w.code)).toEqual(['c3', 'c4', 'c5', 'c6', 'long']);
    expect(r[4].message).toHaveLength(200);
  });
  it('не массив → пусто', () => {
    expect(recentWarnings(null)).toEqual([]);
    expect(recentWarnings({ a: 1 })).toEqual([]);
  });
});
