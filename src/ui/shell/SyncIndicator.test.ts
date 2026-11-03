import { describe, expect, it } from 'vitest';
import { shortAge } from './SyncIndicator';

describe('shortAge (D2: «● 12 ч» в мобильной шапке)', () => {
  it('убирает «назад» и точку', () => {
    expect(shortAge('12 ч назад')).toBe('12 ч');
    expect(shortAge('5 мин назад')).toBe('5 мин');
    expect(shortAge('7 дн. назад')).toBe('7 дн');
    expect(shortAge('только что')).toBe('сейчас');
  });
});
