import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { evaluateLimit, GLOBAL_LIMIT, type LimitResult } from './limiter';

const { loginAttempts } = schema;

// Произвольный константный ключ advisory lock для сериализации проверки лимита входа.
const LOCK_KEY = 7_204_001;

export type Reservation = { limited: true; retryAfterSeconds: number } | { limited: false; id: number };

/**
 * Атомарно: под transaction-level advisory lock считает неудачи, и если лимит не исчерпан,
 * сразу записывает попытку как неудачную (success=false) ДО сравнения пароля.
 * Параллельные запросы сериализуются, каждый видит попытки предыдущих.
 * Заблокированный запрос ничего не пишет (иначе блокировку можно продлевать).
 */
export async function reserveLoginAttempt(ipHash: string, now: Date = new Date()): Promise<Reservation> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY})`);
    await tx.delete(loginAttempts).where(lt(loginAttempts.attemptedAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)));
    const since = new Date(now.getTime() - GLOBAL_LIMIT.windowMs);
    const rows = await tx
      .select({ ipHash: loginAttempts.ipHash, at: loginAttempts.attemptedAt })
      .from(loginAttempts)
      .where(and(eq(loginAttempts.success, false), gte(loginAttempts.attemptedAt, since)));
    const limit: LimitResult = evaluateLimit(
      rows.filter((r) => r.ipHash === ipHash).map((r) => r.at),
      rows.map((r) => r.at),
      now,
    );
    if (limit.limited) return limit;
    const [row] = await tx.insert(loginAttempts).values({ ipHash, success: false, attemptedAt: now }).returning({ id: loginAttempts.id });
    return { limited: false as const, id: row.id };
  });
}

/** Верный пароль: резервная запись перестаёт считаться неудачей (контракт 3.3). */
export async function markLoginSuccess(id: number): Promise<void> {
  await getDb().update(loginAttempts).set({ success: true }).where(eq(loginAttempts.id, id));
}
