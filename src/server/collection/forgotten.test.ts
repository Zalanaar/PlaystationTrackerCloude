// Фаза 15.5 «Забытые игры» (контракт 14.4): чистые функции, разбор параметра и GET /api/games на PGlite.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { setGameStatus } from '@/server/sync/status-rules';
import { createTestDb, type TestDb, TEST_USER } from '@/server/sync/test-helpers';
import { FORGOTTEN_DAYS, forgottenCutoff, isForgotten } from './forgotten';
import { listGames } from './query';
import { parseListQuery, type ListQuery } from './validation';

const NOW = new Date('2026-10-27T10:00:00Z');
const DAY = 86_400_000;
const ago = (days: number, ms = 0) => new Date(NOW.getTime() - days * DAY - ms);
const { games } = schema;

describe('isForgotten (чистая)', () => {
  const base = { status: null, playSeconds: 3600, lastPlayedAt: ago(100), hiddenAt: null };
  it('порог строго > 90 суток', () => {
    expect(FORGOTTEN_DAYS).toBe(90);
    expect(forgottenCutoff(NOW).toISOString()).toBe('2026-07-29T10:00:00.000Z');
    expect(isForgotten({ ...base, lastPlayedAt: ago(90) }, NOW)).toBe(false);
    expect(isForgotten({ ...base, lastPlayedAt: ago(90, 1) }, NOW)).toBe(true);
    expect(isForgotten({ ...base, lastPlayedAt: ago(90, 1).toISOString() }, NOW)).toBe(true);
  });
  it('со статусом, без часов, без даты, скрытая: не забытая', () => {
    expect(isForgotten(base, NOW)).toBe(true);
    expect(isForgotten({ ...base, status: 'backlog' }, NOW)).toBe(false);
    expect(isForgotten({ ...base, playSeconds: 0 }, NOW)).toBe(false);
    expect(isForgotten({ ...base, lastPlayedAt: null }, NOW)).toBe(false);
    expect(isForgotten({ ...base, hiddenAt: NOW }, NOW)).toBe(false);
  });
});

function lq(s = ''): ListQuery {
  const r = parseListQuery(new URLSearchParams(s));
  if (!r.ok) throw new Error(r.message);
  return r.value;
}

describe('parseListQuery: forgotten', () => {
  it('only / пусто / мусор', () => {
    expect(lq('forgotten=only').forgottenOnly).toBe(true);
    expect(lq('forgotten=').forgottenOnly).toBe(false);
    expect(parseListQuery(new URLSearchParams('forgotten=1')).ok).toBe(false);
  });
});

describe('GET /api/games ?forgotten=only (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  let n = 0;
  async function game(name: string, o: Partial<typeof games.$inferInsert> = {}) {
    n++;
    const [g] = await t.db.insert(games).values({ titleId: `CUSA${n}`, name, category: 'ps4_game', lastSeenAt: NOW, playDurationSeconds: 3600, ...o }).returning();
    return g.id;
  }

  it('фильтр, forgottenCount без учёта фильтров, counts не меняются, совпадает с isForgotten', async () => {
    await game('old1', { lastPlayedAt: ago(200) });
    await game('old2', { lastPlayedAt: ago(91), playDurationSeconds: 60 });
    await game('edge', { lastPlayedAt: ago(90) }); // ровно 90 суток: не забытая
    await game('fresh', { lastPlayedAt: ago(5) });
    await game('nohours', { lastPlayedAt: ago(200), playDurationSeconds: 0 });
    await game('nodate', { lastPlayedAt: null });
    await game('hidden', { lastPlayedAt: ago(200), hiddenAt: NOW });
    const st = await game('withstatus', { lastPlayedAt: ago(200) });
    await setGameStatus(t.db, TEST_USER, st, 'backlog', NOW);

    const r = await listGames(t.db, TEST_USER, lq('forgotten=only&status=none&sort=title'), NOW);
    expect(r.items.map((g) => g.title)).toEqual(['old1', 'old2']);
    expect(r.total).toBe(2);
    expect(r.forgottenCount).toBe(2);
    expect(r.items.every((g) => isForgotten(g, NOW))).toBe(true);

    const plain = await listGames(t.db, TEST_USER, lq('status=none&q=fresh'), NOW);
    expect(plain.items.map((g) => g.title)).toEqual(['fresh']);
    expect(plain.forgottenCount).toBe(2); // не зависит от q/status
    expect(plain.counts).toEqual((await listGames(t.db, TEST_USER, lq('q=fresh&forgotten=only'), NOW)).counts);

    expect((await listGames(t.db, TEST_USER, lq('forgotten=only&q=old1'), NOW)).items.map((g) => g.title)).toEqual(['old1']);
    expect((await listGames(t.db, TEST_USER, lq('forgotten=only&hidden=only'), NOW)).items).toEqual([]);
    expect((await listGames(t.db, TEST_USER, lq('forgotten=only&status=backlog'), NOW)).items).toEqual([]);
  });

  it('пустая БД: forgottenCount = 0', async () => {
    expect((await listGames(t.db, TEST_USER, lq(), NOW)).forgottenCount).toBe(0);
  });
});
