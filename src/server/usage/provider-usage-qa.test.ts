// QA хвостов 2026-10-31: граница суток МСК, изоляция providerUsedToday, лимит пользователя 0, провайдеры в памяти.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { asUserId } from '@/server/auth/user-id';
import { createTestDb, TEST_USER, type TestDb } from '@/server/sync/test-helpers';
import { providerUsedToday, reserveProviderCall, resetProviderUsageMemory } from './provider-usage';

const { providerUsage, allowedUsers } = schema;
const U2 = asUserId(2);
const L = (userLimit: number, totalLimit: number) => ({ userLimit, totalLimit });

describe('provider_usage QA', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.db.insert(allowedUsers).values([{ email: 'u2@example.com', role: 'member', status: 'active' }]);
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.db.delete(providerUsage);
    resetProviderUsageMemory();
  });

  it('граница суток МСК: 20:59:59Z и 21:00:00Z — разные сутки', async () => {
    const before = new Date('2026-10-31T20:59:59Z');
    const after = new Date('2026-10-31T21:00:00Z');
    expect(await reserveProviderCall(t.db, TEST_USER, 'rawg', before, L(1, 10))).toBe('ok');
    expect(await reserveProviderCall(t.db, TEST_USER, 'rawg', before, L(1, 10))).toBe('user_limit');
    expect(await reserveProviderCall(t.db, TEST_USER, 'rawg', after, L(1, 10))).toBe('ok');
    const days = (await t.db.select().from(providerUsage)).map((r) => r.day).sort();
    expect(days).toEqual(['2026-10-31', '2026-11-01']);
  });

  it('лимит пользователя 0 выключает провайдера без записи в БД', async () => {
    expect(await reserveProviderCall(t.db, TEST_USER, 'hltb', new Date('2026-10-31T09:00:00Z'), L(0, 10))).toBe('user_limit');
    expect(await t.db.select().from(providerUsage)).toHaveLength(0);
  });

  it('providerUsedToday не смешивает пользователей, провайдеров и сутки', async () => {
    const now = new Date('2026-10-31T09:00:00Z');
    await reserveProviderCall(t.db, TEST_USER, 'rawg', now, L(5, 50));
    await reserveProviderCall(t.db, U2, 'rawg', now, L(5, 50));
    await reserveProviderCall(t.db, U2, 'rawg', now, L(5, 50));
    await reserveProviderCall(t.db, U2, 'hltb', now, L(5, 50));
    expect(await providerUsedToday(t.db, TEST_USER, 'rawg', now)).toBe(1);
    expect(await providerUsedToday(t.db, U2, 'rawg', now)).toBe(2);
    expect(await providerUsedToday(t.db, U2, 'hltb', now)).toBe(1);
    expect(await providerUsedToday(t.db, U2, 'rawg', new Date('2026-11-01T09:00:00Z'))).toBe(0);
  });

  it('общий потолок считает только сегодняшние сутки: вчерашние вызовы не занимают потолок', async () => {
    const yesterday = new Date('2026-10-30T09:00:00Z');
    const today = new Date('2026-10-31T09:00:00Z');
    for (let i = 0; i < 3; i++) await reserveProviderCall(t.db, TEST_USER, 'rawg', yesterday, L(10, 3));
    expect(await reserveProviderCall(t.db, TEST_USER, 'rawg', yesterday, L(10, 3))).toBe('total_limit');
    expect(await reserveProviderCall(t.db, U2, 'rawg', today, L(10, 3))).toBe('ok');
  });
});
