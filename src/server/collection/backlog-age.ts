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

export type BacklogAgeItem = {
  gameId: number; since: string; source: 'played' | 'status';
  /** Идея 5 («Чистка бэклога»): наиграно, с. Необязательное в типе (старые ответы и фикстуры). */
  playSeconds?: number;
};

/** Идея 5: кандидат в «Чистку» — в бэклоге не меньше 2 лет и наиграно меньше часа. */
export const CLEANUP_MIN_DAYS = 730;
export const CLEANUP_MAX_PLAY_SECONDS = 3600;
export const isCleanupCandidate = (days: number, playSeconds: number) => days >= CLEANUP_MIN_DAYS && playSeconds < CLEANUP_MAX_PLAY_SECONDS;
export type BacklogAgeResponse = {
  items: BacklogAgeItem[];
  summary: {
    count: number;
    /** медиана возраста в днях; null — бэклог пуст */
    medianDays: number | null;
    /** сколько игр в бэклоге дольше года */
    overYear: number;
    oldest: { gameId: number; title: string; since: string } | null;
    /** Идея 5: сколько игр подходят для «Чистки». Необязательное в типе (старые ответы и фикстуры). */
    cleanup?: number;
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
    .select({ id: games.id, title: games.name, played: games.firstPlayedAt, changed: gameStatus.statusChangedAt, secs: games.playDurationSeconds })
    .from(games)
    .innerJoin(gameStatus, and(eq(gameStatus.gameId, games.id), eq(gameStatus.userId, userId)))
    .where(and(eq(games.userId, userId), backlogGameWhere()))
    .orderBy(sql`lower(${games.name})`, games.id);
  const items: (BacklogAgeItem & { title: string; at: number })[] = rows.map((r) => {
    const played = r.played && r.played.getTime() < r.changed.getTime();
    const at = Math.min(now.getTime(), (played ? r.played! : r.changed).getTime());
    return { gameId: r.id, title: r.title, since: new Date(at).toISOString(), source: played ? 'played' : 'status', at, playSeconds: r.secs ?? 0 };
  });
  const days = items.map((i) => Math.floor((now.getTime() - i.at) / DAY));
  const oldest = items.reduce<(typeof items)[number] | null>((a, b) => (a === null || b.at < a.at ? b : a), null);
  return {
    items: items.map(({ gameId, since, source, playSeconds }) => ({ gameId, since, source, playSeconds })),
    summary: {
      count: items.length,
      medianDays: median(days),
      overYear: days.filter((d) => d >= 365).length,
      cleanup: items.filter((it, i) => isCleanupCandidate(days[i], it.playSeconds ?? 0)).length,
      oldest: oldest ? { gameId: oldest.gameId, title: oldest.title, since: oldest.since } : null,
    },
  };
}
