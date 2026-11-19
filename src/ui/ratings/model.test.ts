import { describe, expect, it } from 'vitest';
import type { GameItem } from '@/server/collection/types';
import { average, avgText, bandHoursText, completedUnrated, distribution, hoursByBand, isRated, topGenres, type Rated } from './model';

const g = (id: number, o: Partial<GameItem> = {}) => ({ id, title: `G${id}`, status: 'completed', hours: 0, genres: [], rating: null, completedAt: null, ...o }) as GameItem;
const A = { key: 'ACTION', label: 'Экшен' };
const R = { key: 'RPG', label: 'Ролевые' };

describe('идея 6: «Мои оценки»', () => {
  const games = [
    g(1, { rating: 9, hours: 80, genres: [R] }), g(2, { rating: 10, hours: 40, genres: [R, A] }), g(3, { rating: 0, hours: 2, genres: [A] }),
    g(4, { rating: 7, hours: 0, genres: [A] }), g(5, { rating: null, completedAt: '2026-01-01T00:00:00Z' }), g(6, { rating: null, completedAt: '2026-05-01T00:00:00Z' }),
    g(7, { rating: null, status: 'backlog' }),
  ];
  const rated = games.filter(isRated) as Rated[];

  it('0 — тоже оценка; распределение и средняя', () => {
    expect(rated.map((x) => x.id)).toEqual([1, 2, 3, 4]);
    expect(distribution(rated)).toEqual([1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1]);
    expect(avgText(average(rated) as number)).toBe('6,5');
    expect(average([])).toBeNull();
  });
  it('часы по группам оценок: медиана, без игр с 0 ч', () => {
    const b = hoursByBand(rated);
    expect(b.map((x) => [x.label, x.count, x.medianHours])).toEqual([['0–4', 1, 2], ['5–6', 0, null], ['7–8', 1, null], ['9–10', 2, 60]]);
    expect(bandHoursText(b[3])).toBe('60 ч');
    expect(bandHoursText(b[1])).toBe('—');
  });
  it('жанры: от 2 оценок, по средней', () => {
    expect(topGenres(rated).map((x) => [x.label, avgText(x.avg), x.count])).toEqual([['Ролевые', '9,5', 2], ['Экшен', '5,7', 3]]);
  });
  it('пройденные без оценки: свежие первыми, только «Пройдено»', () => {
    expect(completedUnrated(games).map((x) => x.id)).toEqual([6, 5]);
  });
});
