import { describe, expect, it } from 'vitest';
import { aggregateGenresWithGames, aggregateGenres, type GenreGameInfo } from './genre-stats';
import { rankByHours, rankByTrophies, TOP_LIMIT, TROPHY_POINTS } from './top';

const titles = new Map([[1, 'beta'], [2, 'Alpha'], [3, 'alpha'], [4, 'Zed']]);

describe('rankByHours', () => {
  it('сортировка: секунды по убыванию, затем lower(title), id; 0 секунд не входит', () => {
    const r = rankByHours(new Map([[1, 3600], [2, 7200], [3, 7200], [4, 0]]), new Map(), titles);
    expect(r.map((x) => x.gameId)).toEqual([2, 3, 1]);
    expect(r[0]).toMatchObject({ seconds: 7200, hours: 2, estimated: false });
  });
  it('estimated = есть оценочная доля; часы до 0.1', () => {
    const r = rankByHours(new Map([[1, 5400 + 100]]), new Map([[1, 100]]), titles);
    expect(r[0]).toMatchObject({ hours: 1.5, estimated: true });
  });
  it('топ-10', () => {
    const m = new Map(Array.from({ length: 15 }, (_, i) => [i + 1, 100 + i] as const));
    const r = rankByHours(m, new Map(), new Map());
    expect(r).toHaveLength(TOP_LIMIT);
    expect(r[0].gameId).toBe(15);
  });
  it('пусто', () => {
    expect(rankByHours(new Map(), new Map(), titles)).toEqual([]);
  });
});

describe('rankByTrophies', () => {
  it('очки 15/30/90/300 и счётчики', () => {
    expect(TROPHY_POINTS).toEqual({ bronze: 15, silver: 30, gold: 90, platinum: 300 });
    const r = rankByTrophies(
      [
        { gameId: 1, type: 'platinum', n: 1 },
        { gameId: 1, type: 'gold', n: 5 },
        { gameId: 1, type: 'silver', n: 12 },
        { gameId: 1, type: 'bronze', n: 20 },
      ],
      titles,
    );
    expect(r).toEqual([{ gameId: 1, points: 300 + 450 + 360 + 300, counts: { platinum: 1, gold: 5, silver: 12, bronze: 20, total: 38 } }]);
  });
  it('порядок: очки, lower(title), id; нулевые n отбрасываются', () => {
    const r = rankByTrophies(
      [
        { gameId: 1, type: 'bronze', n: 2 }, // 30
        { gameId: 2, type: 'silver', n: 1 }, // 30
        { gameId: 3, type: 'silver', n: 1 }, // 30, тот же title 'alpha', id 3 после 2
        { gameId: 4, type: 'gold', n: 0 },
        { gameId: 5, type: 'platinum', n: 1 },
      ],
      titles,
    );
    expect(r.map((x) => x.gameId)).toEqual([5, 2, 3, 1]);
  });
  it('топ-10 и пустой вход', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ gameId: i + 1, type: 'bronze' as const, n: i + 1 }));
    expect(rankByTrophies(rows, new Map())).toHaveLength(10);
    expect(rankByTrophies([], titles)).toEqual([]);
  });
});

describe('aggregateGenresWithGames', () => {
  const g = (id: number, title: string, genres: string[], seconds: number): GenreGameInfo => ({
    id, title, coverUrl: `https://c/${id}`, psnGenres: genres, genresOverride: null, seconds,
  });
  const list = [g(1, 'b', ['ACTION'], 100), g(2, 'A', ['ACTION', 'ADVENTURE'], 100), g(3, 'c', ['ADVENTURE'], 500), g(4, 'd', ['PUZZLE'], 0)];
  it('веса те же, что у aggregateGenres', () => {
    const w = aggregateGenresWithGames(list);
    expect(w.items.map((i) => ({ key: i.key, label: i.label, value: i.value }))).toEqual(aggregateGenres(list).items);
  });
  it('gameIds: секунды по убыванию, затем lower(title), id; игра в нескольких жанрах', () => {
    const w = aggregateGenresWithGames(list);
    const by = Object.fromEntries(w.items.map((i) => [i.key, i.gameIds]));
    expect(by.ACTION).toEqual([2, 1]);
    expect(by.ADVENTURE).toEqual([3, 2]);
    expect(by.PUZZLE).toEqual([4]);
  });
  it('games = ровно все gameIds, ключ строка', () => {
    const w = aggregateGenresWithGames(list);
    const ids = new Set(w.items.flatMap((i) => i.gameIds));
    expect(new Set(Object.keys(w.games))).toEqual(new Set([...ids].map(String)));
    expect(w.games['3']).toEqual({ id: 3, title: 'c', coverUrl: 'https://c/3' });
  });
  it('лимит игр на жанр', () => {
    const many = Array.from({ length: 70 }, (_, i) => g(i + 1, `t${i}`, ['ACTION'], 1000 - i));
    const w = aggregateGenresWithGames(many);
    expect(w.items[0].gameIds).toHaveLength(50);
    expect(w.items[0].gameIds[0]).toBe(1);
    expect(Object.keys(w.games)).toHaveLength(50);
  });
  it('пусто', () => {
    expect(aggregateGenresWithGames([])).toEqual({ hasData: false, items: [], games: {} });
  });
});
