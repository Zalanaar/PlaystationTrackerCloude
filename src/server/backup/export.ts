// Сборка резервной копии из БД (контракт 20.3). Только чтение, фиксированное число запросов.
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { BACKUP_APP, BACKUP_SCHEMA_VERSION, type BackupFile, type BackupGame } from './format';

const { games, gameStatus, roadmapOrder, roadmapExcluded, gameMonthExclusions, plannedGames, roadmapSettings } = schema;

const lt = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export async function buildBackup(db: AnyDb, now: Date = new Date()): Promise<BackupFile> {
  const [gameRows, statuses, orders, excluded, months, planned, settings] = await Promise.all([
    db
      .select({ id: games.id, titleId: games.titleId, name: games.name, duration: games.durationOverrideHours, genres: games.genresOverride, hiddenAt: games.hiddenAt })
      .from(games),
    db.select().from(gameStatus),
    db.select().from(roadmapOrder),
    db.select().from(roadmapExcluded),
    db.select().from(gameMonthExclusions),
    db.select().from(plannedGames),
    db.select().from(roadmapSettings),
  ]);
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
    const has = !!st || g.duration !== null || (g.genres !== null && g.genres.length > 0) || g.hiddenAt !== null || pos !== null || excludedSet.has(g.id) || ms.length > 0;
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
