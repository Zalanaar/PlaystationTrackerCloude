// Лимиты LLM по пользователям и общий потолок LLM_DAILY_LIMIT как сумма (контракт 22.13).
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { asUserId } from '@/server/auth/user-id';
import { getLlmEnv } from '@/server/env';
import { createTestDb, TEST_USER, type TestDb } from '@/server/sync/test-helpers';
import { reserveCall, releaseCall, usedToday } from './budget';

const { recommendLlmUsage, allowedUsers } = schema;
const NOW = new Date('2026-10-31T09:00:00Z');
const U2 = asUserId(2);
const U3 = asUserId(3);

describe('LLM: лимиты по пользователям и общий потолок', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb({ migrations: 15 });
    // состояние после 0015: PK (user_id, day) вместо PK day; unique (user_id, day) из 0014 остаётся
    await t.pg.execute(sql`alter table recommend_llm_usage drop constraint recommend_llm_usage_pkey`);
    await t.db.insert(allowedUsers).values([
      { email: 'u2@example.com', role: 'member', status: 'active' },
      { email: 'u3@example.com', role: 'member', status: 'active' },
    ]);
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.db.delete(recommendLlmUsage);
  });
  const rows = async () => t.db.select().from(recommendLlmUsage);

  it('общий потолок считается по сумме пользователей: третий пользователь упирается в потолок, хотя свой лимит не выбран', async () => {
    expect(await reserveCall(t.db, TEST_USER, 'phrases', 3, NOW)).toBe(true);
    expect(await reserveCall(t.db, TEST_USER, 'phrases', 3, NOW)).toBe(true);
    expect(await reserveCall(t.db, U2, 'phrases', 3, NOW)).toBe(true);
    // сумма = 3 = потолок
    expect(await reserveCall(t.db, U3, 'phrases', 3, NOW)).toBe(false);
    expect(await reserveCall(t.db, TEST_USER, 'discover_manual', 3, NOW)).toBe(false);
    expect(await reserveCall(t.db, U2, 'discover_auto', 3, NOW)).toBe(false);
    const byUser = Object.fromEntries((await rows()).map((r) => [r.userId, r.calls]));
    expect(byUser).toEqual({ 1: 2, 2: 1 });
  });

  it('потолок вида и лимит пользователя действуют на каждого отдельно', async () => {
    for (let i = 0; i < 8; i++) expect(await reserveCall(t.db, TEST_USER, 'phrases', 100, NOW)).toBe(true);
    expect(await reserveCall(t.db, TEST_USER, 'phrases', 100, NOW)).toBe(false); // потолок вида 8
    expect(await reserveCall(t.db, U2, 'phrases', 100, NOW)).toBe(true); // у второго он свой
    expect(await usedToday(t.db, TEST_USER, 'phrases', NOW)).toBe(8);
    expect(await usedToday(t.db, U2, 'phrases', NOW)).toBe(1);
  });

  it('LLM_USER_DAILY_LIMIT: пользователь не выбирает больше своего лимита, остальным остаётся общий пул', async () => {
    expect(await reserveCall(t.db, TEST_USER, 'phrases', 100, NOW, 2)).toBe(true);
    expect(await reserveCall(t.db, TEST_USER, 'discover_manual', 100, NOW, 2)).toBe(true);
    expect(await reserveCall(t.db, TEST_USER, 'discover_auto', 100, NOW, 2)).toBe(false);
    expect(await reserveCall(t.db, U2, 'discover_auto', 100, NOW, 2)).toBe(true);
  });

  it('возврат вызова одного пользователя освобождает общий пул и не трогает чужой счётчик', async () => {
    await reserveCall(t.db, TEST_USER, 'phrases', 2, NOW);
    await reserveCall(t.db, U2, 'phrases', 2, NOW);
    expect(await reserveCall(t.db, U3, 'phrases', 2, NOW)).toBe(false);
    await releaseCall(t.db, TEST_USER, 'phrases', NOW);
    expect(await reserveCall(t.db, U3, 'phrases', 2, NOW)).toBe(true);
    expect(await usedToday(t.db, U2, 'phrases', NOW)).toBe(1);
  });

  it('новые сутки МСК: потолок обнуляется для всех', async () => {
    await reserveCall(t.db, TEST_USER, 'phrases', 1, NOW);
    expect(await reserveCall(t.db, U2, 'phrases', 1, NOW)).toBe(false);
    expect(await reserveCall(t.db, U2, 'phrases', 1, new Date('2026-10-31T21:00:00Z'))).toBe(true);
  });

  it('параллельные вызовы разных пользователей не перешагивают общий потолок', async () => {
    const results = await Promise.all([TEST_USER, U2, U3, TEST_USER, U2, U3].map((u) => reserveCall(t.db, u, 'phrases', 4, NOW)));
    expect(results.filter(Boolean)).toHaveLength(4);
    expect((await rows()).reduce((s, r) => s + r.calls, 0)).toBe(4);
  });
});

describe('getLlmEnv: LLM_USER_DAILY_LIMIT', () => {
  it('по умолчанию 12, зажим 1..200 (0 -> 1), LLM_DAILY_LIMIT остаётся общим', () => {
    const base = { LLM_PROVIDER: 'groq', LLM_API_KEY: 'k' };
    expect(getLlmEnv(base)).toMatchObject({ dailyLimit: 20, userDailyLimit: 12 });
    expect(getLlmEnv({ ...base, LLM_USER_DAILY_LIMIT: '5', LLM_DAILY_LIMIT: '60' })).toMatchObject({ dailyLimit: 60, userDailyLimit: 5 });
    expect(getLlmEnv({ ...base, LLM_USER_DAILY_LIMIT: '0' })!.userDailyLimit).toBe(1);
    expect(getLlmEnv({ ...base, LLM_USER_DAILY_LIMIT: '9999' })!.userDailyLimit).toBe(200);
  });
});
