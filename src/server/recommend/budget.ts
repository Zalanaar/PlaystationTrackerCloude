// Бюджет вызовов LLM (контракт 20.4): счётчики по видам вызова за сутки МСК, возврат при неудаче и пауза после 3 неудач подряд.
// Без env и сети; БД передаётся аргументом. Вызов занимается ДО обращения к провайдеру (атомарно), при неудаче возвращается.
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { mskDateString } from '@/server/stats/period';

const { recommendLlmUsage, recommendLlmState } = schema;

export type LlmCallKind = 'phrases' | 'discover';

/** Потолок вызовов вида за сутки. Общий предохранитель (LLM_DAILY_LIMIT) проверяется отдельно по `calls`. */
export const KIND_LIMITS: Readonly<Record<LlmCallKind, number>> = { phrases: 8, discover: 1 };
/** Столько неудач подряд ставят LLM на паузу до следующего синка. */
export const FAIL_STREAK_PAUSE = 3;

// «У тебя нет» (Фаза 30) переиспользует ранее неиспользуемую колонку discover_auto_calls (схема не меняется).
const COLUMN = {
  phrases: recommendLlmUsage.phraseCalls,
  discover: recommendLlmUsage.discoverAutoCalls,
} as const;
const COLUMN_NAME = { phrases: 'phrase_calls', discover: 'discover_auto_calls' } as const;
const COLUMN_KEY = { phrases: 'phraseCalls', discover: 'discoverAutoCalls' } as const;

/** Потолок вызовов пользователя за сутки по умолчанию (запас над потолком фраз). */
export const DEFAULT_USER_DAILY_LIMIT = 12;
/** Ключ advisory-блокировки проверки общего потолка (22.13). */
const BUDGET_LOCK = 7204003;

/**
 * Атомарно занимает вызов вида `kind` на сегодня. false = достигнут потолок вида, потолок пользователя `userLimit`
 * или общий потолок `totalLimit` (сумма calls по всем пользователям за сутки, контракт 22.13).
 * Проверка и запись идут в одной транзакции под advisory-локом: параллельные синки и запросы не перешагнут общий потолок.
 */
export async function reserveCall(db: AnyDb, userId: UserId, kind: LlmCallKind, totalLimit: number, now: Date, userLimit: number = DEFAULT_USER_DAILY_LIMIT): Promise<boolean> {
  const col = COLUMN[kind];
  const cap = KIND_LIMITS[kind];
  if (totalLimit < 1 || userLimit < 1 || cap < 1) return false;
  const day = mskDateString(now);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${BUDGET_LOCK})`);
    const [sum] = await tx.select({ n: sql<number>`coalesce(sum(${recommendLlmUsage.calls}), 0)::int` }).from(recommendLlmUsage).where(eq(recommendLlmUsage.day, day));
    if (Number(sum?.n ?? 0) >= totalLimit) return false;
    const rows = await tx
      .insert(recommendLlmUsage)
      .values({ userId, day, calls: 1, [COLUMN_KEY[kind]]: 1 })
      .onConflictDoUpdate({
        target: [recommendLlmUsage.userId, recommendLlmUsage.day],
        set: { calls: sql`${recommendLlmUsage.calls} + 1`, [COLUMN_KEY[kind]]: sql`${col} + 1` },
        setWhere: sql`${recommendLlmUsage.calls} < ${userLimit} and ${col} < ${cap}`,
      })
      .returning({ calls: recommendLlmUsage.calls });
    return rows.length > 0;
  });
}

/** Возвращает ранее занятый вызов (неудача: провайдер не ответил по делу). Не уходит ниже нуля. */
export async function releaseCall(db: AnyDb, userId: UserId, kind: LlmCallKind, now: Date): Promise<void> {
  const col = sql.raw(`"${COLUMN_NAME[kind]}"`);
  await db
    .update(recommendLlmUsage)
    .set({ calls: sql`greatest(${recommendLlmUsage.calls} - 1, 0)`, [COLUMN_KEY[kind]]: sql`greatest(${col} - 1, 0)` })
    // возвращаем только занятое: двойной возврат не должен уменьшать общий счётчик
    .where(and(eq(recommendLlmUsage.userId, userId), eq(recommendLlmUsage.day, mskDateString(now)), sql`${col} > 0`));
}

/** Сколько вызовов вида уже занято сегодня. */
export async function usedToday(db: AnyDb, userId: UserId, kind: LlmCallKind, now: Date): Promise<number> {
  const [r] = await db.select({ n: COLUMN[kind] }).from(recommendLlmUsage).where(and(eq(recommendLlmUsage.userId, userId), eq(recommendLlmUsage.day, mskDateString(now))));
  return r?.n ?? 0;
}

export async function getFailStreak(db: AnyDb): Promise<{ streak: number; reason: string | null }> {
  const [r] = await db.select().from(recommendLlmState).where(eq(recommendLlmState.id, 1));
  return { streak: r?.failStreak ?? 0, reason: r?.lastReason ?? null };
}

export async function isPaused(db: AnyDb): Promise<boolean> {
  return (await getFailStreak(db)).streak >= FAIL_STREAK_PAUSE;
}

const REASON_RE = /^[a-z0-9_.:-]{1,90}$/;

/** Неудача: счётчик подряд +1. Возвращает новое значение. Причина хранится только в безопасном формате. */
export async function recordFailure(db: AnyDb, reason: string, now: Date): Promise<number> {
  const safe = REASON_RE.test(reason) ? reason : 'unknown';
  const [r] = await db
    .insert(recommendLlmState)
    .values({ id: 1, failStreak: 1, lastReason: safe, updatedAt: now })
    .onConflictDoUpdate({
      target: recommendLlmState.id,
      set: { failStreak: sql`${recommendLlmState.failStreak} + 1`, lastReason: safe, updatedAt: now },
    })
    .returning({ n: recommendLlmState.failStreak });
  return r?.n ?? 1;
}

/** Успех или начало синка: цепочка неудач сбрасывается. Строки нет = ничего не делаем. */
export async function resetStreak(db: AnyDb, now: Date): Promise<void> {
  await db.update(recommendLlmState).set({ failStreak: 0, updatedAt: now }).where(eq(recommendLlmState.id, 1));
}
