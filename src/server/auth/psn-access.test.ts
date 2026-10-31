// Перепроверка доступа к PSN при старте обхода (контракт 22.13): период, лимит, изоляция сбоев.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import type { AccessCheck } from '@/server/psn/access';
import { ACCESS_COOLDOWN_MS, RECHECK_AFTER_MS, recheckPending, setPsnAccess } from './psn-access';
import { asUserId } from './user-id';

const { allowedUsers } = schema;
const NOW = new Date('2026-10-31T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('recheckPending / setPsnAccess', () => {
  let t: TestDb;
  const ids: number[] = [];
  beforeAll(async () => {
    t = await createTestDb({ migrations: 15 });
    for (let i = 0; i < 8; i++) {
      const [r] = await t.db.insert(allowedUsers).values({ email: `p${i}@example.com`, role: 'member', status: 'active' }).returning({ id: allowedUsers.id });
      ids.push(r.id);
    }
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.db.update(allowedUsers).set({ psnOnlineId: null, psnAccessStatus: 'unchecked', psnAccessCheckedAt: null, status: 'active' }).where(eq(allowedUsers.role, 'member'));
  });
  const set = (i: number, v: Partial<typeof allowedUsers.$inferInsert>) => t.db.update(allowedUsers).set(v).where(eq(allowedUsers.id, ids[i]));
  const status = async (i: number) => (await t.db.select().from(allowedUsers).where(eq(allowedUsers.id, ids[i])))[0];

  it('unavailable старше 6 ч перепроверяется и становится ok; свежее 6 ч, private и not_found не трогаются', async () => {
    await set(0, { psnOnlineId: 'Nick_Zero', psnAccessStatus: 'unavailable', psnAccessCheckedAt: ago(RECHECK_AFTER_MS + 1000) });
    await set(1, { psnOnlineId: 'Nick_One', psnAccessStatus: 'unavailable', psnAccessCheckedAt: ago(RECHECK_AFTER_MS - 60_000) });
    await set(2, { psnOnlineId: 'Nick_Two', psnAccessStatus: 'private', psnAccessCheckedAt: ago(30 * 86400_000) });
    await set(3, { psnOnlineId: 'Nick_Three', psnAccessStatus: 'not_found', psnAccessCheckedAt: ago(30 * 86400_000) });
    await set(4, { psnOnlineId: 'Nick_Four', psnAccessStatus: 'unavailable' }); // не проверялся ни разу
    const check = vi.fn(async (id: string): Promise<AccessCheck> => ({ status: 'ok', accountId: `acc-${id}` }));
    expect(await recheckPending(t.db, check, NOW)).toBe(2);
    expect(check.mock.calls.map((c) => c[0]).sort()).toEqual(['Nick_Four', 'Nick_Zero']);
    expect(await status(0)).toMatchObject({ psnAccessStatus: 'ok', psnAccountId: 'acc-Nick_Zero' });
    expect((await status(0)).psnAccessCheckedAt).toEqual(NOW);
    expect((await status(1)).psnAccessStatus).toBe('unavailable');
    expect((await status(2)).psnAccessStatus).toBe('private');
    expect((await status(3)).psnAccessStatus).toBe('not_found');
  });

  it('снова unavailable: статус остаётся, время проверки обновляется (следующая попытка через 6 ч)', async () => {
    await set(0, { psnOnlineId: 'Nick_Zero', psnAccessStatus: 'unavailable', psnAccessCheckedAt: ago(RECHECK_AFTER_MS + 1) });
    await recheckPending(t.db, async () => ({ status: 'unavailable', reason: 'psn_unavailable' }), NOW);
    expect(await status(0)).toMatchObject({ psnAccessStatus: 'unavailable', psnOnlineId: 'Nick_Zero' });
    expect((await status(0)).psnAccessCheckedAt).toEqual(NOW);
    expect(await recheckPending(t.db, async () => ({ status: 'ok', accountId: 'a' }), NOW)).toBe(0);
  });

  it('blocked не перепроверяются; не больше limit за раз; исключение у одного не мешает остальным', async () => {
    for (let i = 0; i < 5; i++) await set(i, { psnOnlineId: `Nick_${i}`, psnAccessStatus: 'unavailable' });
    await set(0, { status: 'blocked' });
    const check = vi.fn(async (id: string): Promise<AccessCheck> => {
      if (id === 'Nick_1') throw new Error('сбой');
      return { status: 'ok', accountId: 'a' };
    });
    expect(await recheckPending(t.db, check, NOW, 3)).toBe(2); // из 3 взятых один упал
    expect(check).toHaveBeenCalledTimes(3);
    expect(check.mock.calls.map((c) => c[0])).not.toContain('Nick_0');
    expect((await status(1)).psnAccessStatus).toBe('unavailable');
  });

  it('setPsnAccess: граница паузы 30 с', async () => {
    const check = vi.fn(async (): Promise<AccessCheck> => ({ status: 'ok', accountId: 'a' }));
    const uid = asUserId(ids[5]);
    expect((await setPsnAccess(t.db, uid, 'Pause_Nick', check, NOW)).kind).toBe('ok');
    const early = await setPsnAccess(t.db, uid, 'Pause_Nick', check, new Date(NOW.getTime() + ACCESS_COOLDOWN_MS - 1000));
    expect(early).toEqual({ kind: 'rate_limited', retryAfterSec: 1 });
    expect((await setPsnAccess(t.db, uid, 'Pause_Nick', check, new Date(NOW.getTime() + ACCESS_COOLDOWN_MS))).kind).toBe('ok');
    expect(check).toHaveBeenCalledTimes(2);
  });
});
