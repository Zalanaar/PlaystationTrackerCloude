import { describe, expect, it } from 'vitest';
import type { OtherPlatformGame } from './api';
import { gamesText, otherGroups, otherStats, otherYear, platformChip } from './block';

const g = (id: number, o: Partial<OtherPlatformGame> = {}): OtherPlatformGame => ({
  id, source: 'manual', kind: 'other_platform', externalSource: 'rawg', externalId: String(id), title: `G${id}`, coverUrl: null, releaseDate: null,
  platformLabel: null, createdAt: '2026-11-03T10:00:00.000Z', status: null, statusChangedAt: null, rating: null, note: null, ...o,
});

describe('блок «Игры с других платформ»', () => {
  it('подпись RAWG → чип Switch / Xbox / PC', () => {
    expect(['Nintendo Switch', 'Switch', 'Xbox Series S/X', 'Xbox One', 'PC', 'macOS', 'Linux', 'Wii U', null].map(platformChip))
      .toEqual(['Switch', 'Switch', 'Xbox', 'Xbox', 'PC', 'PC', 'PC', null, null]);
    expect(platformChip('iOS')).toBeNull();
  });
  it('год: только ○ и ✕ по дате смены статуса (МСК); остальное без года', () => {
    expect(otherYear(g(1, { status: 'completed', statusChangedAt: '2025-12-31T21:30:00.000Z' }))).toBe(2026);
    expect(otherYear(g(1, { status: 'dropped', statusChangedAt: '2024-06-01T00:00:00.000Z' }))).toBe(2024);
    expect(otherYear(g(1, { status: 'playing', statusChangedAt: '2024-06-01T00:00:00.000Z' }))).toBeNull();
    expect(otherYear(g(1, { status: 'completed' }))).toBeNull();
  });
  it('группы: годы по убыванию, «Не распределено» внизу', () => {
    const r = otherGroups([
      g(1, { status: 'completed', statusChangedAt: '2024-03-01T00:00:00.000Z' }),
      g(2),
      g(3, { status: 'completed', statusChangedAt: '2026-03-01T00:00:00.000Z' }),
      g(4, { status: 'dropped', statusChangedAt: '2026-05-01T00:00:00.000Z' }),
      g(5, { status: 'backlog', statusChangedAt: '2026-05-01T00:00:00.000Z' }),
    ]);
    expect(r.map((x) => [x.title, x.items.map((i) => i.id)])).toEqual([['2026', [4, 3]], ['2024', [1]], ['Не распределено', [5, 2]]]);
    expect(otherGroups([])).toEqual([]);
  });
  it('сводка: платформы, статусы, средняя оценка', () => {
    const s = otherStats([
      g(1, { platformLabel: 'Xbox One', status: 'completed', rating: 8 }),
      g(2, { platformLabel: 'Nintendo Switch', status: 'completed', rating: 7 }),
      g(3, { platformLabel: 'iOS', status: 'dropped' }),
      g(4),
    ]);
    expect(s).toEqual({
      total: 4, rated: 2, avgRating: 7.5,
      byPlatform: [{ label: 'Switch', n: 1 }, { label: 'Xbox', n: 1 }, { label: 'Другая', n: 1 }, { label: 'Не указана', n: 1 }],
      byStatus: { playing: 0, completed: 2, backlog: 0, dropped: 1 },
    });
    expect(otherStats([]).avgRating).toBeNull();
    expect([gamesText(1), gamesText(3), gamesText(5)]).toEqual(['1 игра', '3 игры', '5 игр']);
  });
});
