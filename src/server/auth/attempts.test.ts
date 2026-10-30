import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';

import type { PGlite } from '@electric-sql/pglite';
const pgc = (x: TestDb) => (x.pg as unknown as { $client: PGlite }).$client;
let t: TestDb;
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => t.db }));
const { markLoginSuccess, peekLoginLimit, reserveLoginAttempt } = await import('./attempts');

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());
beforeEach(() => pgc(t).exec('TRUNCATE login_attempts'));

describe('лимиты по kind (контракт 22.4)', () => {
  it('Google: 10 неудач с IP -> блок; peek ничего не пишет; пароль независим', async () => {
    for (let i = 0; i < 10; i++) expect((await reserveLoginAttempt('ip1', 'google')).limited).toBe(false);
    const r = await reserveLoginAttempt('ip1', 'google');
    expect(r.limited).toBe(true);
    expect((await peekLoginLimit('ip1', 'google')).limited).toBe(true);
    expect((await peekLoginLimit('ip2', 'google')).limited).toBe(false);
    expect((await peekLoginLimit('ip1', 'password')).limited).toBe(false);
    expect((await pgc(t).query('select 1 from login_attempts')).rows).toHaveLength(10);
  });
  it('успешный вход Google не съедает лимит', async () => {
    for (let i = 0; i < 20; i++) {
      const r = await reserveLoginAttempt('ip1', 'google');
      if (!r.limited) await markLoginSuccess(r.id);
    }
    expect((await peekLoginLimit('ip1', 'google')).limited).toBe(false);
  });
  it('глобально 40 неудач за час с разных IP блокируют Google, но не пароль', async () => {
    for (let i = 0; i < 40; i++) await reserveLoginAttempt(`ip${i}`, 'google');
    expect((await peekLoginLimit('fresh', 'google')).limited).toBe(true);
    expect((await peekLoginLimit('fresh', 'password')).limited).toBe(false);
  });
  it('пароль: 5 неудач с IP -> блок (по умолчанию kind=password)', async () => {
    for (let i = 0; i < 5; i++) await reserveLoginAttempt('ip1');
    expect((await reserveLoginAttempt('ip1')).limited).toBe(true);
    expect((await peekLoginLimit('ip1', 'google')).limited).toBe(false);
  });
}, 60000);
