// QA Фазы 41: риск «добавленный профиль уходит на /onboarding после смены» (QA-41-1).
// Повторяет цепочку серверного guard (src/app/(app)/onboarding-guard.ts): роль из cookie (роль входа) + GET /api/me/psn активного профиля -> needsOnboarding.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import type { AccessCheck } from '@/server/psn/access';
import { KIT_SECRET, kitRequest, sessionCookie, setCookieToken } from '@/server/auth/profile-test-kit';
import { readSessionToken } from '@/server/auth/session';
import { resetAddProfileThrottle } from '@/server/auth/profiles';
import { needsOnboarding } from '@/ui/onboarding/model';

let t: TestDb;
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => t.db }));
const check = vi.fn<(id: string) => Promise<AccessCheck>>();
vi.mock('@/server/psn/access', async (orig) => ({ ...(await orig<typeof import('@/server/psn/access')>()), checkProfileAccess: (_d: unknown, id: string) => check(id) }));

const list = await import('./route');
const { GET: psn } = await import('@/app/api/me/psn/route');
const pg = () => (t.pg as unknown as { $client: PGlite }).$client;

beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());
beforeEach(async () => {
  vi.stubEnv('SESSION_SECRET', KIT_SECRET);
  vi.stubEnv('PSN_TARGET_ONLINE_ID', 'TargetOwner');
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 1).toString('base64'));
  vi.stubEnv('MAX_USERS', '10');
  vi.stubEnv('PSN_NEW_USER_MODE', 'public');
  resetAddProfileThrottle();
  check.mockReset();
  check.mockImplementation(async (id) => ({ status: 'ok', accountId: `acc-${id.toLowerCase()}` }));
  await pg().exec(`
    TRUNCATE allowed_users RESTART IDENTITY CASCADE;
    insert into allowed_users (email, role, status, google_sub, last_login_at, psn_online_id, psn_account_id, psn_access_status, onboarded_at) values ('a@x.com', 'owner', 'active', 'sa', now(), 'NickA', 'acc1', 'ok', now());
    insert into allowed_users (email, role, status, google_sub, last_login_at, psn_online_id, psn_account_id, psn_access_status, onboarded_at) values ('b@x.com', 'member', 'active', 'sb', now(), 'NickB', 'acc2', 'ok', now());
  `);
});

/** Что увидит guard после «добавить и открыть»: роль берётся из cookie (подписана при входе), данные из /api/me/psn с новым cookie */
async function guardVerdict(loginUid: number, role: 'owner' | 'member', nick: string): Promise<{ redirect: boolean; onboardedAt: string | null }> {
  const add = await list.POST(kitRequest('/api/me/profiles', { method: 'POST', cookie: await sessionCookie(loginUid, { role }), body: { onlineId: nick } }));
  expect(add.status).toBe(201);
  const token = setCookieToken(add)!;
  const session = (await readSessionToken(token, KIT_SECRET))!;
  const res = await psn(kitRequest('/api/me/psn', { cookie: `pst_session=${token}` }));
  const body = (await res.json()) as { data: { onlineId: string | null; onboardedAt: string | null } };
  return { redirect: needsOnboarding({ role: session.role, status: 'active', onlineId: body.data.onlineId, onboardedAt: body.data.onboardedAt }), onboardedAt: body.data.onboardedAt };
}

describe('QA-41-1: guard /onboarding после добавления профиля', () => {
  it('вход owner: добавленный профиль (строка role=member) на /onboarding не уходит', async () => {
    const v = await guardVerdict(1, 'owner', 'NewOwnerNick');
    expect(v.redirect).toBe(false);
  });

  it('вход member: добавленный профиль с проверенным ником не уходит на /onboarding', async () => {
    const v = await guardVerdict(2, 'member', 'NewMemberNick');
    expect(v.redirect).toBe(false);
  });

  it('восстановление из архива (вход member) с ok: onboarded_at проставлен, redirect нет', async () => {
    const first = await list.POST(kitRequest('/api/me/profiles', { method: 'POST', cookie: await sessionCookie(2, { role: 'member' }), body: { onlineId: 'ArchNick' } }));
    expect(first.status).toBe(201);
    await pg().exec(`update allowed_users set status='archived', archived_at=now(), onboarded_at=NULL, created_at=now() - interval '1 hour' where lower(psn_online_id)='archnick'`);
    resetAddProfileThrottle();
    const res = await list.POST(kitRequest('/api/me/profiles', { method: 'POST', cookie: await sessionCookie(2, { role: 'member' }), body: { onlineId: 'ArchNick' } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { restored: boolean; profile: { onboardedAt: string | null } } };
    expect(body.data.restored).toBe(true);
    expect(needsOnboarding({ role: 'member', status: 'active', onlineId: 'ArchNick', onboardedAt: body.data.profile.onboardedAt })).toBe(false);
    const r = await pg().query<{ onboarded_at: string | null; status: string }>(`select onboarded_at, status from allowed_users where lower(psn_online_id)='archnick'`);
    expect(r.rows[0].status).toBe('active');
    expect(r.rows[0].onboarded_at).not.toBeNull();
  });

  it('friend_required: onboarded_at остаётся NULL', async () => {
    vi.stubEnv('PSN_NEW_USER_MODE', 'friend');
    check.mockImplementation(async () => ({ status: 'private' }));
    const add = await list.POST(kitRequest('/api/me/profiles', { method: 'POST', cookie: await sessionCookie(2, { role: 'member' }), body: { onlineId: 'FriendNick' } }));
    expect(add.status).toBe(201);
    const r = await pg().query<{ onboarded_at: string | null }>(`select onboarded_at from allowed_users where lower(psn_online_id)='friendnick'`);
    expect(r.rows[0].onboarded_at).toBeNull();
  });

  it('основной профиль без ника/онбординга по-прежнему идёт на /onboarding', () => {
    expect(needsOnboarding({ role: 'member', status: 'active', onlineId: 'NickB', onboardedAt: null })).toBe(true);
  });
});
