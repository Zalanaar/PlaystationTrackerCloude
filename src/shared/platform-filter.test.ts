import { describe, expect, it } from 'vitest';
import { parsePlatform, platformChoices, platformCookie } from './platform-filter';

describe('фильтр платформы (F4)', () => {
  it('parsePlatform: только известные ключи', () => {
    expect(parsePlatform('ps5')).toBe('ps5');
    expect(parsePlatform('pc')).toBe('pc');
    expect(parsePlatform('all')).toBeNull();
    expect(parsePlatform('PS5')).toBeNull();
    expect(parsePlatform(undefined)).toBeNull();
  });

  it('одинокая PC-игра чипа не даёт', () => {
    expect(platformChoices({ ps5: 157, ps4: 60, pc: 1 }, null).map((o) => o.id)).toEqual(['ps5', 'ps4']);
  });

  it('один вариант: фильтр не нужен', () => {
    expect(platformChoices({ ps5: 10, ps4: 0, pc: 1 }, null)).toEqual([]);
  });

  it('выбранная платформа видна всегда, даже без сводки', () => {
    expect(platformChoices({ ps5: 10, ps4: 0, pc: 1 }, 'pc').map((o) => o.id)).toEqual(['ps5', 'pc']);
    expect(platformChoices(null, 'ps4')).toEqual([{ id: 'ps4', label: 'PS4', n: 0 }]);
    expect(platformChoices(null, null)).toEqual([]);
  });

  it('cookie: на год и удаление', () => {
    expect(platformCookie('ps4')).toBe('ps-platform=ps4; path=/; max-age=31536000; samesite=lax');
    expect(platformCookie(null)).toContain('max-age=0');
  });
});
