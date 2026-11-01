// «Уже есть / проходил» (Фаза 40, контракт 40). Отметки внешних игр RAWG: пропадают из выдач кандидатов.
// Ключ — RAWG id (title_key справочный). Все запросы с user_id; покрывающая игра обязана принадлежать этому же пользователю.
// Отметка НЕ участвует в расчёте вкуса, скоринга и статистики: этот модуль их не импортирует.
import { and, asc, desc, eq, inArray, isNotNull, isNull, max, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { libraryKey } from '@/server/recommend/discover-rank';
import type { OwnedMarkInput } from './validation';

const { ownedMarks: m, games: g } = schema;

export type OwnedMark = {
  externalSource: 'rawg';
  externalId: string;
  title: string;
  coverUrl: string | null;
  kind: 'covered' | 'not_in_library';
  completed: boolean;
  coveredBy: { gameId: number; name: string; imageUrl: string | null } | null;
  createdAt: string;
  updatedAt: string;
};
export type RecentCollection = { gameId: number; name: string; imageUrl: string | null; coveredCount: number; lastUsedAt: string };
export type LibraryHit = { id: number; name: string; imageUrl: string | null; coveredCount: number };

/** Игра не найдена у этого пользователя (чужая и несуществующая неразличимы). */
export class GameNotFoundError extends Error {
  constructor() {
    super('game_not_found');
  }
}

type Row = typeof m.$inferSelect & { gameName: string | null; gameImage: string | null };

const toMark = (r: Row): OwnedMark => ({
  externalSource: 'rawg',
  externalId: r.rawgId,
  title: r.title,
  coverUrl: r.coverUrl,
  kind: r.coveredByGameId === null ? 'not_in_library' : 'covered',
  completed: r.completed,
  coveredBy: r.coveredByGameId === null ? null : { gameId: r.coveredByGameId, name: r.gameName ?? '', imageUrl: r.gameImage },
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

async function readMarks(db: AnyDb, userId: UserId, onlyId?: string): Promise<OwnedMark[]> {
  const rows = await db
    .select({ mark: m, gameName: g.name, gameImage: g.imageUrl })
    .from(m)
    .leftJoin(g, and(eq(g.userId, m.userId), eq(g.id, m.coveredByGameId)))
    .where(onlyId === undefined ? eq(m.userId, userId) : and(eq(m.userId, userId), eq(m.rawgId, onlyId)))
    .orderBy(desc(m.updatedAt), asc(m.rawgId));
  return rows.map((r) => toMark({ ...r.mark, gameName: r.gameName, gameImage: r.gameImage }));
}

export async function listOwnedMarks(db: AnyDb, userId: UserId): Promise<OwnedMark[]> {
  return readMarks(db, userId);
}

/** Создать или обновить отметку. covered: игра должна быть у этого пользователя, дубль заменяется главной (Фаза 23). */
export async function upsertOwnedMark(db: AnyDb, userId: UserId, v: OwnedMarkInput, now: Date = new Date()): Promise<OwnedMark> {
  let coveredBy: number | null = null;
  if (v.kind === 'covered') {
    const [game] = await db.select({ id: g.id, dup: g.duplicateOfGameId }).from(g).where(and(eq(g.userId, userId), eq(g.id, v.coveredByGameId)));
    if (!game) throw new GameNotFoundError();
    coveredBy = game.dup ?? game.id;
  }
  const completed = v.kind === 'not_in_library' ? v.completed : false;
  await db
    .insert(m)
    .values({ userId, rawgId: v.externalId, title: v.title, titleKey: libraryKey(v.title), coverUrl: v.coverUrl, coveredByGameId: coveredBy, completed, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [m.userId, m.rawgId],
      set: { title: v.title, titleKey: libraryKey(v.title), coverUrl: v.coverUrl, coveredByGameId: coveredBy, completed, updatedAt: now },
    });
  return (await readMarks(db, userId, v.externalId))[0];
}

/** «Вернуть в подборку». Удаляет только запись этого пользователя; false = отметки не было. */
export async function removeOwnedMark(db: AnyDb, userId: UserId, externalId: string): Promise<boolean> {
  const rows = await db.delete(m).where(and(eq(m.userId, userId), eq(m.rawgId, externalId))).returning({ id: m.rawgId });
  return rows.length > 0;
}

/** Недавно выбранные сборники: игры с отметками covered по последнему использованию (скрытые и дубли не показываем). */
export async function recentCollections(db: AnyDb, userId: UserId, limit: number): Promise<RecentCollection[]> {
  const last = max(m.updatedAt);
  const rows = await db
    .select({ id: g.id, name: g.name, imageUrl: g.imageUrl, n: sql<number>`count(*)::int`, last: last.as('last_used') })
    .from(m)
    .innerJoin(g, and(eq(g.userId, m.userId), eq(g.id, m.coveredByGameId)))
    .where(and(eq(m.userId, userId), isNotNull(m.coveredByGameId), isNull(g.hiddenAt), isNull(g.duplicateOfGameId)))
    .groupBy(g.id, g.name, g.imageUrl)
    .orderBy(desc(last), asc(g.id))
    .limit(limit);
  return rows.map((r) => ({ gameId: r.id, name: r.name, imageUrl: r.imageUrl, coveredCount: r.n, lastUsedAt: (r.last as Date).toISOString() }));
}

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Поиск по видимым играм библиотеки пользователя (название или название HLTB, подстрока без регистра). */
export async function searchLibrary(db: AnyDb, userId: UserId, q: string, limit: number): Promise<LibraryHit[]> {
  const like = `%${escapeLike(q)}%`;
  const prefix = `${escapeLike(q)}%`;
  const rows = await db
    .select({ id: g.id, name: g.name, imageUrl: g.imageUrl })
    .from(g)
    .where(and(eq(g.userId, userId), isNull(g.hiddenAt), isNull(g.duplicateOfGameId), sql`(${g.name} ilike ${like} or ${g.hltbName} ilike ${like})`))
    .orderBy(sql`case when ${g.name} ilike ${prefix} then 0 else 1 end`, asc(g.name), asc(g.id))
    .limit(limit);
  if (rows.length === 0) return [];
  const counts = await db
    .select({ id: m.coveredByGameId, n: sql<number>`count(*)::int` })
    .from(m)
    .where(and(eq(m.userId, userId), inArray(m.coveredByGameId, rows.map((r) => r.id))))
    .groupBy(m.coveredByGameId);
  const byId = new Map(counts.map((c) => [c.id, c.n]));
  return rows.map((r) => ({ id: r.id, name: r.name, imageUrl: r.imageUrl, coveredCount: byId.get(r.id) ?? 0 }));
}

/** rawg_id всех отметок пользователя: для исключения из выдач кандидатов RAWG. */
export async function ownedRawgIds(db: AnyDb, userId: UserId): Promise<Set<string>> {
  const rows = await db.select({ id: m.rawgId }).from(m).where(eq(m.userId, userId));
  return new Set(rows.map((r) => r.id));
}

/** Убирает из списка кандидатов RAWG отмеченные пользователем (по externalId). Порядок остальных не меняется. */
export async function filterOwned<T extends { externalId: string }>(db: AnyDb, userId: UserId, candidates: readonly T[]): Promise<T[]> {
  if (candidates.length === 0) return [];
  const rows = await db
    .select({ id: m.rawgId })
    .from(m)
    .where(and(eq(m.userId, userId), inArray(m.rawgId, candidates.map((c) => c.externalId))));
  if (rows.length === 0) return [...candidates];
  const hidden = new Set(rows.map((r) => r.id));
  return candidates.filter((c) => !hidden.has(c.externalId));
}
