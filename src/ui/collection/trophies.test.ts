import { describe, expect, it } from 'vitest';
import type { GameTrophyItem } from '@/server/collection/types';
import {
  filterTrophies, formatRate, platinumEarnedAt, rarityLabel, raritySegments, sortTrophies, trophyAria, trophyCounts, trophyTitle, visibleTrophyCount,
} from './trophies';

const t = (trophyId: number, o: Partial<GameTrophyItem> = {}): GameTrophyItem => ({
  setId: 1, trophyId, type: 'bronze', name: `T${trophyId}`, detail: null, iconUrl: null, hidden: false, earned: false, earnedAt: null,
  rarity: null, earnedRate: null, ...o,
});
const ids = (l: GameTrophyItem[]) => l.map((x) => x.trophyId);

describe('трофеи окна игры', () => {
  const list = [
    t(0, { type: 'platinum', earned: true, earnedAt: '2026-10-05T18:00:00.000Z', rarity: 0, earnedRate: 2.4 }),
    t(1, { earned: true, earnedAt: '2026-10-01T10:00:00.000Z', rarity: 3, earnedRate: 80 }),
    t(2, { rarity: 1, earnedRate: 9 }),
    t(3, { rarity: null }),
    t(4, { earned: true, earnedAt: null, rarity: 2, earnedRate: 30 }),
    t(5, { rarity: 0, earnedRate: 1.2 }),
  ];
  it('счётчики и фильтр', () => {
    expect(trophyCounts(list)).toEqual({ all: 6, earned: 3, locked: 3 });
    expect(ids(filterTrophies(list, 'earned'))).toEqual([0, 1, 4]);
    expect(ids(filterTrophies(list, 'locked'))).toEqual([2, 3, 5]);
    expect(filterTrophies(list, 'all')).toHaveLength(6);
    expect(trophyCounts([])).toEqual({ all: 0, earned: 0, locked: 0 });
  });
  it('«Как в игре»: setId, trophyId', () => {
    const mixed = [t(2, { setId: 2 }), t(5), t(1, { setId: 2 }), t(0)];
    expect(sortTrophies(mixed, 'game').map((x) => `${x.setId}:${x.trophyId}`)).toEqual(['1:0', '1:5', '2:1', '2:2']);
  });
  it('«Сначала редкие»: rarity 0 -> 3, null в конце, затем earnedRate по возрастанию', () => {
    // rarity 0: 1.2 (id5) раньше 2.4 (id0)
    expect(ids(sortTrophies(list, 'rare'))).toEqual([5, 0, 2, 4, 1, 3]);
  });
  it('«Сначала обычные»: rarity 3 -> 0, null в конце', () => {
    // rarity 0: 2,4% (id0) раньше 1,2% (id5): среди обычных сначала более частые
    expect(ids(sortTrophies(list, 'common'))).toEqual([1, 4, 2, 0, 5, 3]);
  });
  it('«Недавно полученные»: по дате, затем получены без даты, затем не полученные', () => {
    expect(ids(sortTrophies(list, 'recent'))).toEqual([0, 1, 4, 2, 3, 5]);
  });
  it('ничья по редкости и проценту разрешается по trophyId, исходный массив не меняется', () => {
    const same = [t(9, { rarity: 2, earnedRate: 5 }), t(3, { rarity: 2, earnedRate: 5 })];
    expect(ids(sortTrophies(same, 'rare'))).toEqual([3, 9]);
    expect(ids(same)).toEqual([9, 3]);
  });
  it('редкость: подписи, сегменты, неизвестная', () => {
    expect([0, 1, 2, 3].map(rarityLabel)).toEqual(['Ультра-редкий', 'Очень редкий', 'Редкий', 'Обычный']);
    expect(rarityLabel(null)).toBeNull();
    expect(rarityLabel(7)).toBeNull();
    expect([0, 1, 2, 3, null].map(raritySegments)).toEqual([4, 3, 2, 1, 0]);
  });
  it('процент: запятая, 1 знак, <0,1%', () => {
    expect(formatRate(2.4)).toBe('2,4%');
    expect(formatRate(12)).toBe('12,0%');
    expect(formatRate(0.05)).toBe('<0,1%');
    expect(formatRate(0)).toBe('<0,1%');
    expect(formatRate(0.1)).toBe('0,1%');
    expect(formatRate(null)).toBeNull();
  });
  it('скрытый трофей: заглушка названия, aria-подпись', () => {
    expect(trophyTitle(t(1, { name: null }))).toBe('Скрытый трофей');
    expect(trophyAria(t(1, { name: null, type: 'gold' }))).toBe('Золото: Скрытый трофей, не получено');
    expect(trophyAria(t(1, { earned: true }))).toBe('Бронза: T1');
  });
  it('длинный список: до 200 все, дальше порциями по 100', () => {
    expect(visibleTrophyCount(150, 100)).toBe(150);
    expect(visibleTrophyCount(200, 100)).toBe(200);
    expect(visibleTrophyCount(350, 100)).toBe(100);
    expect(visibleTrophyCount(350, 200)).toBe(200);
    expect(visibleTrophyCount(350, 500)).toBe(350);
  });
  it('дата платины', () => {
    expect(platinumEarnedAt(list)).toBe('2026-10-05T18:00:00.000Z');
    expect(platinumEarnedAt([t(0, { type: 'platinum' })])).toBeNull();
    expect(platinumEarnedAt([])).toBeNull();
  });
});
