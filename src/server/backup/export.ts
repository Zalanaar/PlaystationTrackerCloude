// Сборка резервной копии из БД (контракт 20.3). Только чтение, фиксированное число запросов.
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { BACKUP_APP, BACKUP_SCHEMA_VERSION, type BackupFile, type BackupGame } from './format';

const { games, gameStatus, gameReviews, roadmapOrder, roadmapExcluded, gameMonthExclusions, plannedGames, roadmapSettings } = schema;

const lt = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export async function buildBackup(db: AnyDb, userId: UserId, now: Date = new Date()): Promise<BackupFile> {
  const [gameRows, statuses, orders, excluded, months, planned, settings, reviews] = await Promise.all([
    db
      .select({ id: games.id, titleId: games.titleId, name: games.name, duration: games.durationOverrideHours, genres: games.genresOverride, hiddenAt: games.hiddenAt })
      .from(games)
      .where(eq(games.userId, userId)),
    db.select().from(gameStatus).where(eq(gameStatus.userId, userId)),
    db.select().from(roadmapOrder).where(eq(roadmapOrder.userId, userId)),
    db.select().from(roadmapExcluded).where(eq(roadmapExcluded.userId, userId)),
    db.select().from(gameMonthExclusions).where(eq(gameMonthExclusions.userId, userId)),
    db.select().from(plannedGames).where(eq(plannedGames.userId, userId)),
    db.select().from(roadmapSettings).where(eq(roadmapSettings.userId, userId)),
    db.select({ gameId: gameReviews.gameId, rating: gameReviews.rating, note: gameReviews.note }).from(gameReviews).where(eq(gameReviews.userId, userId)),
  ]);
  const reviewBy = new Map(reviews.map((r) => [r.gameId, r]));
  const statusBy = new Map(statuses.map((s) => [s.gameId, s]));
  const orderBy = new Map(orders.map((o) => [o.gameId, o.position]));
  const excludedSet = new Set(excluded.map((e) => e.gameId));
  const monthsBy = new Map<number, string[]>();
  for (const m of months) monthsBy.set(m.gameId, [...(monthsBy.get(m.gameId) ?? []), m.month]);

  const out: BackupGame[] = [];
  for (const g of gameRows) {
    const st = statusBy.get(g.id);
    const ms = monthsBy.get(g.id) ?? [];
    const pos = orderBy.get(g.id) ?? null;
    const rv = reviewBy.get(g.id);
    const has = !!rv || !!st || g.duration !== null || (g.genres !== null && g.genres.length > 0) || g.hiddenAt !== null || pos !== null || excludedSet.has(g.id) || ms.length > 0;
    if (!has) continue;
    out.push({
      titleId: g.titleId,
      name: g.name.slice(0, 300),
      status: st
        ? {
            value: st.status,
            completedAt: st.completedAt ? st.completedAt.toISOString() : null,
            droppedAt: st.droppedAt ? st.droppedAt.toISOString() : null,
            statusChangedAt: st.statusChangedAt.toISOString(),
          }
        : null,
      durationOverrideHours: g.duration,
      genresOverride: g.genres && g.genres.length > 0 ? g.genres : null,
      hiddenAt: g.hiddenAt ? g.hiddenAt.toISOString() : null,
      roadmapPosition: pos,
      roadmapExcluded: excludedSet.has(g.id),
      monthExclusions: [...ms].sort(lt),
      review: rv ? { rating: rv.rating, note: rv.note } : null,
    });
  }
  out.sort((a, b) => lt(a.titleId, b.titleId));

  const s = settings[0];
  return {
    app: BACKUP_APP,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: now.toISOString(),
    games: out,
    plannedGames: [...planned]
      .sort((a, b) => a.id - b.id)
      .map((p) => ({
        title: p.title,
        releaseDate: p.releaseDate,
        coverUrl: p.coverUrl,
        wantAtRelease: p.wantAtRelease,
        hoursManual: p.hoursManual,
        externalSource: p.externalSource as 'rawg' | null,
        externalId: p.externalId,
        status: p.status as 'planned' | 'done' | 'cancelled',
      })),
    roadmapSettings: s ? { year: s.year, hoursPerWeek: s.hoursPerWeek } : null,
  };
}
