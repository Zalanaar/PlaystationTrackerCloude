// Выборки, кэш фраз, счётчик лимита и дизлайки «Подскажи» (контракт 18). Расчёт в score.ts, тексты в phrase.ts.
import { and, desc, asc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { schema } from '@/db';
import { visibleGameRow } from '@/server/collection/visibility';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { effectiveDuration } from '@/server/collection/duration';
import { getLlmEnv, type LlmEnv } from '@/server/env';
import { effectiveGenres } from '@/shared/genres';
import { DISLIKE_TTL_DAYS, DISLIKE_TTL_MS, dislikeExpiresAt } from '@/shared/recommend';
import { stableHash, templateReason } from './phrase';
import { scoreBacklog } from './score';
import type { Candidate, DislikesResponse, HistoryGame, LlmMeta, Reason, RecommendResponse, ScoredItem, TimeWish } from './types';

const { games, gameStatus, gameTrophySets, trophySets, trophies, recommendDislikes, recommendReasons } = schema;

export class NotFoundError extends Error {}

/** Активные (неистёкшие, 18.9) отметки «Не интересно». */
export async function getDislikedIds(db: AnyDb, userId: UserId, now: Date = new Date()): Promise<Set<number>> {
  const rows = await db
    .select({ id: recommendDislikes.gameId })
    .from(recommendDislikes)
    .where(and(eq(recommendDislikes.userId, userId), gt(recommendDislikes.createdAt, new Date(now.getTime() - DISLIKE_TTL_MS))));
  return new Set(rows.map((r) => r.id));
}

/** Кандидаты: видимые игры со статусом backlog (service не участвует). Дизлайки отфильтровывает скоринг. */
export async function loadCandidates(db: AnyDb, userId: UserId): Promise<Candidate[]> {
  const rows = await db
    .select({
      id: games.id, name: games.name, imageUrl: games.imageUrl, bannerUrl: games.bannerUrl, psn: games.psnGenres, override: games.genresOverride,
      durOverride: games.durationOverrideHours, main: games.hltbMainHours, changedAt: gameStatus.statusChangedAt,
    })
    .from(games)
    .innerJoin(gameStatus, and(eq(gameStatus.gameId, games.id), eq(gameStatus.userId, userId)))
    .where(and(eq(games.userId, userId), eq(gameStatus.status, 'backlog'), visibleGameRow()));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [sums, dlc] = await Promise.all([
    db
      .select({
        gameId: gameTrophySets.gameId,
        total: sql<number>`coalesce(sum(${trophySets.definedBronze} + ${trophySets.definedSilver} + ${trophySets.definedGold} + ${trophySets.definedPlatinum}), 0)::int`,
        earned: sql<number>`coalesce(sum(${trophySets.earnedBronze} + ${trophySets.earnedSilver} + ${trophySets.earnedGold} + ${trophySets.earnedPlatinum}), 0)::int`,
      })
      .from(gameTrophySets)
      .innerJoin(trophySets, and(eq(trophySets.id, gameTrophySets.trophySetId), eq(trophySets.userId, userId)))
      .where(and(eq(gameTrophySets.userId, userId), inArray(gameTrophySets.gameId, ids)))
      .groupBy(gameTrophySets.gameId),
    db
      .selectDistinct({ gameId: gameTrophySets.gameId })
      .from(gameTrophySets)
      .innerJoin(trophies, and(eq(trophies.trophySetId, gameTrophySets.trophySetId), eq(trophies.userId, userId)))
      .where(and(eq(gameTrophySets.userId, userId), inArray(gameTrophySets.gameId, ids), eq(trophies.earned, false), sql`${trophies.groupId} is not null`, ne(trophies.groupId, 'default'))),
  ]);
  const sumBy = new Map(sums.map((s) => [s.gameId, s]));
  const dlcSet = new Set(dlc.map((d) => d.gameId));
  return rows.map((r) => {
    const d = effectiveDuration({ override: r.durOverride, main: r.main });
    const s = sumBy.get(r.id);
    return {
      id: r.id, name: r.name, imageUrl: r.imageUrl, bannerUrl: r.bannerUrl, genres: effectiveGenres(r.psn, r.override),
      hours: d.hours, hoursSource: d.source, statusChangedAt: r.changedAt,
      trophy: s && s.total > 0 ? { earned: s.earned, total: s.total, dlcTail: dlcSet.has(r.id) } : null,
    };
  });
}

/** История вкуса: видимые completed / playing / dropped. */
export async function loadHistory(db: AnyDb, userId: UserId): Promise<HistoryGame[]> {
  const rows = await db
    .select({ id: games.id, status: gameStatus.status, psn: games.psnGenres, override: games.genresOverride, seconds: games.playDurationSeconds })
    .from(games)
    .innerJoin(gameStatus, and(eq(gameStatus.gameId, games.id), eq(gameStatus.userId, userId)))
    .where(and(eq(games.userId, userId), inArray(gameStatus.status, ['completed', 'playing', 'dropped']), visibleGameRow()));
  return rows.map((r) => ({ id: r.id, status: r.status as HistoryGame['status'], genres: effectiveGenres(r.psn, r.override), playSeconds: r.seconds }));
}

// --- кэш фраз (контракт 20.4): экран только читает, пишет шаг синка

/** Фразы из кэша по стабильному хэшу (20.4). Срока годности нет: фраза живёт, пока факты не изменились. */
export async function readCachedReasons(db: AnyDb, userId: UserId, items: readonly ScoredItem[]): Promise<Map<number, string>> {
  if (!items.length) return new Map();
  const rows = await db
    .select()
    .from(recommendReasons)
    .where(and(eq(recommendReasons.userId, userId), inArray(recommendReasons.gameId, items.map((i) => i.game.id))));
  const hashes = new Map(items.map((i) => [i.game.id, stableHash(i)]));
  const out = new Map<number, string>();
  for (const r of rows) if (hashes.get(r.gameId) === r.signalsHash) out.set(r.gameId, r.text);
  return out;
}

/** Пишет фразы и удаляет прежние записи этих игр с другим хэшем (кэш не растёт). */
export async function writeCachedReasons(db: AnyDb, userId: UserId, items: readonly ScoredItem[], texts: ReadonlyMap<number, string>, now: Date): Promise<void> {
  for (const i of items) {
    const text = texts.get(i.game.id);
    if (text === undefined) continue;
    const hash = stableHash(i);
    await db
      .insert(recommendReasons)
      .values({ userId, gameId: i.game.id, signalsHash: hash, text, createdAt: now })
      .onConflictDoUpdate({ target: [recommendReasons.userId, recommendReasons.gameId, recommendReasons.signalsHash], set: { text, createdAt: now } });
    await db.delete(recommendReasons).where(and(eq(recommendReasons.userId, userId), eq(recommendReasons.gameId, i.game.id), ne(recommendReasons.signalsHash, hash)));
  }
}

export type RecommendDeps = { llm?: LlmEnv | null };

/** Причины для топа: кэш фраз синка, иначе шаблон. LLM НЕ вызывается (20.4). Сбой чтения кэша = шаблоны. */
export async function resolveReasons(db: AnyDb, userId: UserId, items: readonly ScoredItem[], deps: RecommendDeps = {}): Promise<{ reasons: Map<number, Reason>; llm: LlmMeta; pending: number }> {
  const reasons = new Map<number, Reason>(items.map((i) => [i.game.id, { text: templateReason(i), source: 'template' }]));
  const env = deps.llm === undefined ? getLlmEnv() : deps.llm;
  if (!env) return { reasons, llm: 'disabled', pending: 0 };
  try {
    const cached = await readCachedReasons(db, userId, items);
    for (const [id, text] of cached) reasons.set(id, { text, source: 'llm' });
    return { reasons, llm: 'ok', pending: items.filter((i) => !cached.has(i.game.id)).length };
  } catch {
    return { reasons, llm: 'ok', pending: items.length };
  }
}

/** GET /api/recommend (18.4). Ошибки БД пробрасываются (503 в роуте). */
export async function getRecommendations(db: AnyDb, userId: UserId, time: TimeWish, now: Date = new Date(), deps: RecommendDeps = {}): Promise<RecommendResponse> {
  const [candidates, history, dislikedIds] = await Promise.all([loadCandidates(db, userId), loadHistory(db, userId), getDislikedIds(db, userId, now)]);
  const scored = scoreBacklog({ candidates, history, dislikedIds, time, now });
  const { reasons, llm, pending } = await resolveReasons(db, userId, scored.items, deps);
  const items = scored.items.map((i) => ({ game: i.game, score: i.score, signals: i.signals, reason: reasons.get(i.game.id)! }));
  return { items, meta: { llm, candidates: scored.candidates, time, llmPending: pending } };
}

// --- дизлайки (18.5)

export async function dislikeGame(db: AnyDb, userId: UserId, gameId: number, now: Date = new Date()): Promise<void> {
  const [g] = await db.select({ id: games.id }).from(games).where(and(eq(games.id, gameId), eq(games.userId, userId)));
  if (!g) throw new NotFoundError('Игра не найдена.');
  // Повтор продлевает срок: created_at = now() (18.9).
  await db.insert(recommendDislikes).values({ userId, gameId, createdAt: now }).onConflictDoUpdate({ target: recommendDislikes.gameId, set: { createdAt: now } });
}

export async function undislikeGame(db: AnyDb, userId: UserId, gameId: number): Promise<void> {
  const [g] = await db.select({ id: games.id }).from(games).where(and(eq(games.id, gameId), eq(games.userId, userId)));
  if (!g) throw new NotFoundError('Игра не найдена.');
  await db.delete(recommendDislikes).where(and(eq(recommendDislikes.gameId, gameId), eq(recommendDislikes.userId, userId)));
}

/** GET /api/recommend/dislikes (18.9): неистёкшие отметки игр из бэклога, не скрытых hidden_at. */
export async function listDislikes(db: AnyDb, userId: UserId, now: Date = new Date()): Promise<DislikesResponse> {
  const rows = await db
    .select({ id: games.id, name: games.name, imageUrl: games.imageUrl, bannerUrl: games.bannerUrl, psn: games.psnGenres, override: games.genresOverride, at: recommendDislikes.createdAt })
    .from(recommendDislikes)
    .innerJoin(games, and(eq(games.id, recommendDislikes.gameId), eq(games.userId, userId)))
    .innerJoin(gameStatus, and(eq(gameStatus.gameId, games.id), eq(gameStatus.userId, userId)))
    .where(and(eq(recommendDislikes.userId, userId), gt(recommendDislikes.createdAt, new Date(now.getTime() - DISLIKE_TTL_MS)), eq(gameStatus.status, 'backlog'), visibleGameRow()))
    .orderBy(desc(recommendDislikes.createdAt), asc(games.id));
  return {
    items: rows.map((r) => ({
      game: { id: r.id, name: r.name, imageUrl: r.imageUrl, bannerUrl: r.bannerUrl, genres: effectiveGenres(r.psn, r.override) },
      hiddenAt: r.at.toISOString(),
      expiresAt: dislikeExpiresAt(r.at).toISOString(),
    })),
    ttlDays: DISLIKE_TTL_DAYS,
  };
}
