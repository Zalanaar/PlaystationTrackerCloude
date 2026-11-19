import { describe, expect, it, vi } from 'vitest';
import { applyBadge, badgeSupported, badgeValue } from './appBadge';

describe('идея 4: бейдж на иконке', () => {
  it('число игр без статуса; 0 и неизвестно — снять', () => {
    expect(badgeValue(7)).toBe(7);
    expect(badgeValue(0)).toBeNull();
    expect(badgeValue(null)).toBeNull();
    expect(badgeValue(Number.NaN)).toBeNull();
  });
  it('только установленное приложение с Badging API', () => {
    const nav = { setAppBadge: async () => {}, clearAppBadge: async () => {} };
    expect(badgeSupported(nav, true)).toBe(true);
    expect(badgeSupported(nav, false)).toBe(false);
    expect(badgeSupported({}, true)).toBe(false);
  });
  it('ставит, снимает и глотает отказ (нет разрешения)', async () => {
    const set = vi.fn(async () => {});
    const clear = vi.fn(async () => {});
    await applyBadge({ setAppBadge: set, clearAppBadge: clear }, 3);
    await applyBadge({ setAppBadge: set, clearAppBadge: clear }, null);
    expect(set).toHaveBeenCalledWith(3);
    expect(clear).toHaveBeenCalledTimes(1);
    await expect(applyBadge({ setAppBadge: async () => { throw new Error('NotAllowedError'); }, clearAppBadge: clear }, 1)).resolves.toBeUndefined();
  });
});
