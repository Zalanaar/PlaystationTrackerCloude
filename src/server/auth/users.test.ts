// Фаза 41 (41.2, 41.3): поиск входа только по основным строкам, «Доступ» работает со входом целиком, лимит считает профили.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { completeLogin, createMember, deleteUser, getOwner, listAccessUsers, lookupForLogin, patchUser, toAccessUserById } from './users';

let t: TestDb;
const pg = () => (t.pg as unknown as { $client: PGlite }).$client;
const q = async <T>(sql: string) => (await pg().query<T>(sql)).rows;

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

// 1 owner, 2 member (вход B, был в системе), 3 доп. профиль owner, 4 и 5 доп. профили B (5 архивный)
beforeEach(async () => {
  await pg().exec(`
    TRUNCATE allowed_users RESTART IDENTITY CASCADE;
    insert into allowed_users (email, role, status, google_sub, psn_online_id, psn_account_id) values ('a@x.com', 'owner', 'active', 'sub-a', 'NickA', 'acc1');
    insert into allowed_users (email, role, status, google_sub, last_login_at, psn_online_id, psn_account_id) values ('b@x.com', 'member', 'active', 'sub-b', now(), 'NickB', 'acc2');
    insert into allowed_users (email, role, status, primary_user_id, psn_online_id, psn_account_id) values ('a@x.com', 'member', 'active', 1, 'NickA2', 'acc3');
    insert into allowed_users (email, role, status, primary_user_id, psn_online_id, psn_account_id) values ('b@x.com', 'member', 'active', 2, 'NickB2', 'acc4');
    insert into allowed_users (email, role, status, primary_user_id, psn_online_id, psn_account_id, archived_at) values ('b@x.com', 'member', 'archived', 2, 'NickB3', 'acc5', now());
    insert into games (user_id, title_id, name, category, last_seen_at) values (2, 'X', 'X', 'ps4_game', now()), (4, 'Y', 'Y', 'ps4_game', now()), (1, 'Z', 'Z', 'ps4_game', now());
  `);
});

describe('вход (lookupForLogin, completeLogin, getOwner)', () => {
  it('по почте находится основная строка, даже если дополнительная создана раньше/позже и имеет ту же почту', async () => {
    await pg().exec(`
      insert into allowed_users (email, role, status) values ('c@x.com', 'member', 'invited');
      insert into allowed_users (email, role, status, primary_user_id) values ('c@x.com', 'member', 'active', 6);`);
    const r = await lookupForLogin(t.db, 'new-sub', 'c@x.com');
    expect(r.ok && r.user.id).toBe(6);
    const bySub = await lookupForLogin(t.db, 'sub-b', 'other@x.com');
    expect(bySub.ok && bySub.user.id).toBe(2);
  });

  it('почта, которой нет среди основных, не находится через дополнительную строку', async () => {
    await pg().exec(`update allowed_users set email = 'copy@x.com' where id = 4`);
    expect((await lookupForLogin(t.db, 'nope', 'copy@x.com')).ok).toBe(false);
  });

  it('completeLogin не привязывает sub к дополнительной строке', async () => {
    const extra = (await q<{ id: number }>(`select id from allowed_users where id = 4`))[0];
    expect(await completeLogin(t.db, { ...(await t.db.query.allowedUsers.findFirst({ where: (u, { eq }) => eq(u.id, extra.id) }))! }, 'sub-new', null)).toBe(false);
  });

  it('getOwner: основная строка owner', async () => {
    expect((await getOwner(t.db))?.id).toBe(1);
  });

  it('заблокированный вход не пускает', async () => {
    await patchUser(t.db, 2, { status: 'blocked' }, 10);
    expect((await lookupForLogin(t.db, 'sub-b', 'b@x.com')).ok).toBe(false);
  });
});

describe('«Доступ»', () => {
  it('список: без архивных, с loginId / isPrimary / profilesCount', async () => {
    const list = await listAccessUsers(t.db);
    expect(list.map((u) => u.id)).toEqual([1, 2, 3, 4]);
    expect(list.map((u) => [u.id, u.loginId, u.isPrimary, u.profilesCount])).toEqual([[1, 1, true, 2], [2, 2, true, 2], [3, 1, false, 0], [4, 2, false, 0]]);
    expect((await toAccessUserById(t.db, 2))?.profilesCount).toBe(2);
  });

  it('создание: дубль почты проверяется по основным строкам; MAX_USERS считает профили', async () => {
    expect(await createMember(t.db, 'b@x.com', 1, 10)).toEqual({ ok: false, reason: 'exists' });
    expect(await createMember(t.db, 'n@x.com', 1, 4)).toEqual({ ok: false, reason: 'limit' }); // 4 активных профиля
    const r = await createMember(t.db, 'n@x.com', 1, 5);
    expect(r.ok).toBe(true);
    const row = (await q<{ primary_user_id: number | null; status: string }>(`select primary_user_id, status from allowed_users where email = 'n@x.com'`))[0];
    expect(row).toEqual({ primary_user_id: null, status: 'invited' });
  });

  it('блокировка: owner защищён, остальные строки входа blocked, архив не трогается; psnAccessMode только у указанной строки', async () => {
    expect(await patchUser(t.db, 3, { status: 'blocked' }, 10)).toEqual({ ok: false, reason: 'owner_protected' });
    expect(await patchUser(t.db, 2, { status: 'blocked' }, 10)).toEqual({ ok: true });
    expect((await q<{ id: number; status: string }>(`select id, status from allowed_users order by id`)).map((r) => r.status)).toEqual(['active', 'blocked', 'active', 'blocked', 'archived']);
    await patchUser(t.db, 4, { psnAccessMode: 'friend' }, 10);
    expect((await q<{ id: number; psn_access_mode: string }>(`select id, psn_access_mode from allowed_users order by id`)).map((r) => r.psn_access_mode)).toEqual(['public', 'public', 'public', 'friend', 'public']);
    expect(await patchUser(t.db, 5, { status: 'active' }, 10)).toEqual({ ok: false, reason: 'not_found' }); // архивный
    expect(await patchUser(t.db, 4, { status: 'active' }, 10)).toEqual({ ok: true }); // через дополнительный id разблокируется вход
    expect((await q<{ status: string }>(`select status from allowed_users order by id`)).map((r) => r.status)).toEqual(['active', 'active', 'active', 'active', 'archived']);
  });

  it('удаление: нужен blocked, confirmEmail = почта входа, снос входа целиком с данными профилей; соседний вход цел', async () => {
    expect(await deleteUser(t.db, 4, 'b@x.com')).toEqual({ ok: false, reason: 'not_blocked' });
    await patchUser(t.db, 2, { status: 'blocked' }, 10);
    expect(await deleteUser(t.db, 4, 'wrong@x.com')).toEqual({ ok: false, reason: 'confirm_mismatch' });
    expect(await deleteUser(t.db, 3, 'a@x.com')).toEqual({ ok: false, reason: 'owner_protected' });
    expect(await deleteUser(t.db, 5, 'b@x.com')).toEqual({ ok: false, reason: 'not_found' });
    expect(await deleteUser(t.db, 4, 'B@X.com')).toEqual({ ok: true }); // id доп. профиля = удаляется весь вход
    expect((await q<{ id: number }>(`select id from allowed_users order by id`)).map((r) => r.id)).toEqual([1, 3]);
    expect((await q<{ user_id: number }>(`select user_id from games order by user_id`)).map((r) => r.user_id)).toEqual([1]);
  });
});
