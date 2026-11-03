// QA 20.4: охранные тесты на выжившие мутации (убрать user_id в getPsnState / проверке psn_account_locked / markOnboarded).
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { getPsnState, setPsnAccess } from '@/server/auth/psn-access';
import { asUserId } from '@/server/auth/user-id';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';

const { allowedUsers, games, syncRuns } = schema;
const afterCbs: Array<() => unknown> = [];
let t: TestDb;
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => void afterCbs.push(fn) }));
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => t.db }));
vi.mock('@/server/psn/client', () => ({ connectPsn: async () => ({}) }));
vi.mock('@/server/sync/engine', async (orig) => {
  const real = await orig<typeof import('@/server/sync/engine')>();
  return {
    ...real,
    runChunk: async (deps: { db: typeof t.db }, run: { id: number }) => {
      await deps.db.update(syncRuns).set({ status: 'success', finishedAt: new Date() }).where(eq(syncRuns.id, run.id));
      return { status: 'success', reason: null, continueNext: false };
    },
  };
});

const { launchSync } = await import('@/server/sync/service');
const A = 2;
const B = 3;

beforeAll(async () => {
  t = await createTestDb();
  for (const [k, nick, acc] of [['a', 'User_A', 'acc-a'], ['b', 'User_B', 'acc-b']] as const) {
    await t.db.insert(allowedUsers).values({ email: `${k}@example.com`, role: 'member', status: 'active', psnOnlineId: nick, psnAccountId: acc, psnAccessStatus: 'ok' });
  }
});
afterAll(() => t.close());
beforeEach(() => {
  afterCbs.length = 0;
  vi.stubEnv('PSN_TARGET_ONLINE_ID', 'Owner_Fallback');
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 1).toString('base64'));
  vi.stubEnv('CRON_SECRET', '');
  vi.stubEnv('SYNC_ORIGIN', '');
});

describe('QA 20.4: изоляция по user_id', () => {
  it('GET /api/me/psn: sync = запуск самого пользователя, чужой запуск не виден', async () => {
    await t.db.insert(syncRuns).values({ userId: B, kind: 'daily', status: 'success', snapshotDate: '2026-10-31', startedAt: new Date('2026-10-31T05:00:00Z'), finishedAt: new Date('2026-10-31T05:01:00Z') });
    expect((await getPsnState(t.db, asUserId(A)))?.sync).toBeNull();
    expect((await getPsnState(t.db, asUserId(B)))?.sync).toMatchObject({ kind: 'daily', status: 'success' });
    await t.db.delete(syncRuns);
  });

  it('psn_account_locked считает только свои игры: у A есть игры, B без игр меняет аккаунт свободно', async () => {
    await t.db.insert(games).values({ userId: A, titleId: 'QA0000001', name: 'A game', category: 'ps5_native_game', lastSeenAt: new Date() });
    const other = async () => ({ status: 'ok' as const, accountId: 'acc-new' });
    const rB = await setPsnAccess(t.db, asUserId(B), 'User_B_New', other, new Date('2026-10-31T12:00:00Z'));
    expect(rB.kind).toBe('ok');
    const rA = await setPsnAccess(t.db, asUserId(A), 'User_A_New', other, new Date('2026-10-31T12:00:00Z'));
    expect(rA.kind).toBe('locked');
    await t.db.delete(games);
  });

  it('первый success отмечает onboarded_at только у пользователя запуска', async () => {
    await t.db.update(allowedUsers).set({ onboardedAt: null });
    expect((await launchSync({ userId: asUserId(A), kind: 'manual' })).kind).toBe('started');
    while (afterCbs.length) await afterCbs.shift()!();
    const rows = await t.db.select().from(allowedUsers);
    expect(rows.find((r) => r.id === A)?.onboardedAt).not.toBeNull();
    expect(rows.find((r) => r.id === B)?.onboardedAt).toBeNull();
    expect(rows.find((r) => r.role === 'owner')?.onboardedAt).toBeNull();
  });
});
