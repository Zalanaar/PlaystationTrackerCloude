// F1: личная оценка 0–10 и заметка к игре (контракт F1). Нет строки = не оценена; 0 — настоящая оценка.
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { NotFoundError } from './mutations';
import type { GameReview } from './types';

const { games, gameReviews } = schema;

import { NOTE_MAX, noteLength, RATING_MAX, RATING_MIN } from '@/shared/review';

export { NOTE_MAX, RATING_MAX, RATING_MIN };

/** Частичная правка: отсутствующее поле не меняется, null стирает. */
export type ReviewPatch = { rating?: number | null; note?: string | null };


export function parseReviewBody(body: unknown): { ok: true; value: ReviewPatch } | { ok: false; message: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, message: 'Ожидается объект.' };
  const b = body as Record<string, unknown>;
  const extra = Object.keys(b).filter((k) => k !== 'rating' && k !== 'note');
  if (extra.length) return { ok: false, message: `Неизвестное поле: ${extra[0]}.` };
  if (!('rating' in b) && !('note' in b)) return { ok: false, message: 'Нужно поле rating или note.' };
  const out: ReviewPatch = {};
  if ('rating' in b) {
    const r = b.rating;
    if (r !== null && !(typeof r === 'number' && Number.isInteger(r) && r >= RATING_MIN && r <= RATING_MAX)) {
      return { ok: false, message: `Оценка — целое от ${RATING_MIN} до ${RATING_MAX} или null.` };
    }
    out.rating = r as number | null;
  }
  if ('note' in b) {
    const n = b.note;
    if (n !== null && typeof n !== 'string') return { ok: false, message: 'Заметка — строка или null.' };
    const norm = n === null ? '' : n.replace(/\r\n?/g, '\n').trim();
    if (noteLength(norm) > NOTE_MAX) return { ok: false, message: `Заметка длиннее ${NOTE_MAX} символов.` };
    out.note = norm === '' ? null : norm;
  }
  return { ok: true, value: out };
}

const toReview = (r: { rating: number | null; note: string | null; updatedAt: Date }): GameReview => ({
  rating: r.rating,
  note: r.note,
  updatedAt: r.updatedAt.toISOString(),
});

/** Отзыв главной карточки; null = не оценена. */
export async function getReview(db: AnyDb, userId: UserId, gameId: number): Promise<GameReview | null> {
  const [r] = await db
    .select({ rating: gameReviews.rating, note: gameReviews.note, updatedAt: gameReviews.updatedAt })
    .from(gameReviews)
    .where(and(eq(gameReviews.userId, userId), eq(gameReviews.gameId, gameId)))
    .limit(1);
  return r ? toReview(r) : null;
}

/**
 * Пишет отзыв. Дубль (25.x) пишется на главную карточку. Оба поля пустые -> строка удаляется (игра снова «без оценки»).
 * Возвращает id главной карточки и итоговый отзыв.
 */
export async function setReview(db: AnyDb, userId: UserId, gameId: number, patch: ReviewPatch, now = new Date()): Promise<{ gameId: number; review: GameReview | null }> {
  const [g] = await db
    .select({ id: games.id, dup: games.duplicateOfGameId })
    .from(games)
    .where(and(eq(games.id, gameId), eq(games.userId, userId)))
    .limit(1);
  if (!g) throw new NotFoundError('Игра не найдена.');
  const target = g.dup ?? g.id;
  return db.transaction(async (tx) => {
    // две быстрые правки (оценка и заметка) первой записи не должны затереть друг друга
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`game_reviews:${userId}:${target}`}))`);
    const [cur] = await tx
      .select({ rating: gameReviews.rating, note: gameReviews.note })
      .from(gameReviews)
      .where(and(eq(gameReviews.userId, userId), eq(gameReviews.gameId, target)))
      .limit(1);
    const rating = patch.rating !== undefined ? patch.rating : (cur?.rating ?? null);
    const note = patch.note !== undefined ? patch.note : (cur?.note ?? null);
    if (rating === null && note === null) {
      await tx.delete(gameReviews).where(and(eq(gameReviews.userId, userId), eq(gameReviews.gameId, target)));
      return { gameId: target, review: null };
    }
    const [row] = await tx
      .insert(gameReviews)
      .values({ userId, gameId: target, rating, note, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: gameReviews.gameId, set: { rating, note, updatedAt: now } })
      .returning({ rating: gameReviews.rating, note: gameReviews.note, updatedAt: gameReviews.updatedAt });
    return { gameId: target, review: toReview(row) };
  });
}
