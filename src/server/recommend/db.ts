// Выборки, кэш фраз, счётчик лимита и дизлайки «Подскажи» (контракт 18). Расчёт в score.ts, тексты в phrase.ts.
import { and, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { effectiveDuration } from '@/server/collection/duration';
import { getLlmEnv, type LlmEnv } from '@/server/env';
import { mskDateString } from '@/server/stats/period';
import { effectiveGenres } from '@/shared/genres';
import { createProvider, factsOf, requestPhrases, signalsHash, templateReason, DEFAULT_MODELS, type PhraseProvider } from './phrase';
import { scoreBacklog } from './score';
import type { Candidate, HistoryGame, LlmMeta, Reason, RecommendResponse, ScoredItem, TimeWish } from './types';

const { games, gameStatus, gameTrophySets, trophySets, trophies, recommendDislikes, recommendReasons, recommendLlmUsage } = schema;

export const REASON_TTL_MS = 7 * 86_400_000;

export class NotFoundError extends Error {}

export async function getDislikedIds(db: AnyDb): Promise<Set<number>> {
  const rows = await db.select({ id: recommendDislikes.gameId }).from(recommendDislikes);
  return new Set(rows.map((r) => r.id));
}

/** Кандидаты: видимые игры со статусом backlog (service не участвует). Дизлайки отфильтровывает скоринг. */
export async function loadCandidates(db: AnyDb): Promise<Candidate[]> {
  const rows = await db
    .select({
      id: games.id, name: games.name, imageUrl: games.imageUrl, bannerUrl: games.bannerUrl, psn: games.psnGenres, override: games.genresOverride,
      durOverride: games.durationOverrideHours, main: games.hltbMainHours, changedAt: gameStatus.statusChangedAt,
    })
    .from(games)
    .innerJoin(gameStatus, eq(gameStatus.gameId, games.id))
    .where(and(eq(gameStatus.status, 'backlog'), isNull(games.hiddenAt)));
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
      .innerJoin(trophySets, eq(trophySets.id, gameTrophySets.trophySetId))
      .where(inArray(gameTrophySets.gameId, ids))
      .groupBy(gameTrophySets.gameId),
    db
      .selectDistinct({ gameId: gameTrophySets.gameId })
      .from(gameTrophySets)
      .innerJoin(trophies, eq(trophies.trophySetId, gameTrophySets.trophySetId))
      .where(and(inArray(gameTrophySets.gameId, ids), eq(trophies.earned, false), sql`${trophies.groupId} is not null`, ne(trophies.groupId, 'default'))),
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
export async function loadHistory(db: AnyDb): Promise<HistoryGame[]> {
  const rows = await db
    .select({ id: games.id, status: gameStatus.status, psn: games.psnGenres, override: games.genresOverride, seconds: games.playDurationSeconds })
    .from(games)
    .innerJoin(gameStatus, eq(gameStatus.gameId, games.id))
    .where(and(inArray(gameStatus.status, ['completed', 'playing', 'dropped']), isNull(games.hiddenAt)));
  return rows.map((r) => ({ id: r.id, status: r.status as HistoryGame['status'], genres: effectiveGenres(r.psn, r.override), playSeconds: r.seconds }));
}

// --- кэш фраз и лимит

export async function readCachedReasons(db: AnyDb, items: readonly ScoredItem[], now: Date): Promise<Map<number, string>> {
  if (!items.length) return new Map();
  const rows = await db
    .select()
    .from(recommendReasons)
    .where(and(inArray(recommendReasons.gameId, items.map((i) => i.game.id)), gte(recommendReasons.createdAt, new Date(now.getTime() - REASON_TTL_MS))));
  const hashes = new Map(items.map((i) => [i.game.id, signalsHash(i)]));
  const out = new Map<number, string>();
  for (const r of rows) if (hashes.get(r.gameId) === r.signalsHash) out.set(r.gameId, r.text);
  return out;
}

export async function writeCachedReasons(db: AnyDb, items: readonly ScoredItem[], texts: ReadonlyMap<number, string>, now: Date): Promise<void> {
  const values = items.flatMap((i) => (texts.has(i.game.id) ? [{ gameId: i.game.id, signalsHash: signalsHash(i), text: texts.get(i.game.id)!, createdAt: now }] : []));
  for (const v of values) {
    await db.insert(recommendReasons).values(v).onConflictDoUpdate({ target: [recommendReasons.gameId, recommendReasons.signalsHash], set: { text: v.text, createdAt: v.createdAt } });
  }
}

/** Атомарно занимает один вызов LLM на сегодня (МСК). false = лимит достигнут. */
export async function reserveLlmCall(db: AnyDb, limit: number, now: Date): Promise<boolean> {
  const rows = await db
    .insert(recommendLlmUsage)
    .values({ day: mskDateString(now), calls: 1 })
    .onConflictDoUpdate({ target: recommendLlmUsage.day, set: { calls: sql`${recommendLlmUsage.calls} + 1` }, setWhere: lt(recommendLlmUsage.calls, limit) })
    .returning({ calls: recommendLlmUsage.calls });
  return rows.length > 0;
}

export type RecommendDeps = { llm?: LlmEnv | null; provider?: PhraseProvider; timeoutMs?: number };

/** Причины для топа: кэш, затем один вызов LLM за пачку, иначе шаблон. Сбой LLM ошибкой запроса не становится. */
export async function resolveReasons(db: AnyDb, items: readonly ScoredItem[], now: Date, deps: RecommendDeps = {}): Promise<{ reasons: Map<number, Reason>; llm: LlmMeta }> {
  const reasons = new Map<number, Reason>(items.map((i) => [i.game.id, { text: templateReason(i), source: 'template' }]));
  const env = deps.llm === undefined ? getLlmEnv() : deps.llm;
  if (!env || !items.length) return { reasons, llm: 'disabled' };
  try {
    const cached = await readCachedReasons(db, items, now);
    for (const [id, text] of cached) reasons.set(id, { text, source: 'llm' });
    const missing = items.filter((i) => !cached.has(i.game.id));
    if (!missing.length) return { reasons, llm: 'ok' };
    if (!(await reserveLlmCall(db, env.dailyLimit, now))) return { reasons, llm: 'limit' };
    const provider = deps.provider ?? createProvider({ provider: env.provider, apiKey: env.apiKey, model: env.model ?? DEFAULT_MODELS[env.provider] });
    let fresh: Map<number, string>;
    try {
      fresh = await requestPhrases(provider, factsOf(missing), deps.timeoutMs);
    } catch {
      return { reasons, llm: 'error' };
    }
    for (const [id, text] of fresh) reasons.set(id, { text, source: 'llm' });
    await writeCachedReasons(db, missing, fresh, now);
    return { reasons, llm: 'ok' };
  } catch {
    return { reasons, llm: 'error' }; // кэш или счётчик недоступны: шаблоны
  }
}

/** GET /api/recommend (18.4). Ошибки БД пробрасываются (503 в роуте). */
export async function getRecommendations(db: AnyDb, time: TimeWish, now: Date = new Date(), deps: RecommendDeps = {}): Promise<RecommendResponse> {
  const [candidates, history, dislikedIds] = await Promise.all([loadCandidates(db), loadHistory(db), getDislikedIds(db)]);
  const scored = scoreBacklog({ candidates, history, dislikedIds, time, now });
  const { reasons, llm } = await resolveReasons(db, scored.items, now, deps);
  const items = scored.items.map((i) => ({ game: i.game, score: i.score, signals: i.signals, reason: reasons.get(i.game.id)! }));
  return { items, meta: { llm, candidates: scored.candidates, time } };
}

// --- дизлайки (18.5)

export async function dislikeGame(db: AnyDb, gameId: number): Promise<void> {
  const [g] = await db.select({ id: games.id }).from(games).where(eq(games.id, gameId));
  if (!g) throw new NotFoundError('Игра не найдена.');
  await db.insert(recommendDislikes).values({ gameId }).onConflictDoNothing();
}

export async function undislikeGame(db: AnyDb, gameId: number): Promise<void> {
  const [g] = await db.select({ id: games.id }).from(games).where(eq(games.id, gameId));
  if (!g) throw new NotFoundError('Игра не найдена.');
  await db.delete(recommendDislikes).where(eq(recommendDislikes.gameId, gameId));
}
