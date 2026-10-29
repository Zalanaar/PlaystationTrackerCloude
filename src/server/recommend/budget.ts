// Бюджет вызовов LLM (контракт 20.4): счётчики по видам вызова за сутки МСК, возврат при неудаче и пауза после 3 неудач подряд.
// Без env и сети; БД передаётся аргументом. Вызов занимается ДО обращения к провайдеру (атомарно), при неудаче возвращается.
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { mskDateString } from '@/server/stats/period';

const { recommendLlmUsage, recommendLlmState } = schema;

export type LlmCallKind = 'phrases' | 'discover_auto' | 'discover_manual';

/** Потолок вызовов вида за сутки. Общий предохранитель (LLM_DAILY_LIMIT) проверяется отдельно по `calls`. */
export const KIND_LIMITS: Readonly<Record<LlmCallKind, number>> = { phrases: 8, discover_auto: 1, discover_manual: 3 };
/** Столько неудач подряд ставят LLM на паузу до следующего синка. */
export const FAIL_STREAK_PAUSE = 3;

const COLUMN = {
  phrases: recommendLlmUsage.phraseCalls,
  discover_auto: recommendLlmUsage.discoverAutoCalls,
  discover_manual: recommendLlmUsage.discoverManualCalls,
} as const;
const COLUMN_NAME = { phrases: 'phrase_calls', discover_auto: 'discover_auto_calls', discover_manual: 'discover_manual_calls' } as const;

/** Атомарно занимает вызов вида `kind` на сегодня. false = достигнут потолок вида или общий предохранитель `totalLimit`. */
export async function reserveCall(db: AnyDb, kind: LlmCallKind, totalLimit: number, now: Date): Promise<boolean> {
  const col = COLUMN[kind];
  const cap = KIND_LIMITS[kind];
  if (totalLimit < 1 || cap < 1) return false;
  const rows = await db
    .insert(recommendLlmUsage)
    .values({ day: mskDateString(now), calls: 1, [kindKey(kind)]: 1 })
    .onConflictDoUpdate({
      target: recommendLlmUsage.day,
      set: { calls: sql`${recommendLlmUsage.calls} + 1`, [kindKey(kind)]: sql`${col} + 1` },
      setWhere: sql`${recommendLlmUsage.calls} < ${totalLimit} and ${col} < ${cap}`,
    })
    .returning({ calls: recommendLlmUsage.calls });
  return rows.length > 0;
}

function kindKey(kind: LlmCallKind): 'phraseCalls' | 'discoverAutoCalls' | 'discoverManualCalls' {
  return kind === 'phrases' ? 'phraseCalls' : kind === 'discover_auto' ? 'discoverAutoCalls' : 'discoverManualCalls';
}

/** Возвращает ранее занятый вызов (неудача: провайдер не ответил по делу). Не уходит ниже нуля. */
export async function releaseCall(db: AnyDb, kind: LlmCallKind, now: Date): Promise<void> {
  const col = sql.raw(`"${COLUMN_NAME[kind]}"`);
  await db
    .update(recommendLlmUsage)
    .set({ calls: sql`greatest(${recommendLlmUsage.calls} - 1, 0)`, [kindKey(kind)]: sql`greatest(${col} - 1, 0)` })
    // возвращаем только занятое: двойной возврат не должен уменьшать общий счётчик
    .where(and(eq(recommendLlmUsage.day, mskDateString(now)), sql`${col} > 0`));
}

/** Сколько вызовов вида уже занято сегодня. */
export async function usedToday(db: AnyDb, kind: LlmCallKind, now: Date): Promise<number> {
  const [r] = await db.select({ n: COLUMN[kind] }).from(recommendLlmUsage).where(eq(recommendLlmUsage.day, mskDateString(now)));
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
