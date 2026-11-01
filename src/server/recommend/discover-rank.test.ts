// «У тебя нет» (Фаза 30, 30.3): чистые правила отбора и ранжирования.
import { describe, expect, it } from 'vitest';
import {
  buildLibraryIndex, inLibrary, libraryKey, mapGenres, pickFacets, rankPool, scoreEntry, similarGames, tasteOf, templateReason, type PoolEntry,
} from './discover-rank';
import type { HistoryGame } from './types';

const H = (id: number, status: HistoryGame['status'], genres: HistoryGame['genres'], hours: number): HistoryGame & { name: string } => ({
  id, status, genres, playSeconds: hours * 3600, name: `Своя ${id}`,
});
const E = (id: string, title: string, genres: PoolEntry['genres'], mc: number | null = 90): PoolEntry => ({
  externalId: id, title, slug: title.toLowerCase().replace(/\W+/g, '-'), releaseDate: '2020-01-01', coverUrl: null, platforms: ['PS5'], genres, rating: 4.2, metacritic: mc,
});
const NONE = { excludedIds: new Set<string>(), excludedKeys: new Set<string>() };

describe('libraryKey / inLibrary', () => {
  it('редакции, платформы, регистр и артикль не мешают совпадению', () => {
    expect(libraryKey('The Witcher 3: Wild Hunt - Complete Edition')).toBe(libraryKey('Witcher 3 Wild Hunt'));
    expect(libraryKey('God of War (PS4)')).toBe('god of war');
    expect(libraryKey('Marvel’s Spider-Man Remastered')).toBe(libraryKey('Marvel\'s Spider-Man'));
    expect(libraryKey('Shadow of the Colossus')).toBe('shadow of the colossus');
  });
  it('разные части не склеиваются', () => {
    const lib = buildLibraryIndex(['Resident Evil 2', 'Hades']);
    expect(inLibrary('Resident Evil 3', lib)).toBe(false);
    expect(inLibrary('Resident Evil 2', lib)).toBe(true);
    expect(inLibrary('HADES', lib)).toBe(true);
    expect(inLibrary('Hades II', lib)).toBe(false);
  });
});

describe('mapGenres', () => {
  it('жанры RAWG -> GenreKey, horror из меток, незнакомое пропускается', () => {
    expect(mapGenres(['action', 'indie', 'role-playing-games-rpg', 'action'], ['horror'])).toEqual(['ACTION', 'ROLE_PLAYING_GAMES', 'HORROR']);
    expect(mapGenres(['unknown'])).toEqual([]);
  });
});

describe('pickFacets', () => {
  it('до 3 любимых жанров с фасетом и `all` последним; без истории только `all`', () => {
    expect(pickFacets(tasteOf([])).map((f) => f.id)).toEqual(['all']);
    const taste = tasteOf([
      H(1, 'completed', ['ROLE_PLAYING_GAMES'], 100), H(2, 'completed', ['ACTION'], 50), H(3, 'completed', ['HORROR'], 30),
      H(4, 'completed', ['MUSIC_RHYTHM'], 20), H(5, 'completed', ['STRATEGY'], 5),
    ]);
    const ids = pickFacets(taste).map((f) => f.id);
    expect(ids).toEqual(['genres:role-playing-games-rpg', 'genres:action', 'tags:horror', 'all']);
  });
  it('наказанный жанр (часто бросаешь) не становится фасетом', () => {
    const taste = tasteOf([
      H(1, 'dropped', ['STRATEGY'], 2), H(2, 'dropped', ['STRATEGY'], 2), H(3, 'dropped', ['STRATEGY'], 2), H(4, 'completed', ['STRATEGY'], 1),
      H(5, 'completed', ['ACTION'], 10),
    ]);
    expect(pickFacets(taste).map((f) => f.id)).toEqual(['genres:action', 'all']);
  });
});

describe('rankPool', () => {
  const taste = tasteOf([H(1, 'completed', ['ACTION'], 100), H(2, 'completed', ['ROLE_PLAYING_GAMES'], 20)]);

  it('игры библиотеки (включая другое написание) не попадают в выдачу', () => {
    const lib = buildLibraryIndex(['Elden Ring', 'God of War (PS4)', 'Hades']);
    const pool = [E('1', 'Elden Ring', ['ACTION']), E('2', 'God of War Ragnarök', ['ACTION']), E('3', 'God of War', ['ACTION']), E('4', 'Hades', ['ACTION']), E('5', 'Bloodborne', ['ACTION'])];
    const r = rankPool({ pool, taste, lib, ...NONE });
    expect(r.map((x) => x.title).sort()).toEqual(['Bloodborne', 'God of War Ragnarök']);
  });

  it('«Не интересно» и План исключаются по id и по названию', () => {
    const r = rankPool({
      pool: [E('1', 'Alpha', ['ACTION']), E('2', 'Beta', ['ACTION']), E('3', 'Gamma Edition', ['ACTION'])], taste, lib: buildLibraryIndex([]),
      excludedIds: new Set(['1']), excludedKeys: new Set([libraryKey('Gamma')]),
    });
    expect(r.map((x) => x.externalId)).toEqual(['2']);
  });

  it('порядок: сначала жанр по вкусу, затем метакритик; метакритик ниже порога и без него отбрасывается', () => {
    const pool = [E('1', 'Low', ['ACTION'], 74), E('2', 'NoMc', ['ACTION'], null), E('3', 'Strat', ['STRATEGY'], 99), E('4', 'Act', ['ACTION'], 80), E('5', 'Rpg', ['ROLE_PLAYING_GAMES'], 95)];
    const r = rankPool({ pool, taste, lib: buildLibraryIndex([]), ...NONE });
    expect(r.map((x) => x.title)).toEqual(['Act', 'Rpg', 'Strat']);
    expect(scoreEntry(pool[0], taste)).toBeNull();
  });

  it('жанр, который бросаешь, отбрасывает игру; дубли названия схлопываются; limit', () => {
    const t2 = tasteOf([
      H(1, 'dropped', ['STRATEGY'], 1), H(2, 'dropped', ['STRATEGY'], 1), H(3, 'dropped', ['STRATEGY'], 1), H(4, 'completed', ['ACTION'], 5),
    ]);
    const r = rankPool({ pool: [E('1', 'S', ['STRATEGY']), E('2', 'A', ['ACTION']), E('3', 'A (PS5)', ['ACTION'])], taste: t2, lib: buildLibraryIndex([]), ...NONE });
    expect(r.map((x) => x.externalId)).toEqual(['2']);
    const many = Array.from({ length: 40 }, (_, i) => E(String(i + 1), `Game ${i} xx${'abcdefghij'[i % 10]}${i}`, ['ACTION']));
    expect(rankPool({ pool: many, taste, lib: buildLibraryIndex([]), ...NONE })).toHaveLength(24);
    expect(rankPool({ pool: many, taste, lib: buildLibraryIndex([]), ...NONE, limit: 5 })).toHaveLength(5);
  });

  it('детерминированно: равный score сортируется по метакритику и id', () => {
    const empty = tasteOf([]);
    const a = rankPool({ pool: [E('9', 'Nine', []), E('2', 'Two', []), E('5', 'Five', [], 90)], taste: empty, lib: buildLibraryIndex([]), ...NONE });
    const b = rankPool({ pool: [E('5', 'Five', [], 90), E('2', 'Two', []), E('9', 'Nine', [])], taste: empty, lib: buildLibraryIndex([]), ...NONE });
    expect(a.map((x) => x.externalId)).toEqual(['2', '5', '9']);
    expect(b.map((x) => x.externalId)).toEqual(['2', '5', '9']);
  });
});

describe('templateReason', () => {
  const taste = tasteOf([H(1, 'completed', ['ACTION'], 100), H(2, 'completed', ['ACTION'], 50), H(3, 'completed', ['ROLE_PLAYING_GAMES'], 10)]);
  const history = [H(1, 'completed', ['ACTION'], 100), H(2, 'completed', ['ACTION'], 50), H(3, 'completed', ['ROLE_PLAYING_GAMES'], 10)];
  it('две похожие и жанр', () => {
    const e = E('1', 'X', ['ACTION']);
    expect(templateReason(e, similarGames(e, history), taste)).toBe('Похожа на «Своя 1» и «Своя 2», жанр «Экшен».');
  });
  it('одна похожая', () => {
    const e = E('1', 'X', ['ROLE_PLAYING_GAMES']);
    expect(templateReason(e, similarGames(e, history), taste)).toBe('Похожа на «Своя 3», жанр «Ролевые».');
  });
  it('нет похожих: жанр по вкусу и метакритик; совсем без данных', () => {
    const e = E('1', 'X', ['ACTION'], 88);
    expect(templateReason(e, [], taste)).toBe('Жанр «Экшен» тебе заходит, Metacritic 88.');
    expect(templateReason(E('2', 'Y', [], 91), [], tasteOf([]))).toBe('Высоко оценена на PlayStation: Metacritic 91.');
  });
  it('в похожие не попадают брошенные и чужие жанры', () => {
    expect(similarGames({ genres: ['ACTION'] }, [H(1, 'dropped', ['ACTION'], 100), H(2, 'completed', ['PUZZLE'], 100)])).toEqual([]);
  });
});
