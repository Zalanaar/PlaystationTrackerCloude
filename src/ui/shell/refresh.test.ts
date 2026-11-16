import { describe, expect, it } from 'vitest';
import { PULL_MAX_PX, PULL_TRIGGER_PX, pullDistance, RETURN_REFRESH_AFTER_MS, shouldRefreshOnReturn } from './refresh';

describe('П9: обновление при возврате', () => {
  it('только после долгого отсутствия (≥ 2 мин) и только если вкладка была скрыта', () => {
    expect(shouldRefreshOnReturn(null, 10_000_000)).toBe(false);
    expect(shouldRefreshOnReturn(1_000, 1_000 + RETURN_REFRESH_AFTER_MS - 1)).toBe(false);
    expect(shouldRefreshOnReturn(1_000, 1_000 + RETURN_REFRESH_AFTER_MS)).toBe(true);
  });
});

describe('П9: потяни, чтобы обновить', () => {
  it('сопротивление: половина хода до порога, дальше медленнее и не больше максимума', () => {
    expect(pullDistance(-20)).toBe(0);
    expect(pullDistance(40)).toBe(20);
    expect(pullDistance(PULL_TRIGGER_PX * 2)).toBe(PULL_TRIGGER_PX);
    expect(pullDistance(PULL_TRIGGER_PX * 2 + 50)).toBeCloseTo(PULL_TRIGGER_PX + 10);
    expect(pullDistance(10_000)).toBe(PULL_MAX_PX);
  });
});
