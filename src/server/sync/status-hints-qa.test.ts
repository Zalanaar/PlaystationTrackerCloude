// QA Фазы 27: границы порогов; QA-27-1 (откат «Принять» восстанавливает строку статуса) и QA-27-3 (конфликт) на PGlite.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { schema } from '@/db';
import { resetTestSession, testSession } from '@/server/auth/test-require-user';
import { matchingRules, type HintFacts } from './status-hints';
import { createTestDb, TEST_USER, TEST_USER_2, type TestDb } from './test-helpers';
import { computeStatusHints } from './status-hints-db';

const holder: { db: TestDb['db'] | null } = { db: null };
vi.mock('@/db', async (orig) => ({
  ...(await orig<typeof import('@/db')>()),
  getDb: () => {
    if (!holder.db) throw new Error('no db');
    return holder.db;
  },
}));
vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);
import { PUT as statusPut } from '@/app/api/games/[id]/status/route';

const NOW = new Date('2026-11-01T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const facts = (o: Partial<HintFacts> = {}): HintFacts => ({
  gameId: 1, status: null, statusChangedAt: null, droppedAt: null, lastPlayedAt: null, playSeconds: 3600, platinumEarned: false, platinumEarnedAt: null, ...o,
});

describe('QA-27: пороги', () => {
  it('14 суток ровно: started и returned есть, 14 суток и 1 мс: нет', () => {
    const edge = new Date(NOW.getTime() - 14 * 86_400_000);
    const over = new Date(edge.getTime() - 1);
    expect(matchingRules(facts({ status: null, lastPlayedAt: edge }), NOW)).toEqual(['started']);
    expect(matchingRules(facts({ status: null, lastPlayedAt: over }), NOW)).toEqual([]);
    expect(matchingRules(facts({ status: 'dropped', droppedAt: daysAgo(40), statusChangedAt: daysAgo(40), lastPlayedAt: edge }), NOW)).toEqual(['returned']);
    expect(matchingRules(facts({ status: 'dropped', droppedAt: daysAgo(40), statusChangedAt: daysAgo(40), lastPlayedAt: over }), NOW)).toEqual([]);
  });
  it('service и completed не получают никаких подсказок даже с платиной и свежим запуском', () => {
    expect(matchingRules(facts({ status: 'service', platinumEarned: true, lastPlayedAt: daysAgo(1) }), NOW)).toEqual([]);
    expect(matchingRules(facts({ status: 'completed', platinumEarned: true, statusChangedAt: daysAgo(90), lastPlayedAt: daysAgo(1) }), NOW)).toEqual([]);
  });
  it('shelved с платиной: «Пройдено?», с поздним статусом: нет', () => {
    expect(matchingRules(facts({ status: 'shelved', platinumEarned: true, platinumEarnedAt: daysAgo(10), statusChangedAt: daysAgo(20) }), NOW)).toEqual(['platinum']);
    expect(matchingRules(facts({ status: 'shelved', platinumEarned: true, platinumEarnedAt: daysAgo(10), statusChangedAt: daysAgo(5) }), NOW)).toEqual([]);
  });
  it('граница МСК/UTC: сутки считаются от момента, не от календарной даты', () => {
    const lp = new Date('2026-10-18T21:30:00Z'); // 19.10 00:30 МСК, 13.6 суток до NOW
    expect(matchingRules(facts({ status: null, lastPlayedAt: lp }), NOW)).toEqual(['started']);
  });
});

describe('QA-27-1 / QA-27-3: откат и конфликт (PUT статуса, контракт 28.9)', () => {
  let t: TestDb;
  const { games, gameStatus, allowedUsers } = schema;
  beforeAll(async () => {
    t = await createTestDb();
    holder.db = t.db;
    await t.db.insert(allowedUsers).values({ email: 'b@example.com', role: 'member', status: 'active' });
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    resetTestSession();
  });

  const put = (id: number, body: unknown) =>
    statusPut(new Request(`http://x/api/games/${id}/status`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: String(id) }) });
  const hintRules = async (u: typeof TEST_USER) => (await computeStatusHints(t.db, u, NOW)).map((h) => `${h.gameId}:${h.rule}`);
  const row = async (u: typeof TEST_USER, id: number) => (await t.db.select().from(gameStatus).where(and(eq(gameStatus.gameId, id), eq(gameStatus.userId, u))))[0];
  async function droppedGame(u: typeof TEST_USER) {
    const [g] = await t.db.insert(games).values({ userId: u, titleId: 'CUSA1', name: 'G', category: 'ps5_native_game', lastSeenAt: NOW, playDurationSeconds: 7200, lastPlayedAt: daysAgo(3) }).returning({ id: games.id });
    // ручная дата отличается от последнего запуска
    await t.db.insert(gameStatus).values({ userId: u, gameId: g.id, status: 'dropped', statusChangedAt: daysAgo(60), droppedAt: daysAgo(55) });
    return g.id;
  }

  it('«Принять» + откат через restore: статус и даты как были, подсказка returned возвращается', async () => {
    const id = await droppedGame(TEST_USER);
    const before = await row(TEST_USER, id);
    expect(await hintRules(TEST_USER)).toEqual([`${id}:returned`]);
    expect((await put(id, { status: 'playing', expectedStatus: 'dropped' })).status).toBe(200);
    expect(await hintRules(TEST_USER)).toEqual([]);
    const res = await put(id, {
      status: 'dropped',
      expectedStatus: 'playing',
      restore: { status: 'dropped', statusChangedAt: before.statusChangedAt.toISOString(), completedAt: null, droppedAt: before.droppedAt!.toISOString() },
    });
    expect(res.status).toBe(200);
    const after = await row(TEST_USER, id);
    expect(after.status).toBe('dropped');
    expect(after.statusChangedAt).toEqual(before.statusChangedAt);
    expect(after.droppedAt).toEqual(before.droppedAt);
    expect(after.completedAt).toBeNull();
    expect(await hintRules(TEST_USER)).toEqual([`${id}:returned`]);
  });

  it('без restore обычный PUT прошлого статуса по-прежнему сдвигает даты (поведение 9.4 не менялось)', async () => {
    const id = await droppedGame(TEST_USER);
    const before = await row(TEST_USER, id);
    await put(id, { status: 'playing' });
    await put(id, { status: 'dropped' });
    const after = await row(TEST_USER, id);
    expect(after.statusChangedAt.getTime()).toBeGreaterThan(before.statusChangedAt.getTime());
    expect(after.droppedAt).toEqual(daysAgo(3));
  });

  it('expectedStatus: несовпадение = 409 status_conflict с текущим статусом, запись не выполнена; null = «без статуса»', async () => {
    const id = await droppedGame(TEST_USER);
    const r = await put(id, { status: 'playing', expectedStatus: 'backlog' });
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.error.code).toBe('status_conflict');
    expect(j.error.details).toEqual({ status: 'dropped' });
    expect((await row(TEST_USER, id)).status).toBe('dropped');
    expect((await put(id, { status: 'playing', expectedStatus: null })).status).toBe(409);
    expect((await put(id, { status: 'playing', expectedStatus: 'dropped' })).status).toBe(200);
  });

  it('откат не затирает чужое изменение: статус сменили в другом месте = 409', async () => {
    const id = await droppedGame(TEST_USER);
    const before = await row(TEST_USER, id);
    await put(id, { status: 'playing', expectedStatus: 'dropped' });
    await put(id, { status: 'shelved' }); // другая вкладка
    const r = await put(id, { status: 'dropped', expectedStatus: 'playing', restore: { status: 'dropped', statusChangedAt: before.statusChangedAt.toISOString(), droppedAt: before.droppedAt!.toISOString() } });
    expect(r.status).toBe(409);
    expect((await row(TEST_USER, id)).status).toBe('shelved');
  });

  it('валидация restore: расхождение со status, лишнее поле, дата не к статусу, нет statusChangedAt, плохой expectedStatus = 400', async () => {
    const id = await droppedGame(TEST_USER);
    const ok = { status: 'dropped', statusChangedAt: daysAgo(60).toISOString(), droppedAt: null };
    const bad: unknown[] = [
      { status: 'playing', restore: ok },
      { status: 'dropped', restore: { ...ok, extra: 1 } },
      { status: 'dropped', restore: { ...ok, completedAt: daysAgo(1).toISOString() } },
      { status: 'dropped', restore: { status: 'dropped', droppedAt: null } },
      { status: 'dropped', restore: { ...ok, statusChangedAt: 'вчера' } },
      { status: 'dropped', restore: null },
      { status: 'dropped', restore: [] },
      { status: 'dropped', expectedStatus: 'bogus' },
    ];
    for (const b of bad) expect((await put(id, b)).status, JSON.stringify(b)).toBe(400);
    expect((await row(TEST_USER, id)).statusChangedAt).toEqual(daysAgo(60));
  });

  it('изоляция: чужая игра = 404, чужая строка статуса не меняется', async () => {
    const idA = await droppedGame(TEST_USER);
    testSession.userId = TEST_USER_2;
    const r = await put(idA, { status: 'dropped', restore: { status: 'dropped', statusChangedAt: NOW.toISOString() } });
    expect(r.status).toBe(404);
    expect((await put(idA, { status: 'playing', expectedStatus: 'dropped' })).status).toBe(404);
    const a = await row(TEST_USER, idA);
    expect(a.status).toBe('dropped');
    expect(a.statusChangedAt).toEqual(daysAgo(60));
  });
});
