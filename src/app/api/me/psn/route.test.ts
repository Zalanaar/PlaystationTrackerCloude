// PUT/GET /api/me/psn (контракт 22.13): коды ответов, запись psn_access_status, пауза, защита чужих ников.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { resetTestSession, testSession } from '@/server/auth/test-require-user';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import type { AccessCheck } from '@/server/psn/access';

const { allowedUsers, games, syncRuns } = schema;
const holder: { db: TestDb['db'] | null } = { db: null };
vi.mock('@/db', async (orig) => ({
  ...(await orig<typeof import('@/db')>()),
  getDb: () => {
    if (!holder.db) throw new Error('no db');
    return holder.db;
  },
}));
vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);

const check = vi.fn<(id: string) => Promise<AccessCheck>>();
vi.mock('@/server/psn/access', async (orig) => ({ ...(await orig<typeof import('@/server/psn/access')>()), checkProfileAccess: (_d: unknown, id: string) => check(id) }));

const { GET, PUT } = await import('./route');

let t: TestDb;
const M = 2; // member
const put = (body: unknown, headers: Record<string, string> = {}) =>
  PUT(new Request('http://x/api/me/psn', { method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
const row = async (id: number) => (await t.db.select().from(allowedUsers).where(eq(allowedUsers.id, id)))[0];
const forget = (id: number) => t.db.update(allowedUsers).set({ psnAccessCheckedAt: null }).where(eq(allowedUsers.id, id));

beforeAll(async () => {
  t = await createTestDb({ migrations: 15 }); // схема ровно после 0014; код не зависит от 0015
  holder.db = t.db;
  await t.db.insert(allowedUsers).values({ email: 'member@example.com', role: 'member', status: 'active' }); // id = 2
});
afterAll(async () => {
  holder.db = null;
  await t.close();
});
beforeEach(async () => {
  vi.stubEnv('PSN_TARGET_ONLINE_ID', 'TargetOwner');
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 1).toString('base64'));
  resetTestSession();
  testSession.userId = M;
  testSession.role = 'member';
  check.mockReset();
  await t.db.delete(syncRuns).where(eq(syncRuns.userId, M));
  await t.db.delete(games).where(eq(games.userId, M));
  await t.db.update(allowedUsers).set({ onboardedAt: null }).where(eq(allowedUsers.id, M));
  await t.db.update(allowedUsers).set({ psnOnlineId: null, psnAccountId: null, psnAccessMode: 'public', psnAccessStatus: 'unchecked', psnAccessCheckedAt: null }).where(eq(allowedUsers.id, M));
  await t.db.update(allowedUsers).set({ psnOnlineId: null, psnAccountId: null, psnAccessStatus: 'unchecked', psnAccessCheckedAt: null }).where(eq(allowedUsers.id, 1));
});

describe('GET /api/me/psn', () => {
  it('новый пользователь: ника нет, синк недоступен', async () => {
    const r = await GET(new Request('http://x/api/me/psn'));
    expect(r.status).toBe(200);
    expect((await r.json()).data).toMatchObject({ onlineId: null, accessStatus: 'unchecked', accessMode: 'public', canStartSync: false, onboardedAt: null, sync: null });
  });

  it('W-1: есть success-запуск, onboarded_at пуст -> GET проставляет его (member не застревает)', async () => {
    await t.db.insert(syncRuns).values({ userId: M, kind: 'manual', status: 'success', snapshotDate: '2026-10-30' });
    const r = await GET(new Request('http://x/api/me/psn'));
    const iso = (await r.json()).data.onboardedAt;
    expect(iso).not.toBeNull();
    expect((await row(M)).onboardedAt?.toISOString()).toBe(iso);
  });

  it('W-1: failed/hltb-запуски онбординг не завершают', async () => {
    await t.db.insert(syncRuns).values([
      { userId: M, kind: 'manual', status: 'failed', snapshotDate: '2026-10-30' },
      { userId: M, kind: 'hltb', status: 'success', snapshotDate: '2026-10-30' },
    ]);
    expect((await (await GET(new Request('http://x/api/me/psn'))).json()).data.onboardedAt).toBeNull();
    expect((await row(M)).onboardedAt).toBeNull();
  });

  it('W-1: success чужого пользователя не считается', async () => {
    await t.db.insert(syncRuns).values({ userId: 1, kind: 'manual', status: 'success', snapshotDate: '2026-10-30' });
    expect((await (await GET(new Request('http://x/api/me/psn'))).json()).data.onboardedAt).toBeNull();
    await t.db.delete(syncRuns).where(eq(syncRuns.userId, 1));
  });

  it('без сессии: 401', async () => {
    testSession.anonymous = true;
    expect((await GET(new Request('http://x/api/me/psn'))).status).toBe(401);
    expect((await put({ onlineId: 'Abc_123' })).status).toBe(401);
  });
});

describe('PUT /api/me/psn', () => {
  it('ok: 200, ник и accountId записаны, canStartSync', async () => {
    check.mockResolvedValue({ status: 'ok', accountId: 'acc-1' });
    const r = await put({ onlineId: ' Member_Psn ' });
    expect(r.status).toBe(200);
    expect((await r.json()).data).toMatchObject({ onlineId: 'Member_Psn', accessStatus: 'ok', canStartSync: true });
    expect(check).toHaveBeenCalledWith('Member_Psn');
    expect(await row(M)).toMatchObject({ psnOnlineId: 'Member_Psn', psnAccountId: 'acc-1', psnAccessStatus: 'ok' });
    expect((await row(M)).psnAccessCheckedAt).not.toBeNull();
  });

  it('некорректный запрос: не JSON, не объект, onlineId не строка/не по шаблону, нет ника вовсе = 400, PSN не вызывается', async () => {
    expect((await put('{oops')).status).toBe(400);
    expect((await put('[]')).status).toBe(400);
    expect((await put({ onlineId: 5 })).status).toBe(400);
    expect((await put({ onlineId: 'a b' })).status).toBe(400);
    expect((await put({ onlineId: '1abc' })).status).toBe(400);
    expect((await put({})).status).toBe(400);
    expect((await PUT(new Request('http://x/api/me/psn', { method: 'PUT', body: '{}' }))).status).toBe(400);
    expect((await put({ onlineId: 'Abc_123' }, { origin: 'http://evil.example', host: 'x' })).status).toBe(400);
    expect(check).not.toHaveBeenCalled();
  });

  it('без серверных настроек PSN: 500 config_error', async () => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', '');
    const r = await put({ onlineId: 'Abc_123' });
    expect(r.status).toBe(500);
    expect((await r.json()).error.code).toBe('config_error');
  });

  it('нет профиля: 422 psn_not_found, статус not_found записан', async () => {
    check.mockResolvedValue({ status: 'not_found' });
    const r = await put({ onlineId: 'Ghost_1' });
    expect(r.status).toBe(422);
    expect((await r.json()).error.code).toBe('psn_not_found');
    expect(await row(M)).toMatchObject({ psnOnlineId: 'Ghost_1', psnAccessStatus: 'not_found' });
  });

  it('закрытый профиль: 422 psn_private; в режиме friend: psn_friend_required', async () => {
    check.mockResolvedValue({ status: 'private' });
    let r = await put({ onlineId: 'Closed_1' });
    expect(r.status).toBe(422);
    expect((await r.json()).error.code).toBe('psn_private');
    expect((await row(M)).psnAccessStatus).toBe('private');

    await forget(M);
    await t.db.update(allowedUsers).set({ psnAccessMode: 'friend' }).where(eq(allowedUsers.id, M));
    r = await put({ onlineId: 'Closed_1' });
    expect(r.status).toBe(422);
    expect((await r.json()).error.code).toBe('psn_friend_required');
    expect((await row(M)).psnAccessStatus).toBe('friend_required');
  });

  it('сбой PSN: 503 psn_unavailable, статус unavailable', async () => {
    check.mockResolvedValue({ status: 'unavailable', reason: 'rate_limited' });
    const r = await put({ onlineId: 'Abc_123' });
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe('psn_unavailable');
    expect(await row(M)).toMatchObject({ psnOnlineId: 'Abc_123', psnAccessStatus: 'unavailable' });
  });

  it('пауза 30 с между проверками: 429 + Retry-After, PSN не вызывается', async () => {
    check.mockResolvedValue({ status: 'ok', accountId: 'a' });
    expect((await put({ onlineId: 'Abc_123' })).status).toBe(200);
    check.mockClear();
    const r = await put({ onlineId: 'Abc_123' });
    expect(r.status).toBe(429);
    expect((await r.json()).error.code).toBe('rate_limited');
    expect(Number(r.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(check).not.toHaveBeenCalled();
  });

  it('ник другого пользователя (без учёта регистра, включая владельца): 409 psn_id_taken', async () => {
    await t.db.update(allowedUsers).set({ psnOnlineId: 'Owner_Nick', psnAccessStatus: 'ok' }).where(eq(allowedUsers.id, 1));
    const r = await put({ onlineId: 'owner_nick' });
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe('psn_id_taken');
    expect(check).not.toHaveBeenCalled();
  });

  it('перепроверка без тела ника берёт сохранённый', async () => {
    await t.db.update(allowedUsers).set({ psnOnlineId: 'Saved_1', psnAccessStatus: 'unavailable' }).where(eq(allowedUsers.id, M));
    check.mockResolvedValue({ status: 'ok', accountId: 'a' });
    const r = await put({});
    expect(r.status).toBe(200);
    expect(check).toHaveBeenCalledWith('Saved_1');
    expect((await row(M)).psnAccessStatus).toBe('ok');
  });

  it('другой аккаунт PSN при уже синканных играх: 409 psn_account_locked, ничего не меняется; тот же аккаунт (переименование) допустим', async () => {
    await t.db.update(allowedUsers).set({ psnOnlineId: 'Old_Nick', psnAccountId: 'acc-old', psnAccessStatus: 'ok' }).where(eq(allowedUsers.id, M));
    await t.db.insert(games).values({ userId: M, titleId: 'LOCK00001', name: 'Locked game', category: 'ps5_native_game', lastSeenAt: new Date() });
    check.mockResolvedValue({ status: 'ok', accountId: 'acc-NEW' });
    let r = await put({ onlineId: 'New_Nick' });
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe('psn_account_locked');
    expect(await row(M)).toMatchObject({ psnOnlineId: 'Old_Nick', psnAccountId: 'acc-old' });

    check.mockResolvedValue({ status: 'ok', accountId: 'acc-old' });
    r = await put({ onlineId: 'Renamed_Nick' });
    expect(r.status).toBe(200);
    expect((await row(M)).psnOnlineId).toBe('Renamed_Nick');
  });

  it('неудачная проверка другого ника не затирает рабочий ok-ник', async () => {
    await t.db.update(allowedUsers).set({ psnOnlineId: 'Works_1', psnAccountId: 'acc', psnAccessStatus: 'ok' }).where(eq(allowedUsers.id, M));
    check.mockResolvedValue({ status: 'not_found' });
    const r = await put({ onlineId: 'Typo_Nick' });
    expect(r.status).toBe(422);
    expect(await row(M)).toMatchObject({ psnOnlineId: 'Works_1', psnAccessStatus: 'ok' });
  });
});
