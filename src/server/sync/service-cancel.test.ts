// work() в service.ts: итог звена «cancelled» не ошибка (контракт 8.8): ни Telegram-алертов о сбое, ни онбординга,
// самовызова нет; обход пользователей продолжается для daily. Движок подменён: проверяется оркестрация.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { createTestDb, TEST_USER, type TestDb } from './test-helpers';

const afterCbs: Array<() => unknown> = [];
let t: TestDb;
let result: { status: string; reason: string | null; continueNext: boolean; hops?: number } = { status: 'failed', reason: 'cancelled', continueNext: false };
const notify = vi.fn(async () => null);

vi.mock('next/server', () => ({ after: (fn: () => unknown) => void afterCbs.push(fn) }));
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => t.db }));
vi.mock('@/server/notify/telegram', async (orig) => ({ ...(await orig<typeof import('@/server/notify/telegram')>()), notifyAfterSync: (...a: unknown[]) => (notify as (...x: unknown[]) => Promise<null>)(...a) }));
vi.mock('@/server/sync/engine', async (orig) => ({ ...(await orig<typeof import('@/server/sync/engine')>()), runChunk: async () => result }));

const { launchSync } = await import('./service');

describe('work(): cancelled не алертит', () => {
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    afterCbs.length = 0;
    notify.mockClear();
    vi.stubEnv('PSN_TARGET_ONLINE_ID', 'Target');
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 1).toString('base64'));
    vi.stubEnv('CRON_SECRET', 's'.repeat(40));
    vi.stubEnv('SYNC_ORIGIN', 'https://app.example');
    await t.db.update(schema.allowedUsers).set({ onboardedAt: null }).where(eq(schema.allowedUsers.id, 1));
  });

  it('cancelled: notifyAfterSync не вызывается, онбординг не отмечается', async () => {
    result = { status: 'failed', reason: 'cancelled', continueNext: false };
    const f = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', f);
    expect((await launchSync({ userId: TEST_USER, kind: 'manual' })).kind).toBe('started');
    await afterCbs[0]();
    expect(notify).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled(); // manual: ни самовызова continue, ни обхода
    const [u] = await t.db.select().from(schema.allowedUsers).where(eq(schema.allowedUsers.id, 1));
    expect(u.onboardedAt).toBeNull();
    vi.unstubAllGlobals();
  });

  it('daily + cancelled: обход продолжается к следующему пользователю, алертов нет', async () => {
    result = { status: 'failed', reason: 'cancelled', continueNext: false };
    const f = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', f);
    await launchSync({ userId: TEST_USER, kind: 'daily' });
    await afterCbs[0]();
    expect(notify).not.toHaveBeenCalled();
    expect(String((f.mock.calls[0] as unknown[])[0])).toContain('/api/cron/sync?queue=1');
    vi.unstubAllGlobals();
  });

  it('для контраста: настоящий сбой (internal) алертит как раньше', async () => {
    result = { status: 'failed', reason: 'internal', continueNext: false };
    await launchSync({ userId: TEST_USER, kind: 'manual' });
    await afterCbs[0]();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('continue на отменённый запуск: not_resumable, after не вызывается', async () => {
    result = { status: 'failed', reason: 'cancelled', continueNext: false };
    const s = await launchSync({ userId: TEST_USER, kind: 'manual' });
    if (s.kind !== 'started') throw new Error('start');
    await t.db.update(schema.syncRuns).set({ status: 'failed', errorReason: 'cancelled' }).where(eq(schema.syncRuns.id, s.run.id));
    afterCbs.length = 0;
    expect(await launchSync({ kind: 'daily', continueRunId: s.run.id, hop: 0 })).toEqual({ kind: 'not_resumable' });
    expect(afterCbs).toHaveLength(0);
  });
});
