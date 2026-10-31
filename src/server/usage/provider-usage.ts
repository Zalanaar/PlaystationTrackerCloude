// Счётчики исходящих запросов RAWG и HLTB по пользователям и суткам МСК + общий потолок (контракт 24).
// Без env и сети: лимиты приходят аргументом. Fail-open: ошибка БД (нет таблицы до 0017, обрыв) не блокирует провайдера,
// лимиты тогда действуют в пределах процесса (память).
import { eq, and, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { mskDateString } from '@/server/stats/period';

const { providerUsage } = schema;

export type Provider = 'rawg' | 'hltb';
export type ProviderLimits = { userLimit: number; totalLimit: number };
export type ReserveResult = 'ok' | 'user_limit' | 'total_limit';

/** Ключ advisory-блокировки проверки общего потолка провайдеров (отличается от LLM 7204003). */
const USAGE_LOCK = 7204004;

/** Запасной счётчик процесса для fail-open: `${day}|${provider}|${userId}` -> calls. Старые сутки вычищаются. */
const memory = new Map<string, number>();

function memReserve(day: string, provider: Provider, userId: UserId, limits: ProviderLimits): ReserveResult {
  for (const k of memory.keys()) if (!k.startsWith(`${day}|`)) memory.delete(k);
  const key = `${day}|${provider}|${userId}`;
  const mine = memory.get(key) ?? 0;
  let total = 0;
  for (const [k, v] of memory) if (k.startsWith(`${day}|${provider}|`)) total += v;
  if (total >= limits.totalLimit) return 'total_limit';
  if (mine >= limits.userLimit) return 'user_limit';
  memory.set(key, mine + 1);
  return 'ok';
}

/** Только для тестов. */
export function resetProviderUsageMemory(): void {
  memory.clear();
}

/**
 * Атомарно занимает один запрос к провайдеру на сегодня. Проверка и запись под advisory-локом в одной транзакции.
 * Ошибка БД не пробрасывается (fail-open, резерв в памяти процесса).
 */
export async function reserveProviderCall(db: AnyDb, userId: UserId, provider: Provider, now: Date, limits: ProviderLimits): Promise<ReserveResult> {
  const day = mskDateString(now);
  if (limits.totalLimit < 1) return 'total_limit';
  if (limits.userLimit < 1) return 'user_limit';
  try {
    return await db.transaction(async (tx): Promise<ReserveResult> => {
      await tx.execute(sql`select pg_advisory_xact_lock(${USAGE_LOCK})`);
      const [sum] = await tx
        .select({ n: sql<number>`coalesce(sum(${providerUsage.calls}), 0)::int` })
        .from(providerUsage)
        .where(and(eq(providerUsage.day, day), eq(providerUsage.provider, provider)));
      if (Number(sum?.n ?? 0) >= limits.totalLimit) return 'total_limit';
      const rows = await tx
        .insert(providerUsage)
        .values({ userId, day, provider, calls: 1 })
        .onConflictDoUpdate({
          target: [providerUsage.userId, providerUsage.day, providerUsage.provider],
          set: { calls: sql`${providerUsage.calls} + 1` },
          setWhere: sql`${providerUsage.calls} < ${limits.userLimit}`,
        })
        .returning({ calls: providerUsage.calls });
      return rows.length > 0 ? 'ok' : 'user_limit';
    });
  } catch {
    return memReserve(day, provider, userId, limits);
  }
}

/** Сколько запросов пользователя к провайдеру уже занято сегодня (0 при ошибке БД). */
export async function providerUsedToday(db: AnyDb, userId: UserId, provider: Provider, now: Date): Promise<number> {
  try {
    const [r] = await db
      .select({ n: providerUsage.calls })
      .from(providerUsage)
      .where(and(eq(providerUsage.userId, userId), eq(providerUsage.day, mskDateString(now)), eq(providerUsage.provider, provider)));
    return r?.n ?? 0;
  } catch {
    return 0;
  }
}
