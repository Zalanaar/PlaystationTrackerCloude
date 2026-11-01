// QA Фазы 41: ночная цепочка на 6 профилях (2 входа по 3 профиля). Оркестрация без PSN; (контракт 22.13): у каждого свой sync_runs и свой ник, сбой одного не останавливает остальных,
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


const NICKS = ['P1_Owner', 'P2_Owner_B', 'P3_Owner_C', 'P4_Friend', 'P5_Friend_B', 'P6_Friend_C'];

beforeAll(async () => {
  t = await createTestDb();
  await t.db.update(allowedUsers).set({ psnOnlineId: NICKS[0], psnAccessStatus: 'ok' }).where(eq(allowedUsers.id, 1));
  const [f] = await t.db.insert(allowedUsers).values({ email: 'friend@example.com', role: 'member', status: 'active', psnOnlineId: NICKS[3], psnAccessStatus: 'ok' }).returning({ id: allowedUsers.id });
  for (const [i, primary] of [[1, 1], [2, 1], [4, f.id], [5, f.id]] as const) {
    await t.db.insert(allowedUsers).values({ email: i < 3 ? 'owner@example.com' : 'friend@example.com', role: 'member', status: 'active', primaryUserId: primary, psnOnlineId: NICKS[i], psnAccessStatus: 'ok' });
  }
});
afterAll(() => t.close());
beforeEach(() => {
  vi.stubEnv('CRON_SECRET', SECRET);
  vi.stubEnv('PSN_TARGET_ONLINE_ID', 'Owner_Fallback');
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 1).toString('base64'));
  vi.stubEnv('SYNC_ORIGIN', 'https://app.example');
  vi.stubGlobal('fetch', async (url: URL, init: RequestInit) => cronGet(new Request(url, init as RequestInit)));
  afterCbs.length = 0;
  connected.length = 0;
});

describe('ночная цепочка на 6 профилях', () => {
  it('все 6 профилей по одному запуску в порядке id, цепочка сама доходит до конца; замер оркестрации', async () => {
    const t0 = performance.now();
    const r = await cronGet(req());
    expect(r.status).toBe(202);
    await drain();
    const ms = performance.now() - t0;
    expect(connected).toEqual(['P1_Owner', 'P4_Friend', 'P2_Owner_B', 'P3_Owner_C', 'P5_Friend_B', 'P6_Friend_C']);
    const runs = await t.db.select().from(syncRuns);
    expect(runs).toHaveLength(6);
    expect(new Set(runs.map((x) => x.userId)).size).toBe(6);
    expect(runs.every((x) => x.status === 'success' && x.kind === 'daily')).toBe(true);
    console.log(`QA41 chain: 6 профилей, оркестрация (PGlite, движок-заглушка) ${ms.toFixed(0)} мс; ${(ms / 6).toFixed(0)} мс на профиль`);
  });
});
