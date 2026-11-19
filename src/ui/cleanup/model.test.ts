import { describe, expect, it } from 'vitest';
import type { GameItem } from '@/server/collection/types';
import { cleanupQueue, cleanupTotals, freedHours, freedText, swipeChoice, totalsText } from './model';

const NOW = Date.parse('2026-11-19T12:00:00.000Z');
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const g = (id: number, o: Partial<GameItem> = {}) => ({ id, title: `G${id}`, status: 'backlog', playSeconds: 0, ...o }) as GameItem;

describe('идея 5: очередь «Чистки»', () => {
  it('≥ 2 лет и < 1 ч; старшие первыми; не-бэклог и неизвестные пропускает', () => {
    const age = { items: [
      { gameId: 1, since: ago(800), source: 'status' as const, playSeconds: 100 },
      { gameId: 2, since: ago(1200), source: 'played' as const, playSeconds: 3599 },
      { gameId: 3, since: ago(729), source: 'status' as const, playSeconds: 0 },
      { gameId: 4, since: ago(2000), source: 'status' as const, playSeconds: 3600 },
      { gameId: 5, since: ago(900), source: 'status' as const, playSeconds: 0 },
      { gameId: 6, since: ago(900), source: 'status' as const },
    ] };
    const q = cleanupQueue(age, [g(1), g(2), g(3), g(4), g(5, { status: 'shelved' }), g(6, { playSeconds: 4000 })], NOW);
    expect(q.map((i) => i.game.id)).toEqual([2, 1]);
    expect(q[0].days).toBe(1200);
  });
});

describe('идея 5: итог', () => {
  it('часы — остаток, иначе длительность, иначе 0', () => {
    expect(freedHours(g(1, { duration: { remainingHours: 8.5, hours: 10 } as never }))).toBe(8.5);
    expect(freedHours(g(1, { duration: { hours: 10 } as never }))).toBe(10);
    expect(freedHours(g(1))).toBe(0);
  });
  it('считает отложенные и брошенные в часы, оставленные — нет', () => {
    const t = cleanupTotals([{ gameId: 1, choice: 'keep', hours: 50 }, { gameId: 2, choice: 'shelved', hours: 20.25 }, { gameId: 3, choice: 'dropped', hours: 100 }]);
    expect(t).toEqual({ done: 3, kept: 1, shelved: 1, dropped: 1, hours: 120.3 });
    expect(freedText(t)).toBe('−120 ч из бэклога');
    expect(totalsText(t)).toBe('Разобрано 3: отложено 1, брошено 1, оставлено 1');
    expect(freedText(cleanupTotals([{ gameId: 1, choice: 'keep', hours: 5 }]))).toBeNull();
    expect(totalsText(cleanupTotals([]))).toBe('Ничего не разобрано');
  });
  it('свайп: вправо — оставить, влево — отложить, коротко — ничего', () => {
    expect(swipeChoice(120)).toBe('keep');
    expect(swipeChoice(-95)).toBe('shelved');
    expect(swipeChoice(40)).toBeNull();
  });
});
