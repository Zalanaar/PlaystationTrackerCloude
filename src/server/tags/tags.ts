// П13.2 «Теги»: свои списки игр. Тег — имя 1–32 символа (уникально без учёта регистра), до 50 тегов у профиля.
// Теги вешаются на видимые игры (не скрытые, не дубли); счётчик тега — по видимым играм.
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { visibleGameRow } from '@/server/collection/visibility';

const { games, gameTags, gameTagLinks } = schema;

export const TAG_NAME_MAX = 32;
export const TAG_LIMIT = 50;
export const GAME_TAGS_MAX = 20;

export type TagDto = { id: number; name: string; count: number };
export type TagsResponse = { items: TagDto[] };

export class TagError extends Error {
  constructor(readonly code: 'not_found' | 'tag_exists' | 'tag_limit' | 'game_not_found') { super(code); }
}

/** Имя тега: пробелы схлопнуты, края обрезаны; пусто или длиннее 32 — null. */
export function normalizeTagName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s.length >= 1 && [...s].length <= TAG_NAME_MAX ? s : null;
}

const isUnique = (e: unknown) => {
  const c = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return c === '23505';
};

export async function listTags(db: AnyDb, userId: UserId): Promise<TagsResponse> {
  const rows = await db
    .select({
      id: gameTags.id, name: gameTags.name,
      count: sql<number>`(select count(*)::int from ${gameTagLinks} l join ${games} g on g."id" = l."game_id" and g."user_id" = l."user_id"
        where l."tag_id" = "game_tags"."id" and l."user_id" = ${userId} and g."hidden_at" is null and g."duplicate_of_game_id" is null)`,
    })
    .from(gameTags)
    .where(eq(gameTags.userId, userId))
    .orderBy(sql`lower(${gameTags.name})`, asc(gameTags.id));
  return { items: rows.map((r) => ({ id: r.id, name: r.name, count: Number(r.count) })) };
}

export async function createTag(db: AnyDb, userId: UserId, name: string): Promise<TagDto> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(gameTags).where(eq(gameTags.userId, userId));
  if (Number(n) >= TAG_LIMIT) throw new TagError('tag_limit');
  try {
    const [r] = await db.insert(gameTags).values({ userId, name }).returning({ id: gameTags.id, name: gameTags.name });
    return { id: r.id, name: r.name, count: 0 };
  } catch (e) {
    if (isUnique(e)) throw new TagError('tag_exists');
    throw e;
  }
}

export async function renameTag(db: AnyDb, userId: UserId, id: number, name: string): Promise<void> {
  try {
    const r = await db.update(gameTags).set({ name }).where(and(eq(gameTags.userId, userId), eq(gameTags.id, id))).returning({ id: gameTags.id });
    if (r.length === 0) throw new TagError('not_found');
  } catch (e) {
    if (isUnique(e)) throw new TagError('tag_exists');
    throw e;
  }
}

export async function deleteTag(db: AnyDb, userId: UserId, id: number): Promise<void> {
  const r = await db.delete(gameTags).where(and(eq(gameTags.userId, userId), eq(gameTags.id, id))).returning({ id: gameTags.id });
  if (r.length === 0) throw new TagError('not_found');
}

export async function gameTagIds(db: AnyDb, userId: UserId, gameId: number): Promise<number[]> {
  const [g] = await db.select({ id: games.id }).from(games).where(and(eq(games.userId, userId), eq(games.id, gameId), visibleGameRow())).limit(1);
  if (!g) throw new TagError('game_not_found');
  const rows = await db.select({ id: gameTagLinks.tagId }).from(gameTagLinks)
    .where(and(eq(gameTagLinks.userId, userId), eq(gameTagLinks.gameId, gameId))).orderBy(asc(gameTagLinks.tagId));
  return rows.map((r) => r.id);
}

/** Заменить набор тегов игры. Чужие/несуществующие теги — not_found. */
export async function setGameTags(db: AnyDb, userId: UserId, gameId: number, tagIds: readonly number[]): Promise<number[]> {
  const ids = [...new Set(tagIds)].sort((a, b) => a - b);
  await gameTagIds(db, userId, gameId); // игра есть и видима
  if (ids.length > 0) {
    const own = await db.select({ id: gameTags.id }).from(gameTags).where(and(eq(gameTags.userId, userId), inArray(gameTags.id, ids)));
    if (own.length !== ids.length) throw new TagError('not_found');
  }
  await db.delete(gameTagLinks).where(and(eq(gameTagLinks.userId, userId), eq(gameTagLinks.gameId, gameId)));
  if (ids.length > 0) await db.insert(gameTagLinks).values(ids.map((tagId) => ({ userId, tagId, gameId })));
  return ids;
}

/** Условие «игра с тегом» для запросов коллекции (games в FROM). */
export const tagFilterSql = (userId: UserId, tagId: number) =>
  sql`"games"."id" in (select l."game_id" from ${gameTagLinks} l where l."user_id" = ${userId} and l."tag_id" = ${tagId})`;
