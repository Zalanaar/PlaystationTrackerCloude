// Дневник прохождения: датированные заметки к игре. Старая одиночная заметка отзыва при первом чтении переносится сюда.
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { NotFoundError } from '@/server/collection/mutations';
import { DIARY_MAX_ENTRIES, type DiaryEntry } from '@/shared/diary';

export { DIARY_MAX_ENTRIES, DIARY_NOTE_MAX, parseDiaryBody, type DiaryEntry } from '@/shared/diary';

export class DiaryLimitError extends Error {}

const { games, gameDiaryEntries, gameReviews } = schema;

const toEntry = (r: { id: number; body: string; createdAt: Date }): DiaryEntry => ({
  id: r.id, body: r.body, createdAt: r.createdAt.toISOString(),
});

async function ownGame(db: AnyDb, userId: UserId, gameId: number): Promise<boolean> {
  const [g] = await db.select({ id: games.id }).from(games).where(and(eq(games.id, gameId), eq(games.userId, userId))).limit(1);
  return !!g;
}

export async function listDiary(db: AnyDb, userId: UserId, gameId: number): Promise<DiaryEntry[]> {
  if (!(await ownGame(db, userId, gameId))) throw new NotFoundError();
  let rows: { id: number; body: string; createdAt: Date }[];
  try {
    rows = await db
      .select({ id: gameDiaryEntries.id, body: gameDiaryEntries.body, createdAt: gameDiaryEntries.createdAt })
      .from(gameDiaryEntries)
      .where(and(eq(gameDiaryEntries.userId, userId), eq(gameDiaryEntries.gameId, gameId)))
      .orderBy(asc(gameDiaryEntries.createdAt), asc(gameDiaryEntries.id));
  } catch {
    // схема ещё без 0046 (окно между выкладкой кода и миграцией)
    return [];
  }
  if (rows.length > 0) return rows.map(toEntry);
  const [rev] = await db
    .select({ note: gameReviews.note, updatedAt: gameReviews.updatedAt })
    .from(gameReviews)
    .where(and(eq(gameReviews.userId, userId), eq(gameReviews.gameId, gameId)))
    .limit(1);
  if (!rev?.note) return [];
  try {
    const [ins] = await db
      .insert(gameDiaryEntries)
      .values({ userId, gameId, body: rev.note, createdAt: rev.updatedAt })
      .returning({ id: gameDiaryEntries.id, body: gameDiaryEntries.body, createdAt: gameDiaryEntries.createdAt });
    return ins ? [toEntry(ins)] : [];
  } catch {
    return [];
  }
}

export async function addDiaryEntry(db: AnyDb, userId: UserId, gameId: number, body: string): Promise<DiaryEntry[]> {
  if (!(await ownGame(db, userId, gameId))) throw new NotFoundError();
  // если есть только старая заметка отзыва — сначала перенести, чтобы лимит считался честно
  await listDiary(db, userId, gameId);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(gameDiaryEntries)
    .where(and(eq(gameDiaryEntries.userId, userId), eq(gameDiaryEntries.gameId, gameId)));
  if (n >= DIARY_MAX_ENTRIES) throw new DiaryLimitError();
  await db.insert(gameDiaryEntries).values({ userId, gameId, body, createdAt: new Date() });
  return listDiary(db, userId, gameId);
}

export async function deleteDiaryEntry(db: AnyDb, userId: UserId, gameId: number, entryId: number): Promise<DiaryEntry[]> {
  if (!(await ownGame(db, userId, gameId))) throw new NotFoundError();
  const del = await db
    .delete(gameDiaryEntries)
    .where(and(eq(gameDiaryEntries.id, entryId), eq(gameDiaryEntries.userId, userId), eq(gameDiaryEntries.gameId, gameId)))
    .returning({ id: gameDiaryEntries.id });
  if (!del.length) throw new NotFoundError();
  return listDiary(db, userId, gameId);
}

export type YearDiaryNote = { gameId: number; title: string; body: string; createdAt: string };

/** Заметки за интервал (границы как у периода МСК, уже в UTC). Свежие первые, не больше 8. */
export async function listDiaryInRange(db: AnyDb, userId: UserId, fromUtc: Date, toUtc: Date, limit = 8): Promise<YearDiaryNote[]> {
  const rows = await db
    .select({
      gameId: gameDiaryEntries.gameId,
      title: games.name,
      body: gameDiaryEntries.body,
      createdAt: gameDiaryEntries.createdAt,
    })
    .from(gameDiaryEntries)
    .innerJoin(games, and(eq(games.id, gameDiaryEntries.gameId), eq(games.userId, userId)))
    .where(and(
      eq(gameDiaryEntries.userId, userId),
      gte(gameDiaryEntries.createdAt, fromUtc),
      lt(gameDiaryEntries.createdAt, toUtc),
      sql`${games.hiddenAt} is null`,
    ))
    .orderBy(desc(gameDiaryEntries.createdAt), desc(gameDiaryEntries.id))
    .limit(limit)
    .catch((): { gameId: number; title: string; body: string; createdAt: Date }[] => []);
  return rows.map((r) => ({ gameId: r.gameId, title: r.title, body: r.body, createdAt: r.createdAt.toISOString() }));
}

export async function listDiaryByGameIds(db: AnyDb, userId: UserId, gameIds: number[]): Promise<Map<number, DiaryEntry[]>> {
  const out = new Map<number, DiaryEntry[]>();
  if (!gameIds.length) return out;
  const rows = await db
    .select({ id: gameDiaryEntries.id, gameId: gameDiaryEntries.gameId, body: gameDiaryEntries.body, createdAt: gameDiaryEntries.createdAt })
    .from(gameDiaryEntries)
    .where(and(eq(gameDiaryEntries.userId, userId), inArray(gameDiaryEntries.gameId, gameIds)))
    .orderBy(asc(gameDiaryEntries.createdAt), asc(gameDiaryEntries.id))
    .catch((): { id: number; gameId: number; body: string; createdAt: Date }[] => []);
  for (const r of rows) {
    const list = out.get(r.gameId) ?? [];
    list.push(toEntry(r));
    out.set(r.gameId, list);
  }
  return out;
}
