// Фаза 11, N-4: фильтр genres=none («без жанра») и genreCounts (контракт 16.4).
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { hasNoGenres } from '@/shared/genres';
import { createTestDb, type TestDb, TEST_USER } from '@/server/sync/test-helpers';
import { listGames } from './query';
import { parseListQuery } from './validation';

const { games, gameStatus } = schema;
const NOW = new Date('2026-10-28T10:00:00Z');

describe('hasNoGenres', () => {
  it('пусто, null, пробелы = нет жанров; override приоритетнее', () => {
    expect(hasNoGenres([], null)).toBe(true);
    expect(hasNoGenres(null, null)).toBe(true);
    expect(hasNoGenres([' '], null)).toBe(true);
    expect(hasNoGenres(['ACTION'], null)).toBe(false);
    expect(hasNoGenres(['ACTION'], [])).toBe(true);
    expect(hasNoGenres([], ['RACING'])).toBe(false);
  });
});

describe('валидация genres=none', () => {
  it('none в любом регистре, вместе с обычными, неизвестное по-прежнему 400', () => {
    const r = parseListQuery(new URLSearchParams('genres=None,horror,NONE'));
    expect(r.ok && r.value.genres).toEqual(['none', 'HORROR']);
    expect(parseListQuery(new URLSearchParams('genres=none,NOPE')).ok).toBe(false);
  });
});

describe('GET /api/games: none и genreCounts', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    const base = { category: 'ps5_native_game', lastSeenAt: NOW };
    const rows = [
      { titleId: 'A', name: 'Alpha', psnGenres: ['ACTION'] },
      { titleId: 'B', name: 'Bravo', psnGenres: ['ACTION', 'HORROR'] },
      { titleId: 'C', name: 'Charlie', psnGenres: [] as string[] },
      { titleId: 'D', name: 'Delta', psnGenres: ['UNIQUE'] },
      { titleId: 'E', name: 'Echo', psnGenres: ['HORROR'], hltbId: 1, hltbMainHours: 5 },
      { titleId: 'H', name: 'Hidden', psnGenres: [] as string[], hiddenAt: NOW },
    ];
    const ins = await t.db.insert(games).values(rows.map((r) => ({ ...base, ...r }))).returning({ id: games.id, titleId: games.titleId });
    const id = (k: string) => ins.find((x) => x.titleId === k)!.id;
    await t.db.insert(gameStatus).values([
      { gameId: id('A'), status: 'backlog' as const },
      { gameId: id('C'), status: 'backlog' as const },
      { gameId: id('E'), status: 'playing' as const },
    ]);
  });
  const list = async (q: string) => {
    const p = parseListQuery(new URLSearchParams(q));
    if (!p.ok) throw new Error(p.message);
    return listGames(t.db, TEST_USER, p.value, NOW);
  };
  const names = (r: { items: { title: string }[] }) => r.items.map((i) => i.title);

  it('none выбирает игры без жанров; реальный OTHER (UNIQUE) в none не попадает', async () => {
    expect(names(await list('genres=none&sort=title'))).toEqual(['Charlie']);
  });

  it('none + обычный жанр = ИЛИ; override с жанром убирает игру из none', async () => {
    expect(names(await list('genres=none,HORROR&sort=title'))).toEqual(['Bravo', 'Charlie', 'Echo']);
    await t.db.update(games).set({ genresOverride: ['RACING'] }).where(eq(games.titleId, 'C'));
    expect(names(await list('genres=none'))).toEqual([]);
  });

  it('genreCounts: без фильтра genres, ключ none, скрытые не считаются', async () => {
    const r = await list('genres=HORROR');
    expect(r.genreCounts).toEqual({ ACTION: 2, HORROR: 2, OTHER: 2, none: 1 });
    expect(r.total).toBe(2);
  });

  it('genreCounts учитывают status и duration, но не genres', async () => {
    expect((await list('status=backlog')).genreCounts).toEqual({ ACTION: 1, OTHER: 1, none: 1 });
    expect((await list('duration=lt10&genres=none')).genreCounts).toEqual({ HORROR: 1 });
  });
});
