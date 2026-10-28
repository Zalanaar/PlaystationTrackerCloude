import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { eq } from 'drizzle-orm';
import { BulkMissingError, setGamesStatusBulk, setGameStatus, setStatusDate, StatusRuleError } from '@/server/sync/status-rules';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { getCollectionSummary, getGamesByIds, listGames } from './query';
import { parseListQuery, type ListQuery } from './validation';

const d = (s: string) => new Date(s);
const NOW = d('2026-10-27T10:00:00Z');
const { games, gameStatus, trophySets, gameTrophySets, trophies } = schema;

function lq(s = ''): ListQuery {
  const r = parseListQuery(new URLSearchParams(s));
  if (!r.ok) throw new Error(r.message);
  return r.value;
}

describe('коллекция (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  let n = 0;
  async function game(name: string, o: Partial<typeof games.$inferInsert> = {}) {
    n += 1;
    const [g] = await t.db
      .insert(games)
      .values({ titleId: `CUSA${n}_00`, name, category: 'ps4_game', lastSeenAt: NOW, ...o })
      .returning();
    return g.id;
  }
  async function trophySet(gameId: number | null, np: string, def: [number, number, number, number], earned: [number, number, number, number]) {
    const [s] = await t.db
      .insert(trophySets)
      .values({
        npCommunicationId: np, npServiceName: 'trophy', name: np,
        definedBronze: def[0], definedSilver: def[1], definedGold: def[2], definedPlatinum: def[3],
        earnedBronze: earned[0], earnedSilver: earned[1], earnedGold: earned[2], earnedPlatinum: earned[3],
      })
      .returning();
    if (gameId !== null) await t.db.insert(gameTrophySets).values({ gameId, trophySetId: s.id, source: 'title_id' });
    return s.id;
  }
  const names = async (qs = '') => (await listGames(t.db, lq(qs))).items.map((i) => i.title);

  it('пустая БД', async () => {
    const r = await listGames(t.db, lq());
    expect(r).toEqual({
      items: [], total: 0, limit: 60, offset: 0, years: [],
      counts: { all: 0, playing: 0, completed: 0, dropped: 0, backlog: 0, shelved: 0, service: 0, none: 0 },
    });
    const s = await getCollectionSummary(t.db);
    expect(s).toEqual({
      totals: { games: 0, playSeconds: 0, hours: 0, trophiesEarned: 0, platinumEarned: 0 },
      counts: r.counts, playing: [], services: [], continue: [],
    });
  });

  it('поля игры: платформа, часы, жанры, без сета и без last_played_at', async () => {
    const id = await game('Alpha', {
      category: 'ps5_native_game', imageUrl: 'http://img', playDurationSeconds: 5400, playCount: 3,
      psnGenres: ['SIMULATOR', 'UNIQUE', 'ACTION'],
    });
    await game('Beta', { category: 'pspc_game' });
    const [a] = await getGamesByIds(t.db, [id]);
    expect(a).toEqual({
      id, title: 'Alpha', coverUrl: 'http://img', platform: 'PS5', playSeconds: 5400, hours: 1.5, playCount: 3,
      lastPlayedAt: null, status: null, completedAt: null, droppedAt: null, trophies: null,
      genres: [{ key: 'SIMULATION', label: 'Симуляторы' }, { key: 'OTHER', label: 'Другое' }, { key: 'ACTION', label: 'Экшен' }],
      hiddenAt: null,
    });
    const beta = (await listGames(t.db, lq('q=beta'))).items[0];
    expect(beta.platform).toBe('PC');
    expect(beta.genres).toEqual([{ key: 'OTHER', label: 'Другое' }]);
  });

  it('трофеи суммируются по нескольким сетам одним запросом; сет с нулём определений = null', async () => {
    const id = await game('Multi');
    await trophySet(id, 'NPWR1', [10, 5, 2, 1], [10, 2, 0, 0]);
    await trophySet(id, 'NPWR2', [4, 0, 0, 0], [4, 0, 0, 0]);
    const empty = await game('EmptySet');
    await trophySet(empty, 'NPWR3', [0, 0, 0, 0], [0, 0, 0, 0]);
    const [m] = await getGamesByIds(t.db, [id]);
    expect(m.trophies).toEqual({
      earned: 16, defined: 22, progress: 73, platinumDefined: true, platinumEarned: false,
      byType: { platinum: { earned: 0, defined: 1 }, gold: { earned: 0, defined: 2 }, silver: { earned: 2, defined: 5 }, bronze: { earned: 14, defined: 14 } },
    });
    expect((await getGamesByIds(t.db, [empty]))[0].trophies).toBeNull();
  });

  it('поиск: регистр, кириллица, спецсимволы LIKE', async () => {
    await game('God of War');
    await game('Ведьмак 3');
    await game('100% Orange Juice');
    await game('A_B');
    await game('AxB');
    expect(await names('q=GOD%20OF')).toEqual(['God of War']);
    expect(await names(`q=${encodeURIComponent('ВЕДЬМАК')}`)).toEqual(['Ведьмак 3']);
    expect(await names(`q=${encodeURIComponent('100%')}`)).toEqual(['100% Orange Juice']);
    expect(await names('q=A_B')).toEqual(['A_B']);
    expect(await names('q=zzz')).toEqual([]);
  });

  it('фильтр статусов, none, несколько; counts не зависят от status, но зависят от q', async () => {
    const a = await game('A1');
    const b = await game('A2');
    const c = await game('B1');
    await game('B2');
    await setGameStatus(t.db, a, 'playing', NOW);
    await setGameStatus(t.db, b, 'backlog', NOW);
    await setGameStatus(t.db, c, 'playing', NOW);
    expect((await names('status=playing&sort=title'))).toEqual(['A1', 'B1']);
    expect((await names('status=none'))).toEqual(['B2']);
    expect((await names('status=none,backlog&sort=title'))).toEqual(['A2', 'B2']);
    const r = await listGames(t.db, lq('status=backlog&q=a'));
    expect(r.total).toBe(1);
    expect(r.counts).toEqual({ all: 2, playing: 1, completed: 0, dropped: 0, backlog: 1, shelved: 0, service: 0, none: 0 });
  });

  it('год: только completed_at > dropped_at, по Москве; без дат завершения не попадает', async () => {
    // 2025-12-31 22:00 UTC = 2026-01-01 01:00 МСК
    const done = await game('Done', { lastPlayedAt: d('2025-12-31T22:00:00Z') });
    const dropped = await game('Dropped', { lastPlayedAt: d('2023-03-03T10:00:00Z') });
    const playing = await game('Playing', { lastPlayedAt: d('2025-05-05T10:00:00Z') });
    await game('Never'); // last_played_at NULL
    await setGameStatus(t.db, done, 'completed', NOW);
    await setGameStatus(t.db, dropped, 'dropped', NOW);
    await setGameStatus(t.db, playing, 'playing', NOW);
    expect(await names('year=2026')).toEqual(['Done']);
    expect(await names('year=2023')).toEqual(['Dropped']);
    // playing с last_played_at в 2025 при year=2025 не виден
    expect(await names('year=2025')).toEqual([]);
    // ручная правка completed_at двигает игру между годами
    await setStatusDate(t.db, done, d('2025-06-01T00:00:00Z'), NOW, 'completedAt');
    expect(await names('year=2025')).toEqual(['Done']);
    expect(await names('year=2026')).toEqual([]);
    const r = await listGames(t.db, lq());
    expect(r.years).toEqual([2025, 2023]);
    expect(r.total).toBe(4);
  });

  it('years не зависят от фильтров; counts учитывают year', async () => {
    const x = await game('X', { lastPlayedAt: d('2026-02-02T10:00:00Z') });
    const y = await game('Y', { lastPlayedAt: d('2024-02-02T10:00:00Z') });
    await setGameStatus(t.db, x, 'completed', d('2026-02-02T10:00:00Z'));
    await setGameStatus(t.db, y, 'dropped', d('2024-02-02T10:00:00Z'));
    const r = await listGames(t.db, lq('year=2024&q=x'));
    expect(r.years).toEqual([2026, 2024]);
    expect(r.total).toBe(0);
    expect(r.counts.all).toBe(0);
  });

  it('сортировки: NULL всегда в конце, стабильный хвост, order', async () => {
    const mk = (name: string, h: number, last: string | null) => game(name, { playDurationSeconds: h * 3600, lastPlayedAt: last ? d(last) : null });
    await mk('b', 5, '2026-01-02T00:00:00Z');
    await mk('a', 5, '2026-01-03T00:00:00Z');
    await mk('c', 1, null);
    await mk('D', 9, '2026-01-01T00:00:00Z');
    expect(await names('sort=last_played')).toEqual(['a', 'b', 'D', 'c']);
    expect(await names('sort=last_played&order=asc')).toEqual(['D', 'b', 'a', 'c']);
    expect(await names('sort=hours')).toEqual(['D', 'a', 'b', 'c']);
    expect(await names('sort=hours&order=asc')).toEqual(['c', 'a', 'b', 'D']);
    expect(await names('sort=title')).toEqual(['a', 'b', 'c', 'D']);
    expect(await names('sort=title&order=desc')).toEqual(['D', 'c', 'b', 'a']);
  });

  it('сортировка по трофеям: без сета в конце при обоих направлениях', async () => {
    const hi = await game('hi');
    const lo = await game('lo');
    await game('none');
    const same = await game('same');
    await trophySet(hi, 'N1', [8, 0, 0, 2], [8, 0, 0, 1]); // 90%
    await trophySet(lo, 'N2', [10, 0, 0, 0], [2, 0, 0, 0]); // 20%
    await trophySet(same, 'N3', [100, 0, 0, 0], [20, 0, 0, 0]); // 20%, но earned больше
    expect(await names('sort=trophies_progress')).toEqual(['hi', 'same', 'lo', 'none']);
    expect(await names('sort=trophies_progress&order=asc')).toEqual(['lo', 'same', 'hi', 'none']);
  });

  it('сортировка по дате завершения: completed/dropped, остальные в конце', async () => {
    const a = await game('a', { lastPlayedAt: d('2026-01-01T00:00:00Z') });
    const b = await game('b', { lastPlayedAt: d('2026-03-01T00:00:00Z') });
    const c = await game('c', { lastPlayedAt: d('2026-02-01T00:00:00Z') });
    await game('d', { lastPlayedAt: d('2026-04-01T00:00:00Z') });
    await setGameStatus(t.db, a, 'completed', NOW);
    await setGameStatus(t.db, b, 'dropped', NOW);
    await setGameStatus(t.db, c, 'backlog', NOW);
    expect(await names('sort=completed_at')).toEqual(['b', 'a', 'c', 'd']);
    expect(await names('sort=completed_at&order=asc')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('limit/offset и total; offset за пределами', async () => {
    for (const x of ['a', 'b', 'c', 'd', 'e']) await game(x);
    const p1 = await listGames(t.db, lq('sort=title&limit=2'));
    expect(p1.items.map((i) => i.title)).toEqual(['a', 'b']);
    expect(p1.total).toBe(5);
    expect((await listGames(t.db, lq('sort=title&limit=2&offset=4'))).items.map((i) => i.title)).toEqual(['e']);
    const far = await listGames(t.db, lq('limit=2&offset=100'));
    expect(far.items).toEqual([]);
    expect(far.total).toBe(5);
  });

  it('service: фильтр, счётчик, секция главной, даты, статистика', async () => {
    const s1 = await game('svc-old', { playDurationSeconds: 3600, lastPlayedAt: d('2026-10-01T00:00:00Z') });
    const s2 = await game('svc-new', { playDurationSeconds: 7200, lastPlayedAt: d('2026-10-20T00:00:00Z') });
    const done = await game('done', { lastPlayedAt: d('2026-10-25T00:00:00Z') });
    await game('plain');
    await setGameStatus(t.db, s1, 'service', NOW);
    await setGameStatus(t.db, done, 'completed', NOW);
    await setGamesStatusBulk(t.db, [s2], 'completed', NOW);
    // completed -> service обнуляет дату; повтор ничего не трогает
    await setGamesStatusBulk(t.db, [s2], 'service', NOW);
    expect(await setGamesStatusBulk(t.db, [s2], 'service', NOW)).toBe(0);
    expect((await getGamesByIds(t.db, [s2]))[0]).toMatchObject({ status: 'service', completedAt: null, droppedAt: null });
    expect(await names('status=service&sort=last_played')).toEqual(['svc-new', 'svc-old']);
    expect((await listGames(t.db, lq('status=service'))).counts).toMatchObject({ service: 2, completed: 1, none: 1, all: 4 });
    const sum = await getCollectionSummary(t.db);
    expect(sum.services.map((g) => g.title)).toEqual(['svc-new', 'svc-old']);
    expect(sum.counts.service).toBe(2);
    expect(sum.playing).toEqual([]);
    // service -> dropped берёт дату запуска, -> null удаляет строку
    await setGameStatus(t.db, s1, 'dropped', NOW);
    expect((await getGamesByIds(t.db, [s1]))[0]).toMatchObject({ status: 'dropped', droppedAt: '2026-10-01T00:00:00.000Z' });
    await setGameStatus(t.db, s2, null, NOW);
    expect((await getGamesByIds(t.db, [s2]))[0].status).toBeNull();
    // дата у service править нельзя
    await setGameStatus(t.db, s2, 'service', NOW);
    await expect(setStatusDate(t.db, s2, d('2026-10-02T00:00:00Z'), NOW)).rejects.toMatchObject({ code: 'date_not_allowed', currentStatus: 'service' });
  });

  it('summary: итоги, playing, continue (правило)', async () => {
    const pl1 = await game('pl-old', { playDurationSeconds: 3600, lastPlayedAt: d('2026-10-01T00:00:00Z') });
    const pl2 = await game('pl-new', { playDurationSeconds: 7200, lastPlayedAt: d('2026-10-20T00:00:00Z') });
    const done = await game('done', { lastPlayedAt: d('2026-10-25T00:00:00Z') });
    const drop = await game('drop', { lastPlayedAt: d('2026-10-24T00:00:00Z') });
    const back = await game('back', { lastPlayedAt: d('2026-10-10T00:00:00Z') });
    const noStatus = await game('nostatus', { lastPlayedAt: d('2026-10-15T00:00:00Z') });
    await game('never');
    await setGameStatus(t.db, pl1, 'playing', NOW);
    await setGameStatus(t.db, pl2, 'playing', NOW);
    await setGameStatus(t.db, done, 'completed', NOW);
    await setGameStatus(t.db, drop, 'dropped', NOW);
    await setGameStatus(t.db, back, 'backlog', NOW);
    void noStatus;
    // трофеи: сет игры + сет-сирота (учитывается в totals)
    const s1 = await trophySet(pl1, 'S1', [1, 0, 0, 1], [1, 0, 0, 1]);
    const s2 = await trophySet(null, 'S2', [1, 0, 0, 0], [1, 0, 0, 0]);
    await t.db.insert(trophies).values([
      { trophySetId: s1, trophyId: 0, type: 'platinum', earned: true, earnedAt: NOW },
      { trophySetId: s1, trophyId: 1, type: 'bronze', earned: true, earnedAt: NOW },
      { trophySetId: s1, trophyId: 2, type: 'bronze', earned: false },
      { trophySetId: s2, trophyId: 0, type: 'bronze', earned: true, earnedAt: NOW },
    ]);
    const s = await getCollectionSummary(t.db);
    expect(s.totals).toEqual({ games: 7, playSeconds: 10800, hours: 3, trophiesEarned: 3, platinumEarned: 1 });
    expect(s.counts).toEqual({ all: 7, playing: 2, completed: 1, dropped: 1, backlog: 1, shelved: 0, service: 0, none: 2 });
    expect(s.playing.map((g) => g.title)).toEqual(['pl-new', 'pl-old']);
    expect(s.playing[1].trophies?.platinumEarned).toBe(true);
    // continue: нет completed/dropped и нет игр без last_played_at; по убыванию запуска
    expect(s.continue.map((g) => g.title)).toEqual(['pl-new', 'nostatus', 'back', 'pl-old']);
  });

  it('continue: максимум 8', async () => {
    for (let i = 1; i <= 11; i++) await game(`g${i}`, { lastPlayedAt: d(`2026-10-${String(i).padStart(2, '0')}T00:00:00Z`) });
    const s = await getCollectionSummary(t.db);
    expect(s.continue).toHaveLength(8);
    expect(s.continue[0].title).toBe('g11');
  });

  it('игра с одним статусом и без last_played_at: completed берёт now', async () => {
    const id = await game('NoLast');
    await setGameStatus(t.db, id, 'completed', NOW);
    const [g] = await getGamesByIds(t.db, [id]);
    expect(g).toMatchObject({ status: 'completed', completedAt: NOW.toISOString(), lastPlayedAt: null });
  });

  describe('setStatusDate с проверкой поля и будущего', () => {
    it('несоответствие поля = date_not_allowed со статусом; будущее = date_in_future; нет игры = not_found', async () => {
      const id = await game('G', { lastPlayedAt: d('2026-10-01T00:00:00Z') });
      await expect(setStatusDate(t.db, id, d('2026-01-01T00:00:00Z'), NOW, 'completedAt')).rejects.toMatchObject({ code: 'date_not_allowed', currentStatus: null });
      await setGameStatus(t.db, id, 'dropped', NOW);
      await expect(setStatusDate(t.db, id, d('2026-01-01T00:00:00Z'), NOW, 'completedAt')).rejects.toMatchObject({ code: 'date_not_allowed', currentStatus: 'dropped' });
      await expect(setStatusDate(t.db, id, d('2026-10-28T00:00:00Z'), NOW, 'droppedAt')).rejects.toMatchObject({ code: 'date_in_future' });
      await setStatusDate(t.db, id, NOW, NOW, 'droppedAt'); // ровно now допустимо
      const row = (await t.db.select().from(gameStatus).where(eq(gameStatus.gameId, id)))[0];
      expect(row.droppedAt).toEqual(NOW);
      await expect(setStatusDate(t.db, 99999, NOW, NOW, 'droppedAt')).rejects.toBeInstanceOf(StatusRuleError);
    });
  });

  describe('массовая смена статуса', () => {
    it('меняет пачку, считает changed, правила дат как у одиночной', async () => {
      const a = await game('a', { lastPlayedAt: d('2026-10-01T00:00:00Z') });
      const b = await game('b', { lastPlayedAt: d('2026-10-02T00:00:00Z') });
      const c = await game('c');
      await setGameStatus(t.db, b, 'completed', NOW);
      const changed = await setGamesStatusBulk(t.db, [a, b, c], 'completed', NOW);
      expect(changed).toBe(2); // b уже completed
      const rows = await getGamesByIds(t.db, [a, b, c]);
      expect(rows.map((r) => [r.status, r.completedAt])).toEqual([
        ['completed', '2026-10-01T00:00:00.000Z'],
        ['completed', '2026-10-02T00:00:00.000Z'],
        ['completed', NOW.toISOString()],
      ]);
      // переход на другой статус обнуляет даты; повтор идемпотентен
      expect(await setGamesStatusBulk(t.db, [a, b, c], 'backlog', NOW)).toBe(3);
      expect(await setGamesStatusBulk(t.db, [a, b, c], 'backlog', NOW)).toBe(0);
      expect((await getGamesByIds(t.db, [a, b, c])).every((r) => r.status === 'backlog' && r.completedAt === null)).toBe(true);
      // сброс
      expect(await setGamesStatusBulk(t.db, [a, c], null, NOW)).toBe(2);
      expect(await setGamesStatusBulk(t.db, [a, c], null, NOW)).toBe(0);
      expect((await getGamesByIds(t.db, [a, b, c])).map((r) => r.status)).toEqual([null, 'backlog', null]);
    });

    it('несуществующий id: ничего не изменено, missingIds', async () => {
      const a = await game('a');
      const err = await setGamesStatusBulk(t.db, [a, 9998, 9999], 'playing', NOW).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BulkMissingError);
      expect((err as BulkMissingError).missingIds).toEqual([9998, 9999]);
      expect((await getGamesByIds(t.db, [a]))[0].status).toBeNull();
    });

    it('250 id за один вызов', async () => {
      const ids: number[] = [];
      await t.db.insert(games).values(Array.from({ length: 250 }, (_, i) => ({ titleId: `BULK${i}`, name: `g${i}`, category: 'ps4_game', lastSeenAt: NOW })));
      for (const r of await t.db.select({ id: games.id }).from(games)) ids.push(r.id);
      expect(await setGamesStatusBulk(t.db, ids, 'shelved', NOW)).toBe(250);
      expect((await listGames(t.db, lq('status=shelved&limit=300'))).total).toBe(250);
    });
  });
});
