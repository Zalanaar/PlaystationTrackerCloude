// QA Ф34: независимые проверки границ недель МСК, усечения, оценки без перерасхода, независимости от TZ процесса.
import { describe, expect, it } from 'vitest';
import { buildGameHistory } from './history';

const tr = (iso: string, type = 'bronze') => ({ type, earnedAt: iso });
const snap = (date: string, seconds: number) => ({ gameId: 1, date, seconds });

describe('QA Ф34: история', () => {
  it('граница полуночи МСК: 20:59:59Z вс = старая неделя, 21:00:00Z вс = новая (пн 00:00 МСК)', () => {
    const h = buildGameHistory({ snaps: [], estimates: [], trophies: [tr('2026-05-03T20:59:59Z'), tr('2026-05-03T21:00:00Z', 'platinum')] })!;
    expect(h.weeks.map((w) => [w.weekStart, w.trophies, w.platinum])).toEqual([['2026-04-27', 1, false], ['2026-05-04', 1, true]]);
    expect(h.hasHours).toBe(false);
    expect(h.playedDays).toBeNull();
    expect(h.firstSnapshotDate).toBeNull();
  });
  it('трофей с earnedAt=null не создаёт неделю; только такие = null', () => {
    expect(buildGameHistory({ snaps: [], estimates: [], trophies: [{ type: 'gold', earnedAt: null }] })).toBeNull();
  });
  it('один снимок: дельт нет, weeks пуст, playedDays 0, hasHours true', () => {
    const h = buildGameHistory({ snaps: [snap('2026-06-02', 3600)], estimates: [], trophies: [] })!;
    expect(h).toMatchObject({ weeks: [], hasHours: true, hasEstimate: false, playedDays: 0, firstSnapshotDate: '2026-06-02' });
  });
  it('отрицательная дельта = 0, не портит сумму; 3 дня игры = playedDays 2 (первый снимок не считается)', () => {
    const h = buildGameHistory({ snaps: [snap('2026-06-01', 1000), snap('2026-06-02', 4600), snap('2026-06-03', 4000), snap('2026-06-04', 5000)], estimates: [], trophies: [] })!;
    expect(h.playedDays).toBe(2);
    expect(h.weeks.reduce((s, w) => s + w.seconds, 0)).toBe(4600);
    expect(h.weeks.every((w) => w.seconds >= w.estimatedSeconds && w.estimatedSeconds >= 0)).toBe(true);
  });
  it('усечение: ровно 52 недели не усекается, 53 = последние 52 и truncated; playedDays по всей истории', () => {
    const base = Date.UTC(2025, 0, 6); // понедельник
    const mk = (n: number) => Array.from({ length: n }, (_, i) => tr(new Date(base + i * 7 * 86400_000 + 12 * 3600_000).toISOString()));
    expect(buildGameHistory({ snaps: [], estimates: [], trophies: mk(52) })!).toMatchObject({ truncated: false });
    const h = buildGameHistory({ snaps: [], estimates: [], trophies: mk(53) })!;
    expect(h.truncated).toBe(true);
    expect(h.weeks).toHaveLength(52);
    expect(h.weeks[0].weekStart).toBe(new Date(base + 7 * 86400_000).toISOString().slice(0, 10));
  });
});
