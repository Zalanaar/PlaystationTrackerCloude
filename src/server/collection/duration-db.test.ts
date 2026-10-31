// Фаза 11 на PGlite: фильтры жанр/длительность, сортировка, счётчики бакетов, ручной ввод.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { createTestDb, type TestDb, TEST_USER } from '@/server/sync/test-helpers';
import { NotFoundError, setDurationOverride } from './mutations';
import { getGamesByIds, listGames } from './query';
import { parseListQuery } from './validation';

const { games, gameStatus } = schema;
const NOW = new Date('2026-10-28T10:00:00Z');

describe('GET /api/games: жанры и длительность', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    const base = { category: 'ps5_native_game', lastSeenAt: NOW };
    const rows = [
      { titleId: 'A', name: 'Alpha', psnGenres: ['ACTION'], hltbId: 1, hltbMainHours: 5 },
      { titleId: 'B', name: 'Bravo', psnGenres: ['ACTION', 'ROLE_PLAYING_GAMES'], hltbId: 2, hltbMainHours: 25 },
      { titleId: 'C', name: 'Charlie', psnGenres: ['SIMULATOR'], hltbId: 3, hltbMainHours: 45, durationOverrideHours: 70 },
      { titleId: 'D', name: 'Delta', psnGenres: ['ROLE_PLAYING_GAMES'], hltbId: 4, hltbMainHours: 60 },
      { titleId: 'E', name: 'Echo', psnGenres: ['ACTION'] },
      { titleId: 'F', name: 'Foxtrot', psnGenres: ['UNIQUE'], hltbId: null, hltbCheckedAt: NOW },
    ];
    const ins = await t.db.insert(games).values(rows.map((r) => ({ ...base, ...r }))).returning({ id: games.id, titleId: games.titleId });
    const id = (k: string) => ins.find((x) => x.titleId === k)!.id;
    await t.db.insert(gameStatus).values(['A', 'B', 'C', 'D', 'E'].map((k) => ({ gameId: id(k), status: 'backlog' as const })));
    await t.db.insert(gameStatus).values({ gameId: id('F'), status: 'playing' });
  });

  const list = async (q: string) => {
    const p = parseListQuery(new URLSearchParams(q));
    if (!p.ok) throw new Error(p.message);
    return listGames(t.db, TEST_USER, p.value, NOW);
  };
  const names = (r: { items: { title: string }[] }) => r.items.map((i) => i.title);

  it('без новых параметров ответ как раньше + durationCounts', async () => {
    const r = await list('status=backlog&sort=title');
    expect(names(r)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']);
    expect(r.durationCounts).toEqual({ lt10: 0 + 1, '10_30': 1, '30_60': 0, '60plus': 2, unknown: 1 });
  });

  it('ручная длительность приоритетнее HLTB: Charlie 45 -> 70 (60plus)', async () => {
    const r = await list('status=backlog&duration=60plus&sort=title');
    expect(names(r)).toEqual(['Charlie', 'Delta']);
    const c = r.items.find((i) => i.title === 'Charlie')!;
    expect(c.duration).toMatchObject({ hours: 70, source: 'manual', bucket: '60plus', overrideHours: 70 });
    expect(c.duration?.hltb.mainHours).toBe(45);
  });

  it('бакет unknown: игры без данных, в т.ч. not_found', async () => {
    const r = await list('duration=unknown&sort=title');
    expect(names(r)).toEqual(['Echo', 'Foxtrot']);
    expect(r.items[1].duration?.hltb.status).toBe('not_found');
    expect(r.items[0].duration?.hltb.status).toBe('unchecked');
  });

  it('несколько бакетов = ИЛИ; жанры = ИЛИ; всё вместе = И', async () => {
    expect(names(await list('duration=lt10,10_30&sort=title'))).toEqual(['Alpha', 'Bravo']);
    expect(names(await list('genres=ROLE_PLAYING_GAMES&sort=title'))).toEqual(['Bravo', 'Delta']);
    expect(names(await list('genres=ACTION,ROLE_PLAYING_GAMES&duration=10_30,60plus&sort=title'))).toEqual(['Bravo', 'Delta']);
    expect(names(await list('genres=ACTION&duration=unknown&sort=title'))).toEqual(['Echo']);
  });

  it('нормализация жанров: SIMULATOR = SIMULATION, UNIQUE = OTHER', async () => {
    expect(names(await list('genres=SIMULATION'))).toEqual(['Charlie']);
    expect(names(await list('genres=SIMULATOR'))).toEqual(['Charlie']);
    expect(names(await list('genres=OTHER'))).toEqual(['Foxtrot']);
  });

  it('жанр, которого ни у кого нет: пустой список, total = 0', async () => {
    const r = await list('genres=RACING');
    expect(r.items).toEqual([]);
    expect(r.total).toBe(0);
  });

  it('genres_override учитывается', async () => {
    await t.db.update(games).set({ genresOverride: ['RACING'] }).where(
      eq(games.titleId, 'A'),
    );
    expect(names(await list('genres=RACING'))).toEqual(['Alpha']);
    expect(names(await list('genres=ACTION&sort=title'))).toEqual(['Bravo', 'Echo']);
  });

  it('sort=duration: asc по умолчанию, неизвестные всегда в конце; desc тоже', async () => {
    expect(names(await list('status=backlog&sort=duration'))).toEqual(['Alpha', 'Bravo', 'Delta', 'Charlie', 'Echo']);
    expect(names(await list('status=backlog&sort=duration&order=desc'))).toEqual(['Charlie', 'Delta', 'Bravo', 'Alpha', 'Echo']);
  });

  it('durationCounts не зависят от duration, но зависят от status/genres; counts статусов зависят от duration', async () => {
    const r = await list('status=backlog&genres=ACTION&duration=lt10');
    expect(names(r)).toEqual(['Alpha']);
    expect(r.durationCounts).toEqual({ lt10: 1, '10_30': 1, '30_60': 0, '60plus': 0, unknown: 1 });
    expect(r.counts.backlog).toBe(1);
    expect(r.total).toBe(1);
  });

  it('скрытые игры не попадают в счётчики и фильтры', async () => {
    await t.db.update(games).set({ hiddenAt: NOW }).where(eq(games.titleId, 'A'));
    const r = await list('');
    expect(r.durationCounts.lt10).toBe(0);
    expect(r.total).toBe(5);
  });

  it('ручной ввод и сброс: статус не меняется; сброс возвращает HLTB', async () => {
    const [b] = await t.db.select({ id: games.id }).from(games).where(eq(games.titleId, 'B'));
    await setDurationOverride(t.db, TEST_USER, b.id, 3);
    let [g] = await getGamesByIds(t.db, TEST_USER, [b.id]);
    expect(g.duration).toMatchObject({ hours: 3, source: 'manual', bucket: 'lt10' });
    expect(g.status).toBe('backlog');
    await setDurationOverride(t.db, TEST_USER, b.id, null);
    [g] = await getGamesByIds(t.db, TEST_USER, [b.id]);
    expect(g.duration).toMatchObject({ hours: 25, source: 'hltb', overrideHours: null });
  });

  it('ручной ввод у несуществующей игры = NotFoundError; CHECK не даёт 0', async () => {
    await expect(setDurationOverride(t.db, TEST_USER, 99999, 5)).rejects.toBeInstanceOf(NotFoundError);
    const [b] = await t.db.select({ id: games.id }).from(games);
    await expect(setDurationOverride(t.db, TEST_USER, b.id, 0)).rejects.toThrow();
  });
});
