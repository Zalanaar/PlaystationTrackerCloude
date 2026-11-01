// POST /api/sync/cancel и POST /api/sync {restart} (контракт 8.8): права owner/member, изоляция, идемпотентность, нет утечки чужих запусков.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { resetTestSession, testSession } from '@/server/auth/test-require-user';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';

const { allowedUsers, syncRuns } = schema;
const afterCbs: Array<() => unknown> = [];
let t: TestDb;

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => void afterCbs.push(fn) }));
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => t.db }));
vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);

const { POST: cancelPost } = await import('./route');
const { POST: syncPost } = await import('../route');

const post = (url: string, body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  new Request(`http://x${url}`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
const cancel = (body: unknown = {}) => cancelPost(post('/api/sync/cancel', body));

describe('POST /api/sync/cancel', () => {
  beforeAll(async () => {
    t = await createTestDb();
    await t.db.insert(allowedUsers).values({ email: 'm@example.com', role: 'member', status: 'active', psnOnlineId: 'psn2', psnAccessStatus: 'ok' }); // id = 2
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    afterCbs.length = 0;
    resetTestSession();
    vi.stubEnv('PSN_TARGET_ONLINE_ID', 'Target');
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 1).toString('base64'));
  });

  const running = async (userId: number) => (await t.db.insert(syncRuns).values({ userId, kind: 'manual', status: 'running', snapshotDate: '2026-10-27', cursor: { phase: 'trophies', hops: 0 } }).returning())[0];
  const get = async (id: number) => (await t.db.select().from(syncRuns).where(eq(syncRuns.id, id)))[0];

  it('свой запуск: cancelled:true, затем идемпотентно cancelled:false', async () => {
    const r = await running(1);
    const res = await cancel({});
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ cancelled: true, runId: r.id });
    expect(await get(r.id)).toMatchObject({ status: 'failed', errorReason: 'cancelled', errorMessage: 'Остановлено пользователем.' });
    expect((await (await cancel({})).json()).data).toEqual({ cancelled: false, runId: null });
  });

  it('пустое тело допустимо; нет запуска = 200 cancelled:false', async () => {
    const res = await cancelPost(post('/api/sync/cancel', ''));
    expect(res.status).toBe(200);
    expect((await res.json()).data.cancelled).toBe(false);
  });

  it('member не может отменить чужой запуск: 403, запуск жив (и 403 без запуска: наличие не раскрывается)', async () => {
    const owner = await running(1);
    testSession.userId = 2;
    testSession.role = 'member';
    const r = await cancel({ userId: 1 });
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe('forbidden');
    expect((await get(owner.id)).status).toBe('running');
    await t.db.update(syncRuns).set({ status: 'success' }).where(eq(syncRuns.id, owner.id));
    expect((await cancel({ userId: 1 })).status).toBe(403);
    expect((await cancel({ userId: 999 })).status).toBe(403);
  });

  it('member отменяет свой запуск (в том числе с явным своим userId) и не видит чужой', async () => {
    const mine = await running(2);
    testSession.userId = 2;
    testSession.role = 'member';
    const res = await cancel({ userId: 2 });
    expect((await res.json()).data).toEqual({ cancelled: true, runId: mine.id });
    // чужой запуск владельца не затронут вызовом без userId
    await t.db.update(syncRuns).set({ status: 'success' }).where(eq(syncRuns.id, mine.id));
    const other = await running(1);
    expect((await (await cancel({})).json()).data.cancelled).toBe(false);
    expect((await get(other.id)).status).toBe('running');
  });

  it('owner отменяет запуск другого пользователя; несуществующий userId = cancelled:false', async () => {
    const r = await running(2);
    const res = await cancel({ userId: 2 });
    expect((await res.json()).data).toEqual({ cancelled: true, runId: r.id });
    expect(await get(r.id)).toMatchObject({ status: 'failed', errorReason: 'cancelled', errorMessage: 'Остановлено владельцем.' });
    expect((await (await cancel({ userId: 4242 })).json()).data.cancelled).toBe(false);
  });

  it('валидация: userId не число, ноль, дробное, массив в теле, невалидный JSON, без json content-type', async () => {
    for (const body of [{ userId: '2' }, { userId: 0 }, { userId: -1 }, { userId: 1.5 }, { userId: null }, [], '{oops']) {
      expect((await cancel(body)).status).toBe(400);
    }
    expect((await cancelPost(post('/api/sync/cancel', '{}', {}))).status).toBe(400);
    expect((await cancelPost(post('/api/sync/cancel', '{}', { 'content-type': 'application/json', origin: 'http://evil.example', host: 'x' }))).status).toBe(400);
  });

  it('без сессии 401', async () => {
    testSession.anonymous = true;
    expect((await cancel({})).status).toBe(401);
  });

  it('POST /api/sync {restart:true}: отменяет идущий запуск и стартует новый с курсором; ответ с restarted/cancelledRunId', async () => {
    const r = await running(1);
    await t.db.update(syncRuns).set({ startedAt: new Date(), snapshotDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date()) }).where(eq(syncRuns.id, r.id));
    const res = await syncPost(post('/api/sync', { restart: true }));
    expect(res.status).toBe(202);
    const d = (await res.json()).data;
    expect(d).toMatchObject({ started: true, resumed: true, restarted: true, cancelledRunId: r.id });
    expect(d.run.id).not.toBe(r.id);
    expect(await get(r.id)).toMatchObject({ status: 'failed', errorReason: 'cancelled' });
    expect((await get(d.run.id)).cursor).toMatchObject({ phase: 'trophies', hops: 0 });
    expect(afterCbs).toHaveLength(1);
  });

  it('POST /api/sync без restart при идущем запуске = 409 (restart не включается по умолчанию, нестрогие значения игнорируются)', async () => {
    const r = await running(1);
    for (const body of [{}, { restart: 'true' }, { restart: 1 }, 'not json']) {
      const res = await syncPost(post('/api/sync', body));
      expect(res.status).toBe(409);
    }
    expect((await get(r.id)).status).toBe('running');
  });

  it('restart без идущего запуска = обычный старт, restarted:false', async () => {
    const res = await syncPost(post('/api/sync', { restart: true }));
    expect(res.status).toBe(202);
    expect((await res.json()).data).toMatchObject({ started: true, restarted: false, cancelledRunId: null });
  });

  it('restart member не затрагивает запуск владельца', async () => {
    const ownerRun = await running(1);
    testSession.userId = 2;
    testSession.role = 'member';
    const res = await syncPost(post('/api/sync', { restart: true }));
    expect(res.status).toBe(409); // слот занят владельцем
    expect((await get(ownerRun.id)).status).toBe('running');
  });
});
