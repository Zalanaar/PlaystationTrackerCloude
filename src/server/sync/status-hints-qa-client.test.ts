// Перепроверка Фазы 27: настоящий клиентский код (putStatus, restoreSnapshot, undoAcceptBody) против настоящих роутов на PGlite, без мока fetch-ответов.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { schema } from '@/db';
import { resetTestSession } from '@/server/auth/test-require-user';
import { createTestDb, TEST_USER, type TestDb } from './test-helpers';
import { ApiError, putStatus } from '@/ui/collection/api';
import { acceptHint, initHints, lastAction, undoAcceptBody, type HintItem } from '@/ui/triage/hints';

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
import { GET as hintsGet } from '@/app/api/status-hints/route';

const DAY = 86_400_000;
const bodies: string[] = [];

describe('QA-27 перепроверка: тело клиента через реальные роуты', () => {
  let t: TestDb;
  const { games, gameStatus } = schema;
  beforeAll(async () => {
    t = await createTestDb();
    holder.db = t.db;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const m = /\/api\/games\/(\d+)\/status$/.exec(url);
      if (m && init?.method === 'PUT') {
        bodies.push(String(init.body));
        return statusPut(new Request(`http://x${url}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: init.body as string }), { params: Promise.resolve({ id: m[1] }) });
      }
      throw new Error(`unexpected ${url}`);
    });
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    resetTestSession();
    bodies.length = 0;
  });
  afterEach(() => undefined);

  const row = async (id: number) => (await t.db.select().from(gameStatus).where(and(eq(gameStatus.gameId, id), eq(gameStatus.userId, TEST_USER))))[0];
  const hints = async (): Promise<HintItem[]> => ((await (await hintsGet(new Request('http://x/api/status-hints'))).json()).data.items);

  async function seed(status: 'dropped' | 'shelved' | 'backlog' | 'playing' | null, opts: { lastPlayedDaysAgo?: number; platinum?: boolean } = {}) {
    const now = Date.now();
    const [g] = await t.db.insert(games).values({ userId: TEST_USER, titleId: 'CUSA1', name: 'G', category: 'ps5_native_game', lastSeenAt: new Date(), playDurationSeconds: 7200, lastPlayedAt: new Date(now - (opts.lastPlayedDaysAgo ?? 3) * DAY) }).returning({ id: games.id });
    if (status) {
      await t.db.insert(gameStatus).values({
        userId: TEST_USER, gameId: g.id, status, statusChangedAt: new Date(now - 60 * DAY + 123),
        droppedAt: status === 'dropped' ? new Date(now - 55 * DAY + 456) : null,
      });
    }
    return g.id;
  }

  for (const prev of ['dropped', 'playing', 'backlog'] as const) {
    it(`откат Принять из ${prev}: строка совпадает до миллисекунды, подсказка возвращается`, async () => {
      const id = await seed(prev, { lastPlayedDaysAgo: prev === 'playing' ? 45 : 3 });
      const before = await row(id);
      const list = await hints();
      expect(list.length).toBe(1);
      expect(list[0].currentStatus).toBe(prev);
      const target = list[0].suggested[0];
      const s1 = acceptHint(initHints(list), target);
      const action = lastAction(s1);
      if (action?.kind !== 'accept') throw new Error('no accept');
      await putStatus(id, target, { expectedStatus: list[0].currentStatus });
      const body = undoAcceptBody(action);
      await putStatus(id, body.status, { expectedStatus: body.expectedStatus, restore: body.restore });
      const sent = JSON.parse(bodies[1]);
      expect(Object.keys(sent).sort()).toEqual(['expectedStatus', 'restore', 'status']);
      expect(Object.keys(sent.restore).sort()).toEqual(['completedAt', 'droppedAt', 'status', 'statusChangedAt']);
      expect(sent.restore.completedAt).toBeNull();
      expect(sent.restore.droppedAt === null).toBe(prev !== 'dropped');
      expect(sent.restore.statusChangedAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
      const after = await row(id);
      expect(after.status).toBe(before.status);
      expect(after.statusChangedAt).toEqual(before.statusChangedAt);
      expect(after.droppedAt).toEqual(before.droppedAt);
      expect(after.completedAt).toEqual(before.completedAt);
      expect((await hints()).map((h) => h.rule)).toEqual([list[0].rule]);
    });
  }

  it('без статуса: откат = {status:null, expectedStatus}, без restore, строка удалена', async () => {
    const id = await seed(null);
    const list = await hints();
    expect(list[0].currentStatus).toBeNull();
    const s1 = acceptHint(initHints(list), 'playing');
    const action = lastAction(s1);
    if (action?.kind !== 'accept') throw new Error('no accept');
    await putStatus(id, 'playing', { expectedStatus: null });
    const body = undoAcceptBody(action);
    await putStatus(id, body.status, { expectedStatus: body.expectedStatus, restore: body.restore });
    expect(JSON.parse(bodies[0])).toEqual({ status: 'playing', expectedStatus: null });
    expect(JSON.parse(bodies[1])).toEqual({ status: null, expectedStatus: 'playing' });
    expect(await row(id)).toBeUndefined();
  });

  it('completed с датой в restore (клиент формирует из GameItem): принимается, completed_at сохраняется', async () => {
    const id = await seed('dropped');
    const completedAt = new Date(Date.now() - 20 * DAY);
    await t.db.update(gameStatus).set({ status: 'completed', completedAt, droppedAt: null }).where(eq(gameStatus.gameId, id));
    await putStatus(id, 'playing', { expectedStatus: 'completed' });
    await putStatus(id, 'completed', { expectedStatus: 'playing', restore: { status: 'completed', statusChangedAt: new Date(Date.now() - 20 * DAY).toISOString(), completedAt: completedAt.toISOString(), droppedAt: null } });
    expect((await row(id)).completedAt).toEqual(completedAt);
  });

  it('409: форма ответа, которую разбирает клиент (ApiError status 409, code status_conflict, details.status)', async () => {
    const id = await seed('dropped');
    const err = await putStatus(id, 'playing', { expectedStatus: 'backlog' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.code).toBe('status_conflict');
    expect((await row(id)).status).toBe('dropped');
  });

  it('риск: restore с датой в будущем принимается сервером (доверие клиенту)', async () => {
    const id = await seed('dropped');
    const future = new Date(Date.now() + 365 * DAY).toISOString();
    const r = await putStatus(id, 'dropped', { restore: { status: 'dropped', statusChangedAt: future, completedAt: null, droppedAt: future } }).then(() => 'ok', (e) => e);
    expect(r).toBe('ok');
    expect((await row(id)).droppedAt?.toISOString()).toBe(future);
  });

  it('риск: restore в backlog сбрасывает позицию Плана', async () => {
    const id = await seed('backlog');
    await t.db.insert(schema.roadmapOrder).values({ userId: TEST_USER, gameId: id, position: 1 } as never);
    await putStatus(id, 'backlog', { restore: { status: 'backlog', statusChangedAt: new Date().toISOString(), completedAt: null, droppedAt: null } });
    const left = await t.db.select().from(schema.roadmapOrder).where(eq(schema.roadmapOrder.gameId, id));
    expect(left.length).toBe(0);
  });
});
