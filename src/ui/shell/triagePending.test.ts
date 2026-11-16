import { describe, expect, it } from 'vitest';
import { pendingBadge } from './triagePending';

describe('П9: бейдж «Разбор» в меню', () => {
  it('пусто при 0, null и мусоре; 99+ для больших', () => {
    expect(pendingBadge(null)).toBeNull();
    expect(pendingBadge(0)).toBeNull();
    expect(pendingBadge(Number.NaN)).toBeNull();
    expect(pendingBadge(3)).toBe('3');
    expect(pendingBadge(99)).toBe('99');
    expect(pendingBadge(120)).toBe('99+');
  });
});
