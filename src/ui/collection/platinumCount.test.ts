import { describe, expect, it } from 'vitest';
import type { GameItem } from '@/server/collection/types';
import { platinumChipCount } from './platinumCount';

const game = (id: number, plat: boolean): GameItem => ({
  id, title: 'X', coverUrl: null, platform: 'PS5', playSeconds: 0, hours: 0, playCount: 0, lastPlayedAt: null,
  status: null, completedAt: null, droppedAt: null, genres: [], bannerUrl: null, hiddenAt: null,
  trophies: plat ? ({ platinumEarned: true } as GameItem['trophies']) : null,
});

describe('platinumChipCount (Фаза 48, п. 15)', () => {
  const all = { q: '', status: 'all' };
  it('без поиска: итог сводки', () => {
    expect(platinumChipCount(12, all, { items: [game(1, true)], total: 1 })).toBe(12);
    expect(platinumChipCount(null, all, null)).toBeNull();
  });
  it('пустой поиск: 0, а не общий итог', () => {
    expect(platinumChipCount(12, { q: 'zzzz', status: 'all' }, { items: [], total: 0 })).toBe(0);
  });
  it('поиск, выборка целиком: считаем по ней', () => {
    expect(platinumChipCount(12, { q: 'halo', status: 'all' }, { items: [game(1, true), game(2, false), game(3, true)], total: 3 })).toBe(2);
  });
  it('поиск, выборка неполная или задан статус: итог сводки', () => {
    expect(platinumChipCount(12, { q: 'halo', status: 'all' }, { items: [game(1, true)], total: 5 })).toBe(12);
    expect(platinumChipCount(12, { q: 'halo', status: 'completed' }, { items: [game(1, true)], total: 1 })).toBe(12);
    expect(platinumChipCount(12, { q: '  ', status: 'all' }, { items: [], total: 0 })).toBe(12);
  });
  it('поиск до загрузки пула: итог сводки', () => {
    expect(platinumChipCount(12, { q: 'halo', status: 'all' }, null)).toBe(12);
  });
});
