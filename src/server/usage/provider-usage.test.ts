// Счётчики RAWG/HLTB по пользователям: лимиты, общий потолок, изоляция, fail-open (контракт 24).
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { asUserId } from '@/server/auth/user-id';
import { getProviderLimits } from '@/server/env';
import { CatalogError, searchCatalog } from '@/server/catalog/rawg';
import { createTestDb, TEST_USER, type TestDb } from '@/server/sync/test-helpers';
import { providerUsedToday, reserveProviderCall, resetProviderUsageMemory } from './provider-usage';

const { providerUsage, allowedUsers } = schema;
const NOW = new Date('2026-10-31T09:00:00Z');
const U2 = asUserId(2);
const U3 = asUserId(3);
const L = (userLimit: number, totalLimit: number) => ({ userLimit, totalLimit });

describe('provider_usage', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.db.insert(allowedUsers).values([
      { email: 'u2@example.com', role: 'member', status: 'active' },
      { email: 'u3@example.com', role: 'member', status: 'active' },
    ]);
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.db.delete(providerUsage);
    resetProviderUsageMemory();
  });
  const rows = async () => (await t.db.select().from(providerUsage)).map((r) => `${r.userId}:${r.provider}:${r.calls}`).sort();

  it('лимит пользователя: свой счётчик, чужой не затронут', async () => {
    expect(await reserveProviderCall(t.db, TEST_USER, 'rawg', NOW, L(2, 100))).toBe('ok');
    expect(await reserveProviderCall(t.db, TEST_USER, 'rawg', NOW, L(2, 100))).toBe('ok');
    expect(await reserveProviderCall(t.db, TEST_USER, 'rawg', NOW, L(2, 100))).toBe('user_limit');
    expect(await reserveProviderCall(t.db, U2, 'rawg', NOW, L(2, 100))).toBe('ok');
    expect(await providerUsedToday(t.db, TEST_USER, 'rawg', NOW)).toBe(2);
    expect(await providerUsedToday(t.db, U2, 'rawg', NOW)).toBe(1);
    expect(await providerUsedToday(t.db, U3, 'rawg', NOW)).toBe(0);
    expect(await rows()).toEqual(['1:rawg:2', '2:rawg:1']);
  });

  it('общий потолок = сумма пользователей одного провайдера; другой провайдер считается отдельно', async () => {
    expect(await reserveProviderCall(t.db, TEST_USER, 'hltb', NOW, L(10, 3))).toBe('ok');
    expect(await reserveProviderCall(t.db, TEST_USER, 'hltb', NOW, L(10, 3))).toBe('ok');
    expect(await reserveProviderCall(t.db, U2, 'hltb', NOW, L(10, 3))).toBe('ok');
    expect(await reserveProviderCall(t.db, U3, 'hltb', NOW, L(10, 3))).toBe('total_limit');
    expect(await reserveProviderCall(t.db, U3, 'rawg', NOW, L(10, 3))).toBe('ok');
    expect(await rows()).toEqual(['1:hltb:2', '2:hltb:1', '3:rawg:1']);
  });

  it('новые сутки МСК обнуляют счёт; 0 в общем потолке выключает провайдера', async () => {
    expect(await reserveProviderCall(t.db, TEST_USER, 'rawg', NOW, L(1, 10))).toBe('ok');
    expect(await reserveProviderCall(t.db, TEST_USER, 'rawg', NOW, L(1, 10))).toBe('user_limit');
    const next = new Date('2026-11-01T09:00:00Z');
    expect(await reserveProviderCall(t.db, TEST_USER, 'rawg', next, L(1, 10))).toBe('ok');
    expect(await reserveProviderCall(t.db, TEST_USER, 'rawg', next, L(1, 0))).toBe('total_limit');
  });

  it('параллельные занятия не перешагивают общий потолок', async () => {
    const res = await Promise.all(Array.from({ length: 12 }, (_, i) => reserveProviderCall(t.db, [TEST_USER, U2, U3][i % 3], 'rawg', NOW, L(10, 5))));
    expect(res.filter((r) => r === 'ok')).toHaveLength(5);
    const sum = (await t.db.select().from(providerUsage)).reduce((a, r) => a + r.calls, 0);
    expect(sum).toBe(5);
  });

  it('fail-open: таблицы нет (до 0017) — не бросает, лимиты считаются в памяти процесса', async () => {
    await t.pg.execute(sql`alter table provider_usage rename to provider_usage_x`);
    try {
      expect(await reserveProviderCall(t.db, TEST_USER, 'rawg', NOW, L(2, 3))).toBe('ok');
      expect(await reserveProviderCall(t.db, TEST_USER, 'rawg', NOW, L(2, 3))).toBe('ok');
      expect(await reserveProviderCall(t.db, TEST_USER, 'rawg', NOW, L(2, 3))).toBe('user_limit');
      expect(await reserveProviderCall(t.db, U2, 'rawg', NOW, L(2, 3))).toBe('ok');
      expect(await reserveProviderCall(t.db, U3, 'rawg', NOW, L(2, 3))).toBe('total_limit');
      expect(await providerUsedToday(t.db, TEST_USER, 'rawg', NOW)).toBe(0);
    } finally {
      await t.pg.execute(sql`alter table provider_usage_x rename to provider_usage`);
    }
  });

  it('RAWG: при исчерпанном лимите запрос в сеть не уходит (rate_limited), с лимитом уходит', async () => {
    let fetched = 0;
    const fetchImpl = (async () => {
      fetched++;
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as typeof fetch;
    const reserve = async () => (await reserveProviderCall(t.db, TEST_USER, 'rawg', NOW, L(1, 10))) === 'ok';
    await searchCatalog('hades', { apiKey: 'k', fetch: fetchImpl, reserve });
    await expect(searchCatalog('hades', { apiKey: 'k', fetch: fetchImpl, reserve })).rejects.toMatchObject({ reason: 'rate_limited' });
    expect(fetched).toBe(1);
    expect(CatalogError).toBeDefined();
  });

  it('env: умолчания и границы', () => {
    expect(getProviderLimits('rawg', {})).toEqual({ userLimit: 60, totalLimit: 300 });
    expect(getProviderLimits('hltb', {})).toEqual({ userLimit: 300, totalLimit: 1000 });
    expect(getProviderLimits('rawg', { RAWG_USER_DAILY_LIMIT: '5', RAWG_DAILY_LIMIT: '0' })).toEqual({ userLimit: 5, totalLimit: 0 });
    expect(getProviderLimits('hltb', { HLTB_USER_DAILY_LIMIT: 'abc', HLTB_DAILY_LIMIT: '999999' })).toEqual({ userLimit: 300, totalLimit: 10000 });
  });
});
