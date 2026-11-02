// Фаза 41 (41.4, 41.6): архивные и заблокированные профили не попадают в cron-обход, сводку, копии; чистка архива; Telegram только по основному.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { KIT_SECRET, kitRequest, sessionCookie } from '@/server/auth/profile-test-kit';
import { patchUser } from '@/server/auth/users';
import { listSyncUsers } from '@/server/sync/users';
import { runDigest } from '@/server/digest/run';
import { purgeExpiredArchive } from '@/server/auth/profiles';

let t: TestDb;
const afterCbs = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => void afterCbs.push(fn) }));
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => t.db }));
const pg = () => (t.pg as unknown as { $client: PGlite }).$client;
const rows = async <T>(sql: string) => (await pg().query<T>(sql)).rows;

// 1 owner (вход A) ; 2 member (вход B); 3 доп. A; 4 доп. B; 5 архив B (свежий); 6 архив A (31 день); 7 member C (вход без ника)
beforeEach(async () => {
  vi.stubEnv('SESSION_SECRET', KIT_SECRET);
  await pg().exec(`
    TRUNCATE allowed_users RESTART IDENTITY CASCADE;
    insert into allowed_users (email, role, status, google_sub, last_login_at, psn_online_id, psn_account_id, psn_access_status) values ('a@x.com', 'owner', 'active', 'sa', now(), 'NickA', 'acc1', 'ok');
    insert into allowed_users (email, role, status, google_sub, last_login_at, psn_online_id, psn_account_id, psn_access_status) values ('b@x.com', 'member', 'active', 'sb', now(), 'NickB', 'acc2', 'ok');
    insert into allowed_users (email, role, status, primary_user_id, psn_online_id, psn_account_id, psn_access_status) values ('a@x.com', 'member', 'active', 1, 'NickA2', 'acc3', 'ok');
    insert into allowed_users (email, role, status, primary_user_id, psn_online_id, psn_account_id, psn_access_status) values ('b@x.com', 'member', 'active', 2, 'NickB2', 'acc4', 'ok');
    insert into allowed_users (email, role, status, primary_user_id, psn_online_id, psn_account_id, psn_access_status, archived_at) values ('b@x.com', 'member', 'archived', 2, 'NickB3', 'acc5', 'ok', now() - interval '5 days');
    insert into allowed_users (email, role, status, primary_user_id, psn_online_id, psn_account_id, psn_access_status, archived_at) values ('a@x.com', 'member', 'archived', 1, 'NickA3', 'acc6', 'ok', now() - interval '31 days');
    insert into games (user_id, title_id, name, category, last_seen_at) values (5, 'G5', 'Arch5', 'ps4_game', now()), (6, 'G6', 'Arch6', 'ps4_game', now()), (3, 'G3', 'Extra3', 'ps4_game', now());
  `);
});
afterAll(() => t.close());
beforeAll(async () => {
  t = await createTestDb();
});

describe('cron-обход', () => {
  it('в обходе: основные и активные дополнительные по id; архивные нет', async () => {
    expect((await listSyncUsers(t.db, 'Fallback')).map((u) => [u.id, u.onlineId])).toEqual([[1, 'NickA'], [2, 'NickB'], [3, 'NickA2'], [4, 'NickB2']]);
    expect((await listSyncUsers(t.db, 'Fallback', { afterId: 2 })).map((u) => u.id)).toEqual([3, 4]);
  });

  it('дополнительный профиль владельца не подставляет PSN_TARGET_ONLINE_ID (нет ника = не синкается)', async () => {
    await pg().exec(`update allowed_users set psn_online_id = null, psn_account_id = null, psn_access_status = 'unchecked' where id in (1, 3)`);
    const ids = (await listSyncUsers(t.db, 'FallbackNick')).map((u) => [u.id, u.onlineId]);
    expect(ids).toContainEqual([1, 'FallbackNick']); // владелец без ника: как раньше
    expect(ids.map((x) => x[0])).not.toContain(3);
  });

  it('вход заблокирован: ни основной, ни дополнительные профили не в обходе, даже если дополнительный остался active', async () => {
    await patchUser(t.db, 2, { status: 'blocked' }, 10);
    expect((await listSyncUsers(t.db, 'F')).map((u) => u.id)).toEqual([1, 3]);
    await pg().exec(`update allowed_users set status = 'active' where id = 4`); // гипотетическая рассинхронизация
    expect((await listSyncUsers(t.db, 'F')).map((u) => u.id)).toEqual([1, 3]);
  });
});

describe('сводка Telegram', () => {
  it('digest.results только по основным профилям', async () => {
    const r = await runDigest(t.db, { force: true, now: new Date('2026-11-01T09:00:00Z') });
    expect(r).not.toBeNull();
    expect(r!.results.map((x) => x.userId).sort()).toEqual([1, 2]);
  });
});

describe('чистка архива (watchdog)', () => {
  it('удаляет архивные старше 30 дней каскадом, свежий архив и активные остаются', async () => {
    expect(await purgeExpiredArchive(t.db)).toBe(1);
    expect((await rows<{ id: number }>(`select id from allowed_users order by id`)).map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
    expect((await rows<{ user_id: number }>(`select user_id from games order by user_id`)).map((r) => r.user_id)).toEqual([3, 5]);
    expect(await purgeExpiredArchive(t.db)).toBe(0);
    expect(await purgeExpiredArchive(t.db, new Date(Date.now() + 26 * 86_400_000))).toBe(1); // через 30 дней уходит и второй
  });

  it('роут watchdog: archivePurged в ответе, проверки и копии по каждому активному профилю, архивных нет', async () => {
    vi.stubEnv('CRON_SECRET', 'c'.repeat(40));
    vi.stubEnv('PSN_TARGET_ONLINE_ID', 'TargetOwner');
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 1).toString('base64'));
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '');
    vi.stubEnv('TELEGRAM_CHAT_ID', '');
    const { GET } = await import('@/app/api/cron/watchdog/route');
    const res = await GET(new Request('http://x/api/cron/watchdog', { headers: { authorization: `Bearer ${'c'.repeat(40)}` } }));
    expect(res.status).toBe(200);
    const d = (await res.json()).data as { archivePurged: number; users: { userId: number }[] };
    expect(d.archivePurged).toBe(1);
    expect(d.users.map((u) => u.userId)).toEqual([1, 2, 3, 4]);
  });
});

describe('Telegram привязан ко входу', () => {
  it('при активном дополнительном профиле привязка, статус и код пишутся на основной; в ответе profile основного', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '123:abc');
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 'w'.repeat(32));
    const { GET } = await import('@/app/api/me/telegram/route');
    const { POST: link } = await import('@/app/api/me/telegram/link/route');
    const cookie = await sessionCookie(2, { pid: 4 });
    const code = await link(kitRequest('/api/me/telegram/link', { method: 'POST', cookie }));
    expect(code.status).toBe(200);
    expect((await rows<{ user_id: number }>(`select user_id from telegram_link_codes`)).map((r) => r.user_id)).toEqual([2]);
    const st = await (await GET(kitRequest('/api/me/telegram', { cookie }))).json();
    expect(st.data).toMatchObject({ profile: { id: 2, onlineId: 'NickB' }, role: 'member' });
    expect(st.data.pendingCode).not.toBeNull();
    await pg().exec(`insert into telegram_chats (user_id, chat_id) values (2, 555)`);
    expect((await (await GET(kitRequest('/api/me/telegram', { cookie: await sessionCookie(2) }))).json()).data.linked).toBe(true);
    expect((await (await GET(kitRequest('/api/me/telegram', { cookie }))).json()).data.linked).toBe(true); // тот же статус из любого профиля входа
  });
});
