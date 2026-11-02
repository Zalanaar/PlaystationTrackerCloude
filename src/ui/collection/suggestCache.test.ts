import { describe, expect, it } from 'vitest';
import { SUGGEST_CACHE_TTL_MS, suggestCacheClear, suggestCacheGet, suggestCacheSet } from './suggestCache';

describe('кэш подсказок (QA-43.1-1)', () => {
  it('отдаёт запись до TTL и забывает после', () => {
    suggestCacheClear();
    suggestCacheSet('hades', [], 1000);
    expect(suggestCacheGet('hades', 1000 + SUGGEST_CACHE_TTL_MS)).toEqual([]);
    expect(suggestCacheGet('hades', 1001 + SUGGEST_CACHE_TTL_MS)).toBeNull();
  });
  it('сброс очищает всё', () => {
    suggestCacheSet('a', [], 1);
    suggestCacheClear();
    expect(suggestCacheGet('a', 2)).toBeNull();
  });
});
