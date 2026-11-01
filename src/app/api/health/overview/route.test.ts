import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { resetTestSession, testSession } from '@/server/auth/test-require-user';

vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);
let t: TestDb;
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => t.db }));
const { GET } = await import('./route');

const pgc = (x: TestDb) => (x.pg as unknown as { $client: PGlite }).$client;
const req = () => new Request('http://x/api/health/overview');
const SECRETS = ['npsso-secret-value', 'access-secret-token', 'cron-secret-value', 'llm-key-value', 'rawg-key-value', 'sub-google-123', 'acc-psn-999', 'raw PSN error text'];

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  await pgc(t).exec(`delete from allowed_users where id > 1`);
  await pgc(t).exec(`alter table allowed_users alter column id restart with 2`);
  await pgc(t).exec(`update allowed_users set psn_online_id = 'Target', psn_access_status = 'ok', last_login_at = '2026-11-01T08:00:00Z' where id = 1`);
  await pgc(t).exec(`
    insert into allowed_users (email, role, status, psn_online_id, psn_access_status, google_sub, psn_account_id, display_name) values
      ('friend@example.com', 'member', 'active', 'Friend', 'private', 'sub-google-123', 'acc-psn-999', 'Друг');
    insert into allowed_users (email, role, status, psn_online_id, primary_user_id) values ('friend@example.com', 'member', 'active', 'FriendAlt', 2);
    insert into allowed_users (email, role, status, psn_online_id, primary_user_id, archived_at) values ('friend@example.com', 'member', 'archived', 'Gone', 2, now());`);
  resetTestSession();
  vi.stubEnv('SESSION_SECRET', 's'.repeat(40));
  vi.stubEnv('PSN_TARGET_ONLINE_ID', 'Target');
  vi.stubEnv('CRON_SECRET', 'cron-secret-value');
  vi.stubEnv('LLM_PROVIDER', 'groq');
  vi.stubEnv('LLM_API_KEY', 'llm-key-value');
  vi.stubEnv('RAWG_API_KEY', 'rawg-key-value');
  vi.stubEnv('PSN_NPSSO', 'npsso-secret-value');
});
afterEach(() => vi.unstubAllEnvs());

describe('GET /api/health/overview', () => {
  it('без входа 401, member 403 и в теле нет данных', async () => {
    testSession.anonymous = true;
    expect((await GET(req())).status).toBe(401);
    resetTestSession();
    testSession.role = 'member';
    testSession.userId = 2;
    const r = await GET(req());
    expect(r.status).toBe(403);
    const text = await r.text();
    expect(JSON.parse(text).error.code).toBe('forbidden');
    for (const s of ['friend@example.com', 'owner@example.com', 'Target', 'Friend']) expect(text).not.toContain(s);
  });

  it('дополнительный профиль member-входа: 403', async () => {
    testSession.role = 'member';
    testSession.userId = 3;
    testSession.loginId = 2;
    expect((await GET(req())).status).toBe(403);
  });

  it('owner: профили без архивных, дополнительный без email и last_login, нет секретов и лишних полей', async () => {
    await pgc(t).exec(`
      insert into sync_runs (user_id, kind, status, error_reason, error_message, snapshot_date, started_at, finished_at) values
        (1, 'daily', 'success', null, null, '2026-11-01', '2026-11-01T03:00:00Z', '2026-11-01T03:05:00Z'),
        (1, 'daily', 'failed', 'auth_expired', 'raw PSN error text', '2026-10-30', '2026-10-30T03:00:00Z', '2026-10-30T03:01:00Z'),
        (1, 'manual', 'failed', 'cancelled', null, '2026-10-31', '2026-10-31T03:00:00Z', '2026-10-31T03:01:00Z'),
        (1, 'hltb', 'failed', 'internal', null, '2026-10-31', '2026-10-31T04:00:00Z', '2026-10-31T04:01:00Z'),
        (2, 'daily', 'failed', 'psn_unavailable', null, '2026-10-01', '2026-10-01T03:00:00Z', '2026-10-01T03:01:00Z');
      insert into psn_token_events (event, details, created_at) values ('pasted', '{"refreshTokenExpiresInSec":864000}', now() - interval '3 days');`);
    await pgc(t).exec(`
      insert into provider_usage (user_id, day, provider, calls) values (1, (now() at time zone 'Europe/Moscow')::date, 'rawg', 7), (2, (now() at time zone 'Europe/Moscow')::date, 'rawg', 3);
      insert into recommend_llm_usage (user_id, day, calls) values (1, (now() at time zone 'Europe/Moscow')::date, 5);`);

    const r = await GET(req());
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const text = await r.text();
    const d = JSON.parse(text).data;

    expect(d.users.map((u: { id: number }) => u.id)).toEqual([1, 2, 3]);
    const [owner, friend, alt] = d.users;
    expect(owner).toMatchObject({ isPrimary: true, email: 'owner@example.com', psnAccessStatus: 'ok', lastLoginAt: '2026-11-01T08:00:00.000Z' });
    expect(owner.sync.lastSuccessAt).toBe('2026-11-01T03:05:00.000Z');
    // hltb и cancelled не попадают в ошибки
    expect(owner.sync.recentErrors).toHaveLength(1);
    expect(owner.sync.recentErrors[0]).toMatchObject({ kind: 'daily', status: 'failed', errorReason: 'auth_expired' });
    expect(Object.keys(owner.sync.recentErrors[0]).sort()).toEqual(['errorReason', 'id', 'kind', 'startedAt', 'status']);
    expect(friend).toMatchObject({ label: 'Друг', psnAccessStatus: 'private', email: 'friend@example.com' });
    // старая ошибка (> 14 суток) не показывается
    expect(friend.sync.recentErrors).toEqual([]);
    expect(friend.sync.lastSuccessAt).toBeNull();
    expect(alt).toMatchObject({ isPrimary: false, loginId: 2, email: null, lastLoginAt: null });

    expect(owner.usage.rawg).toEqual({ used: 7, limit: 60 });
    expect(friend.usage.rawg).toEqual({ used: 3, limit: 60 });
    expect(owner.usage.llm).toEqual({ used: 5, limit: 12 });
    expect(owner.usage.hltb).toEqual({ used: 0, limit: 300 });
    expect(d.totals.rawg).toEqual({ used: 10, limit: 300 });
    expect(d.psnToken.source).toBe('pasted');
    expect(d.psnToken.ageSeconds).toBeGreaterThan(3 * 86400 - 60);
    expect(d.limits.llm).toMatchObject({ state: 'active', provider: 'groq' });
    expect(d.multiuser).toMatchObject({ enabled: false, activeProfiles: 3 });
    expect(d.criteria.items.find((c: { id: string }) => c.id === 'owner_ready').status).toBe('pass');

    for (const s of SECRETS) expect(text, s).not.toContain(s);
    expect(text).not.toContain('Gone');
    expect(text).not.toMatch(/googleSub|psnAccountId|errorMessage|npsso"/i);
  });

  it('RAWG без ключа: disabled и limit=null, а не безлимит', async () => {
    vi.stubEnv('RAWG_API_KEY', '');
    const d = (await (await GET(req())).json()).data;
    expect(d.limits.rawg).toMatchObject({ state: 'disabled', reason: 'no_key' });
    expect(d.users[0].usage.rawg.limit).toBeNull();
    expect(d.totals.rawg.limit).toBeNull();
  });

  it('пустой журнал токена: psnToken = null', async () => {
    expect((await (await GET(req())).json()).data.psnToken).toBeNull();
  });
});
