import { describe, expect, it } from 'vitest';
import { HEADER_STALE_HOURS, shortAge, syncTone } from './SyncIndicator';

describe('shortAge (D2: «● 12 ч» в мобильной шапке)', () => {
  it('убирает «назад» и точку', () => {
    expect(shortAge('12 ч назад')).toBe('12 ч');
    expect(shortAge('5 мин назад')).toBe('5 мин');
    expect(shortAge('7 дн. назад')).toBe('7 дн');
    expect(shortAge('только что')).toBe('сейчас');
  });
});

describe('syncTone (F8: жёлтый после пропущенного ночного синка)', () => {
  const now = Date.parse('2026-11-19T12:00:00Z');
  const at = (h: number) => new Date(now - h * 3600_000).toISOString();
  it('до 26 ч ok, дольше warn; ошибка — bad, идёт — busy', () => {
    expect(HEADER_STALE_HOURS).toBe(26);
    expect(syncTone({ running: false, lastSuccessAt: at(12), failed: false, npsso: false }, now)).toBe('ok');
    expect(syncTone({ running: false, lastSuccessAt: at(25), failed: false, npsso: false }, now)).toBe('ok');
    expect(syncTone({ running: false, lastSuccessAt: at(27), failed: false, npsso: false }, now)).toBe('warn');
    expect(syncTone({ running: false, lastSuccessAt: null, failed: false, npsso: false }, now)).toBe('warn');
    expect(syncTone({ running: false, lastSuccessAt: at(1), failed: true, npsso: false }, now)).toBe('bad');
    expect(syncTone({ running: true, lastSuccessAt: at(1), failed: false, npsso: false }, now)).toBe('busy');
  });
});
