import { describe, expect, it } from 'vitest';
import { AUTO_ASK_GAP_MS, shouldAskAutoSync } from './autoSync';

const now = Date.parse('2026-11-19T12:00:00Z');
const iso = (h: number) => new Date(now - h * 3600_000).toISOString();
const base = { running: false, psnAuth: 'ok', run: null } as const;

describe('автосинк при открытии: клиент (идея 1)', () => {
  it('данные старше 6 ч — спросить сервер', () => expect(shouldAskAutoSync({ ...base, lastSuccessAt: iso(7) }, now, null)).toBe(true));
  it('свежие — нет', () => expect(shouldAskAutoSync({ ...base, lastSuccessAt: iso(5) }, now, null)).toBe(false));
  it('ни одного синка, идёт синк, нужен новый NPSSO — нет', () => {
    expect(shouldAskAutoSync({ ...base, lastSuccessAt: null }, now, null)).toBe(false);
    expect(shouldAskAutoSync({ ...base, running: true, lastSuccessAt: iso(9) }, now, null)).toBe(false);
    expect(shouldAskAutoSync({ ...base, psnAuth: 'auth_expired', lastSuccessAt: iso(9) } as never, now, null)).toBe(false);
  });
  it('с устройства уже спрашивали меньше 30 мин назад — нет', () => {
    expect(shouldAskAutoSync({ ...base, lastSuccessAt: iso(9) }, now, now - AUTO_ASK_GAP_MS + 1000)).toBe(false);
    expect(shouldAskAutoSync({ ...base, lastSuccessAt: iso(9) }, now, now - AUTO_ASK_GAP_MS)).toBe(true);
  });
});
