// Чтение и запись данных роадмапа (контракт 17). Расчёт в чистых модулях, здесь только выборки и мутации.
import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { effectiveDuration } from '@/server/collection/duration';
import { gameVisible } from '@/server/collection/visibility';
import { groupSnapshots, type Snapshot } from '@/server/stats/hours';
import { mskDate, mskDateString } from '@/server/stats/period';
import { yearBounds } from './dates';
import { buildPlan, isValidBudget } from './plan';
import { computeProgress } from './progress';
import type { PlannedGameDto, PlannedGameStatus, RoadmapEntry, RoadmapResponse, SettingsView } from './types';
import type { PlannedCreate, PlannedPatch } from './validation';

const { games, gameStatus, playtimeSnapshots: ps, plannedGames, roadmapOrder, roadmapSettings } = schema;

export class NotFoundError extends Error {}
export class DuplicatePlannedError extends Error {
  constructor(readonly existingId: number | null) {
    super('planned_duplicate');
  }
}
export class UnknownGamesError extends Error {
  constructor(readonly ids: number[]) {
    super('unknown_games');
  }
}
export class WantNeedsDateError extends Error {}

const SETTINGS_ID = 1;

export async function getSettings(db: AnyDb, now: Date = new Date()): Promise<SettingsView> {
  const [row] = await db.select().from(roadmapSettings).where(eq(roadmapSettings.id, SETTINGS_ID));
  if (!row) return { year: mskDate(now).year, hoursPerWeek: null, configured: false };
  return { year: row.year, hoursPerWeek: row.hoursPerWeek, configured: true };
}

export async function putSettings(db: AnyDb, v: { year: number; hoursPerWeek: number }): Promise<SettingsView> {
  const now = new Date();
  await db
    .insert(roadmapSettings)
    .values({ id: SETTINGS_ID, year: v.year, hoursPerWeek: v.hoursPerWeek, updatedAt: now })
    .onConflictDoUpdate({ target: roadmapSettings.id, set: { year: v.year, hoursPerWeek: v.hoursPerWeek, updatedAt: now } });
  return { year: v.year, hoursPerWeek: v.hoursPerWeek, configured: true };
}

type PlannedRow = typeof plannedGames.$inferSelect;

const toDto = (r: PlannedRow): PlannedGameDto => ({
  id: r.id,
  title: r.title,
  releaseDate: r.releaseDate,
  coverUrl: r.coverUrl,
  wantAtRelease: r.wantAtRelease,
  hoursManual: r.hoursManual,
  externalSource: r.externalSource === 'rawg' ? 'rawg' : null,
  externalId: r.externalId,
  status: r.status as PlannedGameStatus,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

export async function listPlanned(db: AnyDb, status: PlannedGameStatus | 'all'): Promise<PlannedGameDto[]> {
  const rows = await db
    .select()
    .from(plannedGames)
    .where(status === 'all' ? undefined : eq(plannedGames.status, status))
    .orderBy(sql`${plannedGames.releaseDate} asc nulls last`, asc(plannedGames.id));
  return rows.map(toDto);
}

/** Уникальное нарушение Postgres (23505), в том числе внутри DrizzleQueryError.cause. */
function isUniqueViolation(e: unknown): boolean {
  for (let cur: unknown = e, i = 0; cur && i < 5; i++) {
    if (typeof cur === 'object' && (cur as { code?: unknown }).code === '23505') return true;
    cur = (cur as { cause?: unknown } | null)?.cause;
  }
  return false;
}

export async function createPlanned(db: AnyDb, v: PlannedCreate): Promise<PlannedGameDto> {
  if (v.externalSource !== null && v.externalId !== null) {
    const [dup] = await db
      .select({ id: plannedGames.id })
      .from(plannedGames)
      .where(and(eq(plannedGames.externalSource, v.externalSource), eq(plannedGames.externalId, v.externalId)));
    if (dup) throw new DuplicatePlannedError(dup.id);
  }
  try {
    const [row] = await db.insert(plannedGames).values(v).returning();
    return toDto(row);
  } catch (e) {
    if (isUniqueViolation(e)) throw new DuplicatePlannedError(null);
    throw e;
  }
}

export async function updatePlanned(db: AnyDb, id: number, patch: PlannedPatch): Promise<PlannedGameDto> {
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(plannedGames).where(eq(plannedGames.id, id)).for('update');
    if (!cur) throw new NotFoundError('Игра не найдена.');
    const want = patch.wantAtRelease ?? cur.wantAtRelease;
    const date = patch.releaseDate !== undefined ? patch.releaseDate : cur.releaseDate;
    if (want && date === null) throw new WantNeedsDateError();
    const [row] = await tx
      .update(plannedGames)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(plannedGames.id, id))
      .returning();
    return toDto(row);
  });
}

export async function deletePlanned(db: AnyDb, id: number): Promise<void> {
  const rows = await db.delete(plannedGames).where(eq(plannedGames.id, id)).returning({ id: plannedGames.id });
  if (!rows.length) throw new NotFoundError('Игра не найдена.');
}

/** 17.8: полная замена порядка очереди одной транзакцией. Неизвестные id = UnknownGamesError. */
export async function saveOrder(db: AnyDb, gameIds: readonly number[]): Promise<number[]> {
  return db.transaction(async (tx) => {
    if (gameIds.length) {
      const found = await tx.select({ id: games.id }).from(games).where(inArray(games.id, [...gameIds]));
      const have = new Set(found.map((r) => r.id));
      const unknown = gameIds.filter((id) => !have.has(id));
      if (unknown.length) throw new UnknownGamesError(unknown);
    }
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('roadmap_order'))`);
    // Строки игр, ушедших из бэклога, не трогаем (по ним считается прогресс, 17.6): чистим только игры из списка и текущий бэклог.
    const backlogIds = tx.select({ id: gameStatus.gameId }).from(gameStatus).where(eq(gameStatus.status, 'backlog'));
    await tx.delete(roadmapOrder).where(or(inArray(roadmapOrder.gameId, backlogIds), gameIds.length ? inArray(roadmapOrder.gameId, [...gameIds]) : undefined));
    if (gameIds.length) {
      const now = new Date();
      await tx.insert(roadmapOrder).values(gameIds.map((gameId, position) => ({ gameId, position, updatedAt: now })));
    }
    return [...gameIds];
  });
}

/** Очередь бэклога: видимые игры со статусом backlog; сначала ручной порядок, затем без позиции по дате попадания в бэклог. */
export async function getBacklogEntries(db: AnyDb): Promise<RoadmapEntry[]> {
  const rows = await db
    .select({ id: games.id, name: games.name, imageUrl: games.imageUrl, override: games.durationOverrideHours, main: games.hltbMainHours })
    .from(games)
    .innerJoin(gameStatus, eq(gameStatus.gameId, games.id))
    .leftJoin(roadmapOrder, eq(roadmapOrder.gameId, games.id))
    .where(and(eq(gameStatus.status, 'backlog'), isNull(games.hiddenAt)))
    .orderBy(sql`${roadmapOrder.position} asc nulls last`, asc(gameStatus.statusChangedAt), asc(games.id));
  return rows.map((r) => {
    const d = effectiveDuration({ override: r.override, main: r.main });
    return {
      key: `g:${r.id}`, kind: 'backlog' as const, gameId: r.id, plannedId: null, title: r.name, coverUrl: r.imageUrl,
      hours: d.hours, hoursSource: d.source, releaseDate: null, wantAtRelease: false,
    };
  });
}

export async function getPlannedEntries(db: AnyDb): Promise<RoadmapEntry[]> {
  const rows = await db.select().from(plannedGames).where(eq(plannedGames.status, 'planned')).orderBy(asc(plannedGames.id));
  return rows.map((r) => {
    const release = r.wantAtRelease && r.releaseDate !== null;
    return {
      key: `p:${r.id}`, kind: release ? ('release' as const) : ('planned' as const), gameId: null, plannedId: r.id, title: r.title, coverUrl: r.coverUrl,
      hours: r.hoursManual, hoursSource: r.hoursManual === null ? null : ('manual' as const), releaseDate: r.releaseDate, wantAtRelease: r.wantAtRelease,
    };
  });
}

/** Снимки видимых игр за год + по одному базовому снимку до года (как в статистике) и самая ранняя дата снимка. */
async function getSnapshots(db: AnyDb, year: number): Promise<{ snapshots: Snapshot[]; first: string | null }> {
  const { from, to } = yearBounds(year);
  const [inYear, bases, first] = await Promise.all([
    db
      .select({ gameId: ps.gameId, date: ps.snapshotDate, seconds: ps.playDurationSeconds })
      .from(ps)
      .where(and(gte(ps.snapshotDate, from), sql`${ps.snapshotDate} <= ${to}`, gameVisible(ps.gameId))),
    db
      .selectDistinctOn([ps.gameId], { gameId: ps.gameId, date: ps.snapshotDate, seconds: ps.playDurationSeconds })
      .from(ps)
      .where(and(lt(ps.snapshotDate, from), gameVisible(ps.gameId)))
      .orderBy(ps.gameId, desc(ps.snapshotDate)),
    db.select({ d: sql<string | null>`min(${ps.snapshotDate})` }).from(ps),
  ]);
  return { snapshots: [...bases, ...inYear], first: first[0]?.d ?? null };
}

/** GET /api/roadmap: план на лету (17.5). */
export async function getRoadmap(db: AnyDb, now: Date = new Date()): Promise<RoadmapResponse> {
  const today = mskDateString(now);
  const [settings, backlog, planned] = await Promise.all([getSettings(db, now), getBacklogEntries(db), getPlannedEntries(db)]);
  const plan = buildPlan({ year: settings.year, hoursPerWeek: settings.hoursPerWeek, backlog, planned });
  let progress = null;
  if (plan.status === 'ok' && isValidBudget(settings.hoursPerWeek)) {
    const { snapshots, first } = await getSnapshots(db, settings.year);
    const ordered = await db.select({ id: roadmapOrder.gameId }).from(roadmapOrder);
    const planGameIds = new Set<number>([...ordered.map((r) => r.id), ...backlog.flatMap((e) => (e.gameId === null ? [] : [e.gameId]))]);
    progress = computeProgress({ plan, today, firstSnapshotDate: first, by: groupSnapshots(snapshots), hoursPerWeek: settings.hoursPerWeek, planGameIds });
  }
  return { ...plan, settings, today, progress };
}
