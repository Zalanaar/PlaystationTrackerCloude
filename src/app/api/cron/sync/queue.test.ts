// Обход пользователей cron (контракт 22.13): у каждого свой sync_runs и свой ник, сбой одного не останавливает остальных,
// blocked не продолжает звено, member без ника получает понятный 4xx. Движок синка подменён: проверяется оркестрация, а не PSN.
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { resetTestSession, testSession } from '@/server/auth/test-require-user';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';

const { allowedUsers, syncRuns } = schema;
const SECRET = 'c'.repeat(40);
const afterCbs: Array<() => unknown> = [];
let t: TestDb;

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => void afterCbs.push(fn) }));
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => t.db }));
vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);

/** Что движок «прочитал» и чем закончил: по нику PSN. */
const connected: string[] = [];
const outcome = new Map<string, 'success' | 'failed' | 'throw'>();
vi.mock('@/server/psn/client', () => ({
  connectPsn: async (d: { onlineId: string }) => {
    connected.push(d.onlineId);
    return {};
  },
}));
vi.mock('@/server/sync/engine', async (orig) => {
  const real = await orig<typeof import('@/server/sync/engine')>();
  return {
    ...real,
    runChunk: async (deps: { connect: () => Promise<unknown>; db: typeof t.db }, run: { id: number; userId: number }) => {
      await deps.connect();
      const nick = connected[connected.length - 1];
      const what = outcome.get(nick) ?? 'success';
      if (what === 'throw') throw new Error('boom');
      const status = what === 'success' ? 'success' : 'failed';
      await deps.db.update(syncRuns).set({ status, errorReason: status === 'failed' ? 'psn_unavailable' : null, finishedAt: new Date() }).where(and(eq(syncRuns.id, run.id), eq(syncRuns.userId, run.userId)));
      return { status, reason: status === 'failed' ? 'psn_unavailable' : null, continueNext: false };
    },
  };
});

const { GET: cronGet } = await import('./route');
const { POST: syncPost } = await import('@/app/api/sync/route');

const req = (q = '') => new Request(`http://x/api/cron/sync${q}`, { headers: { authorization: `Bearer ${SECRET}` } });
/** Прокручивает отложенную работу after() и цепочку самовызовов (fetch заменён вызовом самого роута). */
async function drain(): Promise<void> {
  while (afterCbs.length) await afterCbs.shift()!();
}

const ids: Record<string, number> = {};
async function addUser(key: string, v: Partial<typeof allowedUsers.$inferInsert>): Promise<number> {
  const [r] = await t.db.insert(allowedUsers).values({ email: `${key}@example.com`, role: 'member', status: 'active', ...v }).returning({ id: allowedUsers.id });
  ids[key] = r.id;
  return r.id;
}
const runsOf = async (userId: number) => t.db.select().from(syncRuns).where(eq(syncRuns.userId, userId));

beforeAll(async () => {
  t = await createTestDb({ migrations: 15 }); // схема ровно после 0014; код не зависит от 0015
  ids.owner = 1;
  await addUser('a', { psnOnlineId: 'User_A', psnAccessStatus: 'ok' });
  await addUser('b', { psnOnlineId: 'User_B', psnAccessStatus: 'ok' });
  await addUser('blocked', { psnOnlineId: 'User_Blocked', psnAccessStatus: 'ok', status: 'blocked' });
  await addUser('nonick', {});
  await addUser('private', { psnOnlineId: 'User_Private', psnAccessStatus: 'private' });
  await addUser('invited', { psnOnlineId: 'User_Invited', psnAccessStatus: 'ok', status: 'invited' });
  await addUser('last', { psnOnlineId: 'User_Last', psnAccessStatus: 'ok' });
});
afterAll(() => t.close());
beforeEach(async () => {
  vi.stubEnv('CRON_SECRET', SECRET);
  vi.stubEnv('PSN_TARGET_ONLINE_ID', 'Owner_Fallback');
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 1).toString('base64'));
  vi.stubEnv('SYNC_ORIGIN', 'https://app.example');
  vi.stubGlobal('fetch', async (url: URL, init: RequestInit) => cronGet(new Request(url, init as RequestInit)));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  afterCbs.length = 0;
  connected.length = 0;
  outcome.clear();
  await t.db.delete(syncRuns);
  resetTestSession();
});

describe('обход пользователей', () => {
  it('идёт по активным подходящим по порядку id, у каждого свой запуск и свой ник; владелец без ника читает fallback', async () => {
    const r = await cronGet(req());
    expect(r.status).toBe(202);
    await drain();
    expect(connected).toEqual(['Owner_Fallback', 'User_A', 'User_B', 'User_Last']);
    for (const k of ['owner', 'a', 'b', 'last']) {
      const runs = await runsOf(ids[k]);
      expect(runs, k).toHaveLength(1);
      expect(runs[0]).toMatchObject({ kind: 'daily', status: 'success', userId: ids[k] });
    }
    // blocked, invited, без ника и с закрытым профилем не синкаются и запусков не имеют
    for (const k of ['blocked', 'invited', 'nonick', 'private']) expect(await runsOf(ids[k]), k).toHaveLength(0);
  });

  it('сбой одного пользователя (failed и исключение) не останавливает остальных', async () => {
    outcome.set('User_A', 'failed');
    outcome.set('User_B', 'throw');
    await cronGet(req());
    await drain();
    expect(connected).toEqual(['Owner_Fallback', 'User_A', 'User_B', 'User_Last']);
    expect((await runsOf(ids.a))[0].status).toBe('failed');
    expect((await runsOf(ids.b))[0].status).toBe('failed');
    expect((await runsOf(ids.last))[0].status).toBe('success');
    expect((await runsOf(ids.owner))[0].status).toBe('success');
  });

  it('?queue=<id> берёт только пользователей с большим id; пустая очередь = 200 queue_empty', async () => {
    let r = await cronGet(req(`?queue=${ids.b}`));
    expect(r.status).toBe(202);
    await drain();
    expect(connected).toEqual(['User_Last']);
    r = await cronGet(req(`?queue=${ids.last}`));
    expect(r.status).toBe(200);
    expect((await r.json()).data).toEqual({ started: false, reason: 'queue_empty' });
  });

  it('?queue вместе с continue или некорректный: 400', async () => {
    for (const q of ['?queue=abc', '?queue=-1', '?queue=1&continue=5&hop=0']) expect((await cronGet(req(q))).status, q).toBe(400);
  });

  it('уже идущий запуск: 200 already_running, второй запуск не создаётся', async () => {
    await cronGet(req()); // owner running (работа ещё в after())
    const r = await cronGet(req());
    expect(r.status).toBe(200);
    expect((await r.json()).data).toMatchObject({ started: false, reason: 'already_running' });
    afterCbs.length = 0;
  });
});

describe('?continue= и blocked', () => {
  const partial = async (userId: number) => {
    const [row] = await t.db
      .insert(syncRuns)
      .values({ userId, kind: 'daily', status: 'partial', errorReason: 'timeout', snapshotDate: '2026-10-31', startedAt: new Date(), phase: 'trophies', cursor: { phase: 'trophies', hops: 1 } })
      .returning();
    return row;
  };

  it('blocked-пользователь не продолжает звено: 200 user_inactive, запуск остаётся partial', async () => {
    const run = await partial(ids.blocked);
    const r = await cronGet(req(`?continue=${run.id}&hop=1`));
    expect(r.status).toBe(200);
    expect((await r.json()).data).toEqual({ started: false, reason: 'user_inactive' });
    expect(afterCbs).toHaveLength(0);
    expect((await runsOf(ids.blocked))[0]).toMatchObject({ status: 'partial', errorReason: 'timeout' });
  });

  it('пользователь заблокирован после старта запуска: продолжение тоже отклоняется', async () => {
    const run = await partial(ids.a);
    await t.db.update(allowedUsers).set({ status: 'blocked' }).where(eq(allowedUsers.id, ids.a));
    const r = await cronGet(req(`?continue=${run.id}&hop=1`));
    expect((await r.json()).data.reason).toBe('user_inactive');
    await t.db.update(allowedUsers).set({ status: 'active' }).where(eq(allowedUsers.id, ids.a));
  });

  it('активный пользователь продолжает звено под своим ником', async () => {
    const run = await partial(ids.b);
    const r = await cronGet(req(`?continue=${run.id}&hop=1`));
    expect(r.status).toBe(202);
    expect((await r.json()).data).toMatchObject({ started: true, resumed: true, runId: run.id });
    afterCbs.length = 0;
  });

  it('чужой/несуществующий runId: 200 not_resumable', async () => {
    const r = await cronGet(req('?continue=999999&hop=0'));
    expect((await r.json()).data.reason).toBe('not_resumable');
  });
});

describe('POST /api/sync: пользователь без ника (N-2)', () => {
  const post = () => syncPost(new Request('http://x/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));

  it('member без ника: 409 psn_not_set с понятным текстом, запуск не создаётся', async () => {
    testSession.userId = ids.nonick;
    testSession.role = 'member';
    // requireUserMock отдаёт row с ником; для проверки ники берутся из БД в launchSync, поэтому достаточно userId
    const r = await post();
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.error.code).toBe('psn_not_set');
    expect(j.error.message).toMatch(/ник PSN/);
    expect(await runsOf(ids.nonick)).toHaveLength(0);
  });

  it('member с ником без подтверждённого доступа: 409 psn_not_verified', async () => {
    testSession.userId = ids.private;
    testSession.role = 'member';
    const r = await post();
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe('psn_not_verified');
    expect(await runsOf(ids.private)).toHaveLength(0);
  });

  it('member с подтверждённым ником запускает свой синк (первый синк после онбординга)', async () => {
    testSession.userId = ids.a;
    testSession.role = 'member';
    const r = await post();
    expect(r.status).toBe(202);
    await drain();
    expect(connected[0]).toBe('User_A');
    expect(await runsOf(ids.a)).toHaveLength(1);
  });

  it('владелец без своего ника синкается через PSN_TARGET_ONLINE_ID', async () => {
    testSession.userId = 1;
    testSession.role = 'owner';
    expect((await post()).status).toBe(202);
    await drain();
    expect(connected[0]).toBe('Owner_Fallback');
  });
});
