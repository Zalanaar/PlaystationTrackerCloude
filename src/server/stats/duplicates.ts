// Дубли игр в расчётах часов (контракт 25.3): снимки версий сливаются в ряд главной, сумма часов за период не меняется.
import { and, eq, isNotNull } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import type { Snapshot } from './hours';

const { games } = schema;

/** id дубля -> id главной (только пары текущего пользователя). */
export type DuplicateMap = ReadonlyMap<number, number>;

export async function getDuplicateMap(db: AnyDb, userId: UserId): Promise<DuplicateMap> {
  const rows = await db
    .select({ id: games.id, of: games.duplicateOfGameId })
    .from(games)
    .where(and(eq(games.userId, userId), isNotNull(games.duplicateOfGameId)));
  return new Map(rows.flatMap((r) => (r.of === null ? [] : [[r.id, r.of] as const])));
}

/**
 * Сливает снимки версий в ряд главной: на каждую дату сумма последних известных значений версий,
 * до первого снимка версии берётся её первое значение (позднее появление версии не даёт «скачка» часов).
 * Игры вне dup остаются как есть. Результат отсортирован по (gameId, date).
 */
export function mergeDuplicateSnapshots(snaps: readonly Snapshot[], dup: DuplicateMap): Snapshot[] {
  if (dup.size === 0) return [...snaps];
  const primaries = new Set(dup.values());
  const groups = new Map<number, Map<number, Snapshot[]>>(); // главная -> версия -> снимки
  const rest: Snapshot[] = [];
  for (const s of snaps) {
    const primary = dup.get(s.gameId) ?? (primaries.has(s.gameId) ? s.gameId : null);
    if (primary === null) {
      rest.push(s);
      continue;
    }
    const byVersion = groups.get(primary) ?? new Map<number, Snapshot[]>();
    groups.set(primary, byVersion);
    const arr = byVersion.get(s.gameId) ?? [];
    arr.push(s);
    byVersion.set(s.gameId, arr);
  }
  const out = [...rest];
  for (const [primary, byVersion] of groups) {
    const series = [...byVersion.values()].map((a) => [...a].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0)));
    const dates = [...new Set(series.flatMap((a) => a.map((s) => s.date)))].sort();
    for (const date of dates) {
      let total = 0;
      for (const a of series) {
        let v = a[0].seconds;
        for (const s of a) {
          if (s.date > date) break;
          v = s.seconds;
        }
        total += v;
      }
      out.push({ gameId: primary, date, seconds: total });
    }
  }
  return out;
}
