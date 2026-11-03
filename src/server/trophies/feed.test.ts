// F3 «Лента трофеев»: разбор запроса, курсор, границы периода, keyset без дублей и пропусков, сводка, изоляция, сервисы, скрытые.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { schema } from '@/db';
import { createTestDb, type TestDb, TEST_USER, TEST_USER_2 } from '@/server/sync/test-helpers';
import { decodeCursor, encodeCursor, parseFeedQuery, periodSince, type FeedQuery } from './feed';
import { getTrophyFeed } from './feed-query';

const { games, gameStatus, trophySets, gameTrophySets, trophies } = schema;
const NOW = new Date('2026-11-03T10:00:00Z');
const q = (o: Partial<FeedQuery> = {}): FeedQuery => ({ period: '7d', rare: false, cursor: null, limit: 50, ...o });

describe('parseFeedQuery и курсор', () => {
  it('значения по умолчанию и ошибки', () => {
    expect(parseFeedQuery(new URLSearchParams(''))).toEqual({ ok: true, value: { period: '7d', rare: false, cursor: null, limit: 50 } });
    expect(parseFeedQuery(new URLSearchParams('period=year')).ok).toBe(false);
    expect(parseFeedQuery(new URLSearchParams('rare=yes')).ok).toBe(false);
    expect(parseFeedQuery(new URLSearchParams('limit=0')).ok).toBe(false);
    expect(parseFeedQuery(new URLSearchParams('limit=101')).ok).toBe(false);
    expect(parseFeedQuery(new URLSearchParams('cursor=abc')).ok).toBe(false);
    const v = parseFeedQuery(new URLSearchParams('period=all&rare=1&cursor=n_12&limit=10'));
    expect(v).toEqual({ ok: true, value: { period: 'all', rare: true, cursor: { at: null, id: 12 }, limit: 10 } });
  });
  it('курсор туда и обратно', () => {
    expect(decodeCursor(encodeCursor({ at: 1793707404346, id: 5 }))).toEqual({ at: 1793707404346, id: 5 });
    expect(decodeCursor(encodeCursor({ at: null, id: 7 }))).toEqual({ at: null, id: 7 });
    expect(decodeCursor('1_0')).toBeNull();
  });
  it('границы периода: 7×24 ч и 30×24 ч, «Все» без границы', () => {
    expect(periodSince('7d', NOW)?.toISOString()).toBe('2026-10-27T10:00:00.000Z');
    expect(periodSince('month', NOW)?.toISOString()).toBe('2026-10-04T10:00:00.000Z');
    expect(periodSince('all', NOW)).toBeNull();
  });
});

describe('getTrophyFeed', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.pg.execute(sql`insert into allowed_users (email, role, status) values ('m@example.com', 'member', 'active')`);
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  let n = 0;
  async function game(user = 1, opts: { status?: 'service' | 'completed'; hidden?: boolean } = {}) {
    n++;
    const [g] = await t.db.insert(games).values({ userId: user, titleId: `CUSA${n}`, name: `G${n}`, category: 'ps5_native_game', lastSeenAt: NOW, hiddenAt: opts.hidden ? NOW : null }).returning();
    if (opts.status) await t.db.insert(gameStatus).values({ userId: user, gameId: g.id, status: opts.status });
    return g.id;
  }
  async function set(gameIds: number[], user = 1) {
    n++;
    const [s] = await t.db.insert(trophySets).values({ userId: user, npCommunicationId: `NPWR${n}`, npServiceName: 'trophy2', name: `S${n}` }).returning();
    for (const id of gameIds) await t.db.insert(gameTrophySets).values({ userId: user, gameId: id, trophySetId: s.id, source: 'title_id' });
    return s.id;
  }
  let tid = 0;
  async function trophy(setId: number, at: string | null, o: { type?: 'platinum' | 'gold' | 'silver' | 'bronze'; rate?: string; user?: number; earned?: boolean } = {}) {
    tid++;
    await t.db.insert(trophies).values({
      userId: o.user ?? 1, trophySetId: setId, trophyId: tid, type: o.type ?? 'bronze', name: `T${tid}`,
      earned: o.earned ?? true, earnedAt: at ? new Date(at) : null, earnedRate: o.rate ?? '50.00',
    });
    return `T${tid}`;
  }
  const names = (r: { items: { name: string | null }[] }) => r.items.map((x) => x.name);

  it('7 дней: только окно, свежие сверху, день по МСК, сводка по типам', async () => {
    const s = await set([await game()]);
    const a = await trophy(s, '2026-11-02T21:30:00Z', { type: 'gold' }); // МСК 3 ноя 00:30
    const b = await trophy(s, '2026-11-02T20:30:00Z'); // МСК 2 ноя 23:30
    await trophy(s, '2026-10-27T09:00:00Z'); // за окном
    await trophy(s, null);
    await trophy(s, null, { earned: false });
    const r = await getTrophyFeed(t.db, TEST_USER, q(), NOW);
    expect(names(r)).toEqual([a, b]);
    expect(r.items.map((i) => i.day)).toEqual(['2026-11-03', '2026-11-02']);
    expect(r.today).toBe('2026-11-03');
    expect(r.summary).toEqual({ total: 2, platinum: 0, gold: 1, silver: 0, bronze: 1 });
    expect(r.items[0].game).toEqual({ id: expect.any(Number), title: expect.stringMatching(/^G/) });
  });

  it('«Все»: трофеи без даты в конце; keyset без дублей и пропусков', async () => {
    const s = await set([await game()]);
    const all: string[] = [];
    for (let i = 0; i < 7; i++) all.push(await trophy(s, `2026-0${1 + (i % 3)}-15T10:00:00Z`));
    all.push(await trophy(s, null));
    all.push(await trophy(s, null));
    const seen: string[] = [];
    let cursor: FeedQuery['cursor'] = null;
    let pages = 0;
    for (;;) {
      const r = await getTrophyFeed(t.db, TEST_USER, q({ period: 'all', limit: 2, cursor }), NOW);
      seen.push(...(names(r) as string[]));
      pages++;
      if (!r.nextCursor) break;
      cursor = decodeCursor(r.nextCursor);
    }
    expect(pages).toBe(5);
    expect(new Set(seen).size).toBe(9);
    expect(seen.slice(-2).sort()).toEqual(all.slice(-2).sort());
    const first = await getTrophyFeed(t.db, TEST_USER, q({ period: 'all' }), NOW);
    expect(first.summary.total).toBe(9);
  });

  it('«Только редкие» = earned_rate < 5 %', async () => {
    const s = await set([await game()]);
    const r1 = await trophy(s, '2026-11-01T10:00:00Z', { rate: '4.99' });
    await trophy(s, '2026-11-01T11:00:00Z', { rate: '5.00' });
    const r = await getTrophyFeed(t.db, TEST_USER, q({ rare: true }), NOW);
    expect(names(r)).toEqual([r1]);
    expect(r.summary.total).toBe(1);
  });

  it('игры-сервисы входят; сет только скрытой игры не входит; сирота входит без игры', async () => {
    const svc = await set([await game(1, { status: 'service' })]);
    const hid = await set([await game(1, { hidden: true })]);
    const orphan = await set([]);
    const a = await trophy(svc, '2026-11-01T10:00:00Z');
    await trophy(hid, '2026-11-01T11:00:00Z');
    const c = await trophy(orphan, '2026-11-01T12:00:00Z');
    const r = await getTrophyFeed(t.db, TEST_USER, q(), NOW);
    expect(names(r)).toEqual([c, a]);
    expect(r.items[0].game).toBeNull();
  });

  it('изоляция: чужие трофеи не видны', async () => {
    const mine = await set([await game()]);
    const other = await set([await game(2)], 2);
    const a = await trophy(mine, '2026-11-01T10:00:00Z');
    await trophy(other, '2026-11-01T11:00:00Z', { user: 2 });
    expect(names(await getTrophyFeed(t.db, TEST_USER, q(), NOW))).toEqual([a]);
    expect((await getTrophyFeed(t.db, TEST_USER_2, q(), NOW)).items).toHaveLength(1);
  });
});
