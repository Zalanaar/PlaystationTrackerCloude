import { describe, expect, it } from 'vitest';
import type { RareTrophy } from '@/server/stats/types';
import { RARE_EMPTY, rareList, rareRows } from './rare';

const t = (o: Partial<RareTrophy> = {}): RareTrophy => ({
  setId: 41, trophyId: 12, type: 'gold', name: 'Без единой царапины', detail: 'Пройдите на высоком уровне сложности', iconUrl: null,
  earnedAt: '2026-03-02T19:10:00.000Z', earnedRate: 0.8, rarity: 0, setName: 'Horizon', game: { id: 17, title: 'Horizon Forbidden West', coverUrl: null }, ...o,
});

describe('rareList', () => {
  it('выбирает область и переживает старый ответ без блока', () => {
    const rt = { period: [t()], allTime: [t(), t({ trophyId: 13 })] };
    expect(rareList(rt, 'period')).toHaveLength(1);
    expect(rareList(rt, 'allTime')).toHaveLength(2);
    expect(rareList(undefined, 'period')).toEqual([]);
    expect(rareList({ period: [], allTime: [] }, 'allTime')).toEqual([]);
  });
  it('не больше пяти', () => {
    expect(rareList({ period: Array.from({ length: 8 }, (_, i) => t({ trophyId: i })), allTime: [] }, 'period')).toHaveLength(5);
  });
  it('тексты пустых состояний', () => {
    expect(RARE_EMPTY.period).toBe('Редких трофеев за этот период нет');
    expect(RARE_EMPTY.allTime).toBe('Трофеев с известной редкостью пока нет');
  });
});

describe('rareRows', () => {
  it('основная строка: ранг, процент с запятой, редкость, игра, дата', () => {
    const [r] = rareRows([t()]);
    expect(r).toMatchObject({ rank: 1, name: 'Без единой царапины', gameName: 'Horizon Forbidden West', gameId: 17, rate: '0,8%', rarity: 'Ультра-редкий', segments: 4, rarityKnown: true });
    expect(r.date).toBe('2 мар. 2026');
    expect(r.aria).toContain('0,8%');
  });
  it('нет даты и нет редкости', () => {
    const [r] = rareRows([t({ earnedAt: null, rarity: null })]);
    expect(r.date).toBe('дата неизвестна');
    expect(r).toMatchObject({ rarity: 'Редкость неизвестна', segments: 0, rarityKnown: false });
  });
  it('сет-сирота: вместо игры название набора, затем «Игра вне коллекции»; строка без gameId', () => {
    expect(rareRows([t({ game: null })])[0]).toMatchObject({ gameName: 'Horizon', gameId: null });
    expect(rareRows([t({ game: null, setName: '  ' })])[0].gameName).toBe('Игра вне коллекции');
  });
  it('очень малый процент: «<0,1%»', () => {
    expect(rareRows([t({ earnedRate: 0.04 })])[0].rate).toBe('<0,1%');
  });
  it('ранги идут подряд', () => {
    expect(rareRows([t(), t({ trophyId: 2 }), t({ trophyId: 3 })]).map((r) => r.rank)).toEqual([1, 2, 3]);
  });
});
