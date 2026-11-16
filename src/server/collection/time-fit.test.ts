// П12.5: остаток минут, «Успеешь пройти» (запас 15%, сначала «Играю», затем больший остаток), «Продолжить» (остальные «Играю» по давности),
// лимиты; PGlite: скрытые, дубли (их часы идут в главную), чужие игры и прочие статусы не попадают.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { schema } from '@/db';
import { asUserId } from '@/server/auth/user-id';
import { createTestDb, TEST_USER, TEST_USER_2, type TestDb } from '@/server/sync/test-helpers';
import { getTimeFit, parseMinutes, pickTimeFit, remainingMinutes, type TimeFitRow } from './time-fit';

const { games, gameStatus } = schema;
const NOW = new Date('2026-11-16T21:00:00Z');
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe('чистые функции', () => {
  it('parseMinutes', () => {
    expect([null, '', '60', '15', '600', '14', '601', 'x', '1.5'].map(parseMinutes)).toEqual([120, 120, 60, 15, 600, null, null, null, null]);
  });
  it('remainingMinutes', () => {
    expect(remainingMinutes(null, 0)).toBeNull();
    expect(remainingMinutes(0, 0)).toBeNull();
    expect(remainingMinutes(2, 1800)).toBe(90);
    expect(remainingMinutes(2, 7200)).toBeNull(); // переиграно
  });
  it('выбор и порядок', () => {
    const r = (id: number, status: 'playing' | 'backlog', hours: number | null, playSeconds = 0, last: number | null = null): TimeFitRow => ({ id, title: `G${id}`, coverUrl: null, status, hours, playSeconds, lastPlayedAt: last === null ? null : ago(last) });
    const out = pickTimeFit([
      r(1, 'backlog', 1.5), // 90 — влезает
      r(2, 'playing', 10, 9 * 3600, 5), // 60 — влезает, «Играю» первым
      r(3, 'backlog', 2.3), // 138 ≤ 138 (запас 15%) — влезает
      r(4, 'backlog', 2.4), // 144 — нет
      r(5, 'playing', 30, 0, 1), // не влезает → продолжить (свежая)
      r(6, 'playing', null, 0, 48), // неизвестно → продолжить
      r(7, 'playing', 1, 7200, 2), // переиграна → продолжить
    ], 120);
    expect(out.finish.map((i) => i.id)).toEqual([2, 3, 1]);
    expect(out.finish[0].remainingMinutes).toBe(60);
    expect(out.resume.map((i) => i.id)).toEqual([5, 7, 6]);
  });
  it('лимиты 5 и 3', () => {
    const rows: TimeFitRow[] = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, title: `G${i}`, coverUrl: null, status: i < 6 ? 'backlog' : 'playing', hours: i < 6 ? 1 : 100, playSeconds: 0, lastPlayedAt: ago(i) }));
    const out = pickTimeFit(rows, 120);
    expect(out.finish).toHaveLength(5);
    expect(out.resume).toHaveLength(3);
  });
});

describe('getTimeFit (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.pg.execute(sql`insert into allowed_users (email, role, status) values ('m@example.com', 'member', 'active')`);
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  let n = 0;
  async function game(name: string, status: 'backlog' | 'playing' | 'completed', o: { hours?: number; override?: number; played?: number; hidden?: boolean; user?: number; dupOf?: number } = {}) {
    n += 1;
    const userId = o.user ?? TEST_USER;
    const [g] = await t.db.insert(games).values({
      userId, titleId: `CUSA${n}_00`, name, category: 'ps4_game', lastSeenAt: NOW, lastPlayedAt: ago(n),
      hltbMainHours: o.hours ?? null, durationOverrideHours: o.override ?? null, playDurationSeconds: o.played ?? 0,
      hiddenAt: o.hidden ? NOW : null, duplicateOfGameId: o.dupOf ?? null,
    }).returning();
    if (!o.dupOf) await t.db.insert(gameStatus).values({ userId, gameId: g.id, status, statusChangedAt: NOW });
    return g.id;
  }

  it('отбор и остаток с часами дублей', async () => {
    const a = await game('Alpha', 'backlog', { hours: 1.5 });
    const b = await game('Beta', 'playing', { hours: 10, played: 8 * 3600 });
    await game('Beta PS5', 'playing', { played: 3600, dupOf: b }); // +1 ч к Beta → остаток 60
    const c = await game('Gamma', 'backlog', { hours: 50, override: 2 }); // ручная приоритетнее
    const d = await game('Delta', 'playing', { hours: 80 });
    await game('Done', 'completed', { hours: 1 });
    await game('Hidden', 'backlog', { hours: 1, hidden: true });
    await game('Other', 'backlog', { hours: 1, user: TEST_USER_2 });
    const r = await getTimeFit(t.db, asUserId(TEST_USER), 120);
    expect(r.finish.map((i) => [i.id, i.remainingMinutes])).toEqual([[b, 60], [c, 120], [a, 90]]);
    expect(r.resume.map((i) => i.id)).toEqual([d]);
  });
});
