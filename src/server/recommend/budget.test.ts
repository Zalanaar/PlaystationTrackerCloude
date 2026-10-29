// Бюджет вызовов LLM (контракт 20.4): потолки по видам, общий предохранитель, возврат при неудаче, пауза после 3 неудач.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { FAIL_STREAK_PAUSE, getFailStreak, isPaused, KIND_LIMITS, recordFailure, releaseCall, reserveCall, resetStreak, usedToday } from './budget';

const { recommendLlmUsage } = schema;
const NOW = new Date('2026-10-29T09:00:00Z');

describe('budget', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(() => t.reset());
  const row = async () => (await t.db.select().from(recommendLlmUsage))[0];

  it('потолки видов: фразы 8, ночная генерация 1, ручных 3', async () => {
    expect(KIND_LIMITS).toEqual({ phrases: 8, discover_auto: 1, discover_manual: 3 });
    const ok = async (kind: 'phrases' | 'discover_auto' | 'discover_manual', n: number) => {
      const res: boolean[] = [];
      for (let i = 0; i < n; i++) res.push(await reserveCall(t.db, kind, 100, NOW));
      return res.filter(Boolean).length;
    };
    expect(await ok('phrases', 12)).toBe(8);
    expect(await ok('discover_auto', 3)).toBe(1);
    expect(await ok('discover_manual', 5)).toBe(3);
    expect(await row()).toMatchObject({ calls: 12, phraseCalls: 8, discoverAutoCalls: 1, discoverManualCalls: 3 });
  });

  it('общий предохранитель ограничивает сумму по всем видам', async () => {
    expect(await reserveCall(t.db, 'phrases', 3, NOW)).toBe(true);
    expect(await reserveCall(t.db, 'phrases', 3, NOW)).toBe(true);
    expect(await reserveCall(t.db, 'discover_manual', 3, NOW)).toBe(true);
    expect(await reserveCall(t.db, 'discover_auto', 3, NOW)).toBe(false);
    expect((await row()).calls).toBe(3);
    expect((await row()).discoverAutoCalls).toBe(0);
  });

  it('лимит 0 ничего не выдаёт', async () => {
    expect(await reserveCall(t.db, 'phrases', 0, NOW)).toBe(false);
    expect(await t.db.select().from(recommendLlmUsage)).toEqual([]);
  });

  it('возврат неудачного вызова освобождает слот; ниже нуля не уходит; чужие сутки не трогает', async () => {
    await reserveCall(t.db, 'discover_manual', 20, NOW);
    await reserveCall(t.db, 'phrases', 20, NOW);
    await releaseCall(t.db, 'discover_manual', NOW);
    await releaseCall(t.db, 'discover_manual', NOW);
    expect(await row()).toMatchObject({ calls: 1, discoverManualCalls: 0, phraseCalls: 1 });
    expect(await usedToday(t.db, 'discover_manual', NOW)).toBe(0);
    expect(await usedToday(t.db, 'phrases', NOW)).toBe(1);
    await releaseCall(t.db, 'phrases', new Date('2026-10-30T09:00:00Z')); // другие сутки: строки нет
    expect(await usedToday(t.db, 'phrases', NOW)).toBe(1);
  });

  it('граница суток МСК: счётчики независимы', async () => {
    expect(await reserveCall(t.db, 'discover_auto', 5, new Date('2026-10-29T20:59:59Z'))).toBe(true);
    expect(await reserveCall(t.db, 'discover_auto', 5, new Date('2026-10-29T20:59:59Z'))).toBe(false);
    expect(await reserveCall(t.db, 'discover_auto', 5, new Date('2026-10-29T21:00:00Z'))).toBe(true);
  });

  it('гонка: 20 параллельных ручных вызовов дают ровно 3', async () => {
    const res = await Promise.all(Array.from({ length: 20 }, () => reserveCall(t.db, 'discover_manual', 50, NOW)));
    expect(res.filter(Boolean)).toHaveLength(3);
    expect((await row()).discoverManualCalls).toBe(3);
  });

  it('серия неудач: 3 подряд = пауза, причина сохраняется, успех и сброс синка обнуляют', async () => {
    expect(await isPaused(t.db)).toBe(false);
    expect(await getFailStreak(t.db)).toEqual({ streak: 0, reason: null });
    for (let i = 1; i <= FAIL_STREAK_PAUSE; i++) {
      expect(await recordFailure(t.db, 'http_500', NOW)).toBe(i);
      expect(await isPaused(t.db)).toBe(i >= FAIL_STREAK_PAUSE);
    }
    expect(await getFailStreak(t.db)).toEqual({ streak: 3, reason: 'http_500' });
    await resetStreak(t.db, NOW);
    expect(await isPaused(t.db)).toBe(false);
    expect((await getFailStreak(t.db)).streak).toBe(0);
  });

  it('причина вне безопасного формата заменяется на unknown (ничего лишнего в БД)', async () => {
    await recordFailure(t.db, 'Bearer gsk_SECRET text with spaces', NOW);
    expect((await getFailStreak(t.db)).reason).toBe('unknown');
  });

  it('сброс без строки состояния безопасен', async () => {
    await resetStreak(t.db, NOW);
    expect(await getFailStreak(t.db)).toEqual({ streak: 0, reason: null });
  });
});
