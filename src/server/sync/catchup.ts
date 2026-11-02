// Догоняющий обход (надёжность ночного синка): watchdog раз в сутки находит первого пользователя, у которого ночной синк
// не прошёл, и запускает обход очереди с него. Запуски kind='hltb' не учитываются.
import { and, desc, eq, ne } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';

const { syncRuns } = schema;

/**
 * Порог давности успешного синка. Watchdog идёт в 16:00 UTC, ночной cron в 20:00 UTC (точность cron Hobby до часа),
 * поэтому при нормальной работе давность ~19–21 ч; больше 26 ч = прошлый ночной обход до пользователя не дошёл.
 */
export const CATCHUP_AFTER_MS = 26 * 3_600_000;

/** id первого (по возрастанию) пользователя без успешного синка за CATCHUP_AFTER_MS или null. */
export async function findCatchupStart(db: AnyDb, users: ReadonlyArray<{ id: number }>, now: Date = new Date()): Promise<number | null> {
  const sorted = [...users].sort((a, b) => a.id - b.id);
  for (const u of sorted) {
    const [ok] = await db
      .select({ at: syncRuns.finishedAt, startedAt: syncRuns.startedAt })
      .from(syncRuns)
      .where(and(eq(syncRuns.userId, u.id), ne(syncRuns.kind, 'hltb'), eq(syncRuns.status, 'success')))
      .orderBy(desc(syncRuns.startedAt), desc(syncRuns.id))
      .limit(1);
    const at = ok ? (ok.at ?? ok.startedAt) : null;
    if (!at || now.getTime() - at.getTime() > CATCHUP_AFTER_MS) return u.id;
  }
  return null;
}
