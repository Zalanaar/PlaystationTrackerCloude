// П12.4 «Возраст бэклога» (GET /api/collection/backlog-age): сколько игры лежат в бэклоге.
// Отсчёт: первый запуск (PSN first_played_at), если он раньше перевода в бэклог, иначе момент перевода (status_changed_at).
// Те же игры, что в числе «бэклог» (видимые, статус backlog). Для строк бэклога — карта id → дата, плюс сводка.
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { backlogGameWhere } from './backlog';

const { games, gameStatus } = schema;
const DAY = 86_400_000;

export type BacklogAgeItem = { gameId: number; since: string; source: 'played' | 'status' };
export type BacklogAgeResponse = {
  items: BacklogAgeItem[];
  summary: {
    count: number;
    /** медиана возраста в днях; null — бэклог пуст */
    medianDays: number | null;
    /** сколько игр в бэклоге дольше года */
    overYear: number;
    oldest: { gameId: number; title: string; since: string } | null;
  };
};

export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export async function getBacklogAge(db: AnyDb, userId: UserId, now: Date): Promise<BacklogAgeResponse> {
  const rows = await db
    .select({ id: games.id, title: games.name, played: games.firstPlayedAt, changed: gameStatus.statusChangedAt })
    .from(games)
    .innerJoin(gameStatus, and(eq(gameStatus.gameId, games.id), eq(gameStatus.userId, userId)))
    .where(and(eq(games.userId, userId), backlogGameWhere()))
    .orderBy(sql`lower(${games.name})`, games.id);
  const items: (BacklogAgeItem & { title: string; at: number })[] = rows.map((r) => {
    const played = r.played && r.played.getTime() < r.changed.getTime();
    const at = Math.min(now.getTime(), (played ? r.played! : r.changed).getTime());
    return { gameId: r.id, title: r.title, since: new Date(at).toISOString(), source: played ? 'played' : 'status', at };
  });
  const days = items.map((i) => Math.floor((now.getTime() - i.at) / DAY));
  const oldest = items.reduce<(typeof items)[number] | null>((a, b) => (a === null || b.at < a.at ? b : a), null);
  return {
    items: items.map(({ gameId, since, source }) => ({ gameId, since, source })),
    summary: {
      count: items.length,
      medianDays: median(days),
      overYear: days.filter((d) => d >= 365).length,
      oldest: oldest ? { gameId: oldest.gameId, title: oldest.title, since: oldest.since } : null,
    },
  };
}
