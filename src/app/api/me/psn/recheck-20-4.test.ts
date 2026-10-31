// QA 20.4 перепроверка: W-1 (дозаполнение onboarded_at: сбой UPDATE, чужие строки, идемпотентность, нет цикла редиректа) и W-6 (ник владельца из env).
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { resetTestSession, testSession } from '@/server/auth/test-require-user';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { needsOnboarding } from '@/ui/onboarding/model';
import { setPsnAccess } from '@/server/auth/psn-access';

const { allowedUsers, syncRuns } = schema;
const holder: { db: TestDb['db'] | null; failUpdate: boolean } = { db: null, failUpdate: false };
vi.mock('@/db', async (orig) => ({
  ...(await orig<typeof import('@/db')>()),
  getDb: () => {
    if (!holder.db) throw new Error('no db');
    const real = holder.db;
    // обёртка: update падает, пока failUpdate = true (имитация сбоя БД при дозаполнении)
    return new Proxy(real, { get: (target, prop, recv) => (prop === 'update' && holder.failUpdate ? () => { throw new Error('db down'); } : Reflect.get(target, prop, recv)) });
  },
}));
vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);

const { GET } = await import('./route');
let t: TestDb;
const M = 2;
let M2 = 0;
const get = async () => (await (await GET(new Request('http://x/api/me/psn'))).json()).data;
const row = async (id: number) => (await t.db.select().from(allowedUsers).where(eq(allowedUsers.id, id)))[0];
const ok = (userId: number, kind: 'manual' | 'hltb' = 'manual') => t.db.insert(syncRuns).values({ userId, kind, status: 'success', snapshotDate: '2026-10-30' });

beforeAll(async () => {
  t = await createTestDb({ migrations: 15 });
  holder.db = t.db;
  await t.db.insert(allowedUsers).values({ email: 'm@example.com', role: 'member', status: 'active', psnOnlineId: 'Nick_M', psnAccessStatus: 'ok' });
  const [r] = await t.db.insert(allowedUsers).values({ email: 'm2@example.com', role: 'member', status: 'active' }).returning({ id: allowedUsers.id });
  M2 = r.id;
});
afterAll(async () => {
  holder.db = null;
  await t.close();
});
beforeEach(async () => {
  holder.failUpdate = false;
  resetTestSession();
  testSession.userId = M;
  testSession.role = 'member';
  await t.db.delete(syncRuns);
  await t.db.update(allowedUsers).set({ onboardedAt: null });
});

describe('W-1: GET /api/me/psn дозаполняет onboarded_at', () => {
  it('сбой UPDATE: GET отвечает 200 с onboardedAt null, следующий GET дозаполняет (markOnboarded мог упасть, success есть)', async () => {
    await ok(M);
    holder.failUpdate = true;
    const r = await GET(new Request('http://x/api/me/psn'));
    expect(r.status).toBe(200);
    expect((await r.json()).data.onboardedAt).toBeNull();
    expect((await row(M)).onboardedAt).toBeNull();
    holder.failUpdate = false;
    expect((await get()).onboardedAt).not.toBeNull();
    expect((await row(M)).onboardedAt).not.toBeNull();
  });
  it('обновляется только своя строка: другой member без запуска и владелец остаются null', async () => {
    await ok(M);
    await get();
    expect((await row(M)).onboardedAt).not.toBeNull();
    expect((await row(M2)).onboardedAt).toBeNull();
    expect((await row(1)).onboardedAt).toBeNull();
  });
  it('идемпотентно: значение не перезаписывается повторными GET', async () => {
    await ok(M);
    const a = (await get()).onboardedAt;
    await new Promise((r) => setTimeout(r, 15));
    expect((await get()).onboardedAt).toBe(a);
  });
  it('нет цикла редиректа: ответ GET после success даёт needsOnboarding = false; без success остаётся true', async () => {
    const before = await get();
    expect(needsOnboarding({ role: 'member', status: 'active', onlineId: before.onlineId, onboardedAt: before.onboardedAt })).toBe(true);
    await ok(M);
    const after = await get();
    expect(needsOnboarding({ role: 'member', status: 'active', onlineId: after.onlineId, onboardedAt: after.onboardedAt })).toBe(false);
  });
  it('запуск hltb не считается', async () => {
    await ok(M, 'hltb');
    expect((await get()).onboardedAt).toBeNull();
  });
});

describe('W-6: ник владельца из PSN_TARGET_ONLINE_ID (setPsnAccess напрямую)', () => {
  const check = vi.fn(async () => ({ status: 'ok' as const, accountId: 'acc' }));
  beforeEach(async () => {
    check.mockClear();
    await t.db.update(allowedUsers).set({ psnOnlineId: null, psnAccountId: null, psnAccessStatus: 'unchecked', psnAccessCheckedAt: null }).where(eq(allowedUsers.id, M2));
  });
  const run = (input: string, owner: string | null) => setPsnAccess(t.db, M2 as never, input, check, new Date(), owner);

  it('регистр и пробелы с обеих сторон -> taken, PSN не вызывается', async () => {
    for (const [input, owner] of [['  TARGETOWNER ', ' TargetOwner '], ['targetowner', 'TargetOwner  '], ['TargetOwner', '  targetOWNER']] as const) {
      expect((await run(input, owner)).kind, `${input}|${owner}`).toBe('taken');
    }
    expect(check).not.toHaveBeenCalled();
  });
  it('пустой/не заданный ник владельца никого не блокирует; другой ник проходит', async () => {
    expect((await run('Other_Nick', null)).kind).toBe('ok');
    await t.db.update(allowedUsers).set({ psnOnlineId: null, psnAccessStatus: 'unchecked', psnAccessCheckedAt: null }).where(eq(allowedUsers.id, M2));
    expect((await run('Other_Nick', '')).kind).toBe('ok');
  });
  it('префикс/суффикс ника владельца не совпадает', async () => {
    expect((await run('TargetOwner2', 'TargetOwner')).kind).toBe('ok');
  });
});
