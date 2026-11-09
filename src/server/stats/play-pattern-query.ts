// Выборка «Когда ты играешь» (контракт 26.3): трофеи периода, сгруппированные в SQL по часу и дню недели в поясе устройства (по умолчанию МСК; Пакет 6, п. 3).
import { and, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { trophySetCounted } from '@/server/collection/visibility';
import { isValidTimeZone, MSK_TZ } from '@/shared/tz';
import { isoDowToIndex, type PatternCell } from './play-pattern';

const { trophies } = schema;

// Литерал, а не параметр: выражение в SELECT и GROUP BY должно совпадать дословно. Пояс проверен isValidTimeZone (без кавычек), иначе Москва.
const tzLiteral = (tz: string | undefined) => sql.raw(`'${isValidTimeZone(tz) ? tz : MSK_TZ}'`);

/** range = [fromUtc, toUtc) по earned_at; null = все трофеи с датой. Те же фильтры, что у trophies.counts (10.1). */
export async function getPlayPatternCells(db: AnyDb, userId: UserId, range: { fromUtc: Date; toUtc: Date } | null, tz?: string): Promise<PatternCell[]> {
  const TZ = tzLiteral(tz);
  const hour = sql<number>`extract(hour from (${trophies.earnedAt} at time zone ${TZ}))::int`;
  const dow = sql<number>`extract(isodow from (${trophies.earnedAt} at time zone ${TZ}))::int`;
  const rows = await db
    .select({ hour, dow, n: sql<number>`count(*)::int` })
    .from(trophies)
    .where(
      and(
        eq(trophies.userId, userId),
        eq(trophies.earned, true),
        isNotNull(trophies.earnedAt),
        range ? gte(trophies.earnedAt, range.fromUtc) : undefined,
        range ? lt(trophies.earnedAt, range.toUtc) : undefined,
        trophySetCounted(trophies.trophySetId, userId),
      ),
    )
    .groupBy(hour, dow);
  return rows.map((r) => ({ hour: r.hour, weekday: isoDowToIndex(r.dow), n: r.n }));
}
