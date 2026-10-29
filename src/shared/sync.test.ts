import { describe, expect, it } from 'vitest';
import { SYNC_OVERDUE_HOURS, SYNC_OVERDUE_MS, syncOverdue } from './sync';

const H = 3_600_000;
const NOW = new Date('2026-10-29T12:00:00Z');

describe('syncOverdue (контракт 20.2)', () => {
  it('порог 30 часов', () => {
    expect(SYNC_OVERDUE_HOURS).toBe(30);
    expect(SYNC_OVERDUE_MS).toBe(30 * H);
  });
  it('граница: ровно 30 ч ещё не просрочено, 30 ч и 1 мс уже да', () => {
    expect(syncOverdue(new Date(NOW.getTime() - 30 * H), NOW).isOverdue).toBe(false);
    expect(syncOverdue(new Date(NOW.getTime() - 30 * H - 1), NOW).isOverdue).toBe(true);
  });
  it('возраст в часах с точностью до 0.1', () => {
    expect(syncOverdue(new Date(NOW.getTime() - 10 * H), NOW)).toEqual({ isOverdue: false, ageHours: 10, thresholdHours: 30 });
    expect(syncOverdue(new Date(NOW.getTime() - 53.24 * H), NOW)).toEqual({ isOverdue: true, ageHours: 53.2, thresholdHours: 30 });
  });
  it('нет опорного времени: не просрочено, возраст null', () => {
    expect(syncOverdue(null, NOW)).toEqual({ isOverdue: false, ageHours: null, thresholdHours: 30 });
  });
  it('часы сервера позади опоры (разброс): возраст 0, не просрочено', () => {
    expect(syncOverdue(new Date(NOW.getTime() + 5 * H), NOW)).toEqual({ isOverdue: false, ageHours: 0, thresholdHours: 30 });
  });
  it('свой порог', () => {
    expect(syncOverdue(new Date(NOW.getTime() - 2 * H), NOW, H).thresholdHours).toBe(1);
    expect(syncOverdue(new Date(NOW.getTime() - 2 * H), NOW, H).isOverdue).toBe(true);
  });
});
