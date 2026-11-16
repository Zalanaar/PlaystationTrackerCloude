// П11.1 «Дневник дня»: разбор даты, игры дня по дельтам снимков (дубль → главная, скрытые нет), трофеи дня МСК, завершения, соседи, изоляция.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { schema } from '@/db';
import { createTestDb, type TestDb, TEST_USER, TEST_USER_2 } from '@/server/sync/test-helpers';
import { parseDayDate, secondsToMinutes } from './day';
import { getDay } from './day-query';

const { games, gameStatus, playtimeSnapshots, trophySets, gameTrophySets, trophies } = schema;
const NOW = new Date('2026-11-10T10:00:00Z'); // сегодня 10 ноября МСК

describe('parseDayDate', () => {
  it('реальные даты 2000..2100, остальное null', () => {
    expect(parseDayDate('2026-11-10')).toBe('2026-11-10');
    expect(parseDayDate('2024-02-29')).toBe('2024-02-29');
    for (const bad of [null, '', '2025-02-29', '2026-13-01', '2026-00-10', '2026-11-31', '1999-12-31', '2026-1-1', '2026-11-10T00:00', 'x']) expect(parseDayDate(bad)).toBeNull();
  });
  it('минуты: округление, минимум 1 при игре', () => {
    expect(secondsToMinutes(0)).toBe(0);
    expect(secondsToMinutes(10)).toBe(1);
    expect(secondsToMinutes(5430)).toBe(91);
  });
});

describe('getDay на PGlite', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.pg.execute(sql`insert into allowed_users (email, role, status) values ('m@example.com', 'member', 'active')`);
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  let n = 0;
  async function game(o: { user?: number; hidden?: boolean; dupOf?: number; name?: string } = {}) {
    n++;
    const [g] = await t.db.insert(games).values({
      userId: o.user ?? 1, titleId: `CUSA${n}`, name: o.name ?? `G${n}`, category: 'ps5_native_game', lastSeenAt: NOW,
      hiddenAt: o.hidden ? NOW : null, duplicateOfGameId: o.dupOf ?? null,
    }).returning();
    return g.id;
  }
  const snaps = (gameId: number, m: Record<string, number>, user = 1) =>
    t.db.insert(playtimeSnapshots).values(Object.entries(m).map(([d, s]) => ({ userId: user, gameId, snapshotDate: d, playDurationSeconds: s })));

  it('игры дня: дельта к предыдущему снимку, дубль к главной, скрытые и чужие не видны, первый снимок не в счёт', async () => {
    const a = await game({ name: 'Астро' });
    const b = await game({ name: 'Бета' });
    const dup = await game({ dupOf: b });
    const h = await game({ hidden: true });
    const fresh = await game({ name: 'Новая' });
    const other = await game({ user: 2 });
    await snaps(a, { '2026-11-01': 1000, '2026-11-03': 4600, '2026-11-05': 4600, '2026-11-07': 4700 });
    await snaps(b, { '2026-11-02': 0, '2026-11-03': 600 });
    await snaps(dup, { '2026-11-02': 100, '2026-11-03': 1300 });
    await snaps(h, { '2026-11-02': 0, '2026-11-03': 9000 });
    await snaps(fresh, { '2026-11-03': 5000 }); // первый снимок: дельты нет
    await snaps(other, { '2026-11-02': 0, '2026-11-03': 9000 }, 2);

    const d = await getDay(t.db, TEST_USER, '2026-11-03', NOW);
    expect(d.known).toBe(true);
    expect(d.games.map((g) => [g.title, g.minutes])).toEqual([['Астро', 60], ['Бета', 30]]);
    expect(d.games[1].id).toBe(b);
    expect(d.minutes).toBe(90);
    expect(d.today).toBe('2026-11-10');
    // соседние игровые дни: 05.11 без игры (дельта 0), 07.11 — 2 минуты
    expect(d.prev).toBeNull();
    expect(d.next).toBe('2026-11-07');
    const d7 = await getDay(t.db, TEST_USER, '2026-11-07', NOW);
    expect(d7.prev).toBe('2026-11-03');
    expect(d7.next).toBeNull();
    const d5 = await getDay(t.db, TEST_USER, '2026-11-05', NOW);
    expect(d5.known).toBe(true);
    expect(d5.games).toEqual([]);
    const d4 = await getDay(t.db, TEST_USER, '2026-11-04', NOW);
    expect(d4.known).toBe(false);
    // второй пользователь видит только своё
    const o = await getDay(t.db, TEST_USER_2, '2026-11-03', NOW);
    expect(o.games.map((g) => g.minutes)).toEqual([150]);
    expect(o.prev).toBeNull();
  });

  it('будущий день: пусто, next не дальше сегодня', async () => {
    const a = await game();
    await snaps(a, { '2026-11-01': 0, '2026-11-02': 600 });
    const d = await getDay(t.db, TEST_USER, '2026-11-12', NOW);
    expect(d.known).toBe(false);
    expect(d.games).toEqual([]);
    expect(d.prev).toBe('2026-11-02');
    expect(d.next).toBeNull();
  });

  it('трофеи дня по МСК: границы суток, порядок по типу, сирота, скрытый сет не в счёт', async () => {
    const g = await game({ name: 'Игра' });
    const [s] = await t.db.insert(trophySets).values({ userId: 1, npCommunicationId: 'NPWR1', npServiceName: 'trophy2', name: 'Сет' }).returning();
    await t.db.insert(gameTrophySets).values({ userId: 1, gameId: g, trophySetId: s.id, source: 'title_id' });
    const [orphan] = await t.db.insert(trophySets).values({ userId: 1, npCommunicationId: 'NPWR2', npServiceName: 'trophy2', name: 'Сирота' }).returning();
    const hg = await game({ hidden: true });
    const [hs] = await t.db.insert(trophySets).values({ userId: 1, npCommunicationId: 'NPWR3', npServiceName: 'trophy2', name: 'Скрытый' }).returning();
    await t.db.insert(gameTrophySets).values({ userId: 1, gameId: hg, trophySetId: hs.id, source: 'title_id' });
    let id = 0;
    const tr = (setId: number, at: string, type: 'platinum' | 'gold' | 'silver' | 'bronze' = 'bronze') =>
      t.db.insert(trophies).values({ userId: 1, trophySetId: setId, trophyId: ++id, type, name: `T${id}`, earned: true, earnedAt: new Date(at) });
    await tr(s.id, '2026-11-02T21:00:00Z'); // 03.11 00:00 МСК — входит
    await tr(s.id, '2026-11-03T20:59:59Z', 'platinum'); // 03.11 23:59:59 МСК — входит
    await tr(s.id, '2026-11-03T21:00:00Z'); // 04.11 — нет
    await tr(s.id, '2026-11-02T20:59:59Z'); // 02.11 — нет
    await tr(orphan.id, '2026-11-03T10:00:00Z', 'gold');
    await tr(hs.id, '2026-11-03T10:00:00Z', 'gold');
    const d = await getDay(t.db, TEST_USER, '2026-11-03', NOW);
    expect(d.trophies.counts).toEqual({ platinum: 1, gold: 1, silver: 0, bronze: 1, total: 3 });
    expect(d.trophies.items.map((x) => [x.name, x.type, x.game?.title ?? null])).toEqual([['T2', 'platinum', 'Игра'], ['T5', 'gold', null], ['T1', 'bronze', 'Игра']]);
  });

  it('завершения дня по МСК, скрытые и дубли не видны', async () => {
    const a = await game({ name: 'Пройдена' });
    const b = await game({ name: 'Брошена' });
    const c = await game({ name: 'Вчера' });
    const h = await game({ hidden: true });
    await t.db.insert(gameStatus).values([
      { userId: 1, gameId: a, status: 'completed', completedAt: new Date('2026-11-03T20:00:00Z') },
      { userId: 1, gameId: b, status: 'dropped', droppedAt: new Date('2026-11-02T21:30:00Z') },
      { userId: 1, gameId: c, status: 'completed', completedAt: new Date('2026-11-02T20:30:00Z') },
      { userId: 1, gameId: h, status: 'completed', completedAt: new Date('2026-11-03T10:00:00Z') },
    ]);
    const d = await getDay(t.db, TEST_USER, '2026-11-03', NOW);
    expect(d.finished.map((f) => [f.title, f.kind])).toEqual([['Брошена', 'dropped'], ['Пройдена', 'completed']]);
  });
});
