// П13.3: разбор цены, стоимость часа, сводка (выгодные/дорогие/лежат без дела), цена только у видимой игры, изоляция пользователей.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { schema } from '@/db';
import { asUserId } from '@/server/auth/user-id';
import { createTestDb, TEST_USER, TEST_USER_2, type TestDb } from '@/server/sync/test-helpers';
import { buildCostStats, getCostStats, getGamePrice, parsePrice, perHour, PriceError, setGamePrice } from './prices';

const { games } = schema;
const NOW = new Date('2026-11-16T21:00:00Z');
const U = asUserId(TEST_USER);
const U2 = asUserId(TEST_USER_2);

describe('цена и стоимость часа', () => {
  it('parsePrice', () => {
    expect(parsePrice(0)).toBe(0);
    expect(parsePrice(4999)).toBe(4999);
    expect(parsePrice(null)).toBeNull();
    for (const bad of [-1, 1.5, '100', 1_000_001, undefined, NaN]) expect(parsePrice(bad)).toBeUndefined();
  });
  it('perHour: меньше часа — null, до 10 ₽ — с десятыми', () => {
    expect(perHour(4000, 0.5)).toBeNull();
    expect(perHour(4000, 40)).toBe(100);
    expect(perHour(100, 30)).toBe(3.3);
    expect(perHour(0, 10)).toBe(0);
  });
  it('buildCostStats', () => {
    const s = buildCostStats([
      { id: 1, title: 'A', price: 4000, seconds: 100 * 3600 },
      { id: 2, title: 'B', price: 6000, seconds: 10 * 3600 },
      { id: 3, title: 'C', price: 0, seconds: 50 * 3600 },
      { id: 4, title: 'D', price: 3000, seconds: 600 },
      { id: 5, title: 'E', price: 2000, seconds: 5 * 3600 },
    ]);
    expect(s.priced).toBe(5);
    expect(s.total).toBe(15000);
    expect(s.hours).toBe(165.2);
    expect(s.perHour).toBe(91);
    expect(s.best.map((g) => g.id)).toEqual([3, 1, 5]);
    expect(s.worst.map((g) => g.id)).toEqual([2]);
    expect(s.idle).toEqual({ count: 1, total: 3000 });
    expect(buildCostStats([])).toMatchObject({ priced: 0, total: 0, perHour: null, best: [], worst: [], idle: { count: 0, total: 0 } });
  });
});

describe('цены (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.pg.execute(sql`insert into allowed_users (email, role, status) values ('m@example.com', 'member', 'active')`);
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  let n = 0;
  async function game(name: string, o: { hidden?: boolean; user?: number; seconds?: number; dupOf?: number } = {}) {
    n += 1;
    const [g] = await t.db.insert(games).values({
      userId: o.user ?? TEST_USER, titleId: `CUSA${n}_00`, name, category: 'ps4_game', lastSeenAt: NOW, hiddenAt: o.hidden ? NOW : null,
      playDurationSeconds: o.seconds ?? 0, duplicateOfGameId: o.dupOf ?? null,
    }).returning();
    return g.id;
  }

  it('поставить, заменить, убрать; скрытая и чужая — game_not_found', async () => {
    const a = await game('A');
    const h = await game('H', { hidden: true });
    const other = await game('O', { user: TEST_USER_2 });
    expect(await getGamePrice(t.db, U, a)).toEqual({ price: null });
    expect(await setGamePrice(t.db, U, a, 3999)).toEqual({ price: 3999 });
    expect(await setGamePrice(t.db, U, a, 1999)).toEqual({ price: 1999 });
    expect(await getGamePrice(t.db, U, a)).toEqual({ price: 1999 });
    expect(await setGamePrice(t.db, U, a, null)).toEqual({ price: null });
    expect(await getGamePrice(t.db, U, a)).toEqual({ price: null });
    await expect(setGamePrice(t.db, U, h, 100)).rejects.toBeInstanceOf(PriceError);
    await expect(setGamePrice(t.db, U, other, 100)).rejects.toBeInstanceOf(PriceError);
    await expect(getGamePrice(t.db, U2, a)).rejects.toBeInstanceOf(PriceError);
  });

  it('сводка: часы с дублями, скрытые не считаются, чужие не видны', async () => {
    const a = await game('A', { seconds: 30 * 3600 });
    await game('A dup', { seconds: 10 * 3600, dupOf: a });
    const b = await game('B', { seconds: 1800 });
    const h = await game('H', { seconds: 100 * 3600 });
    const o = await game('O', { user: TEST_USER_2, seconds: 10 * 3600 });
    await setGamePrice(t.db, U, a, 4000);
    await setGamePrice(t.db, U, b, 2500);
    await setGamePrice(t.db, U, h, 1000);
    await setGamePrice(t.db, U2, o, 500);
    await t.db.update(games).set({ hiddenAt: NOW }).where(sql`${games.id} = ${h}`);
    const s = await getCostStats(t.db, U);
    expect(s).toMatchObject({ priced: 2, total: 6500, hours: 40.5, perHour: 160, idle: { count: 1, total: 2500 } });
    expect(s.best).toEqual([{ id: a, title: 'A', price: 4000, hours: 40, perHour: 100 }]);
    expect((await getCostStats(t.db, U2)).total).toBe(500);
  });
});
