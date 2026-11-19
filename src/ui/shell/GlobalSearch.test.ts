import { describe, expect, it } from 'vitest';
import { globalSearchMeta } from './GlobalSearch';

describe('Идея 2: строка результата поиска', () => {
  it('статус · платформа · часы; без статуса и без часов', () => {
    expect(globalSearchMeta({ status: 'completed', platform: 'PS5', hours: 12.5 } as never)).toBe('Пройдено · PS5 · 12 ч 30 м');
    expect(globalSearchMeta({ status: null, platform: 'PS4', hours: 0 } as never)).toBe('Без статуса · PS4');
  });
});
