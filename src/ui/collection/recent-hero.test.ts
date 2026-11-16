import { describe, expect, it } from 'vitest';
import { recentMeta } from './RecentHero';

describe('«Недавно в коллекции»: подпись', () => {
  it('дата завершения и время; без даты только время; без времени только дата', () => {
    expect(recentMeta({ status: 'completed', completedAt: '2026-10-30T12:00:00.000Z', droppedAt: null, playSeconds: 5 * 3600 + 60 })).toBe('30 окт. · 5 ч 1 м');
    expect(recentMeta({ status: 'dropped', completedAt: null, droppedAt: '2026-02-14T12:00:00.000Z', playSeconds: 0 })).toBe('14 февр.');
    expect(recentMeta({ status: 'completed', completedAt: null, droppedAt: null, playSeconds: 3600 })).toBe('1 ч');
  });
});
