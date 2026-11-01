// Подсказки смены статуса: чтение из БД и отказы (контракт 28). Все запросы несут user_id; статусы не пишутся.
import { and, eq, isNull, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { getGamesByIds } from '@/server/collection/query';
import type { GameItem } from '@/server/collection/types';
import type { StatusHintRule } from '@/shared/status-hints';
import { groupPlatinum, hintFor, sortHints, type HintFacts, type SetFact, type StatusHint } from './status-hints';

const { games, gameStatus, gameTrophySets, trophySets, trophies, statusHintDismissals } = schema;

export class HintNotFoundError extends Error {}

export type StatusHintItem = StatusHint & { game: GameItem };

/** Подсказки пользователя без GameItem (для счётчика и сборки списка). */
export async function computeStatusHints(db: AnyDb, userId: UserId, now: Date = new Date()): Promise<StatusHint[]> {
  const gameRows = await db
    .select({ id: games.id, dupOf: games.duplicateOfGameId, lastPlayedAt: games.lastPlayedAt, playSeconds: games.playDurationSeconds })
    .from(games)
    .where(and(eq(games.userId, userId), isNull(games.hiddenAt)));
  if (!gameRows.length) return [];
  const statusRows = await db.select().from(gameStatus).where(eq(gameStatus.userId, userId));
  const dismissRows = await db.select({ gameId: statusHintDismissals.gameId, rule: statusHintDismissals.rule }).from(statusHintDismissals).where(eq(statusHintDismissals.userId, userId));
  const setRows = await db
    .select({
      gameId: gameTrophySets.gameId,
      setId: trophySets.id,
      defined: sql<number>`(${trophySets.definedBronze} + ${trophySets.definedSilver} + ${trophySets.definedGold} + ${trophySets.definedPlatinum})::int`,
      earnedPlatinum: trophySets.earnedPlatinum,
    })
    .from(gameTrophySets)
    .innerJoin(trophySets, and(eq(trophySets.id, gameTrophySets.trophySetId), eq(trophySets.userId, userId)))
    .where(eq(gameTrophySets.userId, userId));
  const platRows = await db
    .select({ setId: trophies.trophySetId, at: sql<Date | string | null>`min(${trophies.earnedAt})` })
    .from(trophies)
    .where(and(eq(trophies.userId, userId), eq(trophies.type, 'platinum'), eq(trophies.earned, true)))
    .groupBy(trophies.trophySetId);

  const statusBy = new Map(statusRows.map((s) => [s.gameId, s]));
  const platAt = new Map(platRows.map((p) => [p.setId, p.at === null ? null : new Date(p.at)]));
  const dismissedBy = new Map<number, Set<StatusHintRule>>();
  const effective = new Map(gameRows.map((g) => [g.id, g.dupOf ?? g.id]));
  for (const d of dismissRows) {
    const key = effective.get(d.gameId) ?? d.gameId; // отказ по дублю относится к главной группы
    (dismissedBy.get(key) ?? dismissedBy.set(key, new Set()).get(key)!).add(d.rule as StatusHintRule);
  }
  const setsBy = new Map<number, SetFact[]>();
  for (const s of setRows) {
    const key = effective.get(s.gameId);
    if (key === undefined) continue; // игра скрыта
    (setsBy.get(key) ?? setsBy.set(key, []).get(key)!).push({ gameId: s.gameId, setId: s.setId, definedTotal: s.defined, earnedPlatinum: s.earnedPlatinum, platinumEarnedAt: platAt.get(s.setId) ?? null });
  }
  const membersBy = new Map<number, typeof gameRows>();
  for (const g of gameRows) (membersBy.get(g.dupOf ?? g.id) ?? membersBy.set(g.dupOf ?? g.id, []).get(g.dupOf ?? g.id)!).push(g);

  const out: StatusHint[] = [];
  for (const primary of gameRows) {
    if (primary.dupOf !== null) continue;
    const members = membersBy.get(primary.id) ?? [primary];
    const st = statusBy.get(primary.id) ?? null;
    const plat = groupPlatinum(setsBy.get(primary.id) ?? []);
    const played = members.flatMap((m) => (m.lastPlayedAt ? [m.lastPlayedAt] : []));
    const facts: HintFacts = {
      gameId: primary.id,
      status: st?.status ?? null,
      statusChangedAt: st?.statusChangedAt ?? null,
      droppedAt: st?.droppedAt ?? null,
      lastPlayedAt: played.length ? new Date(Math.max(...played.map((d) => d.getTime()))) : null,
      playSeconds: members.reduce((a, m) => a + m.playSeconds, 0),
      platinumEarned: plat.earned,
      platinumEarnedAt: plat.earnedAt,
    };
    const h = hintFor(facts, dismissedBy.get(primary.id) ?? new Set(), now);
    if (h) out.push(h);
  }
  return sortHints(out);
}

export async function getStatusHints(db: AnyDb, userId: UserId, now: Date = new Date()): Promise<{ count: number; items: StatusHintItem[] }> {
  const hints = await computeStatusHints(db, userId, now);
  const items = await getGamesByIds(db, userId, hints.map((h) => h.gameId));
  const by = new Map(items.map((g) => [g.id, g]));
  const withGame = hints.flatMap((h) => {
    const game = by.get(h.gameId);
    return game ? [{ ...h, game }] : [];
  });
  return { count: withGame.length, items: withGame };
}

export async function countStatusHints(db: AnyDb, userId: UserId, now: Date = new Date()): Promise<number> {
  return (await computeStatusHints(db, userId, now)).length;
}

/** Отказ «не предлагать». Идемпотентен. Нет игры или она чужая: HintNotFoundError. */
export async function dismissHint(db: AnyDb, userId: UserId, gameId: number, rule: StatusHintRule): Promise<void> {
  const [g] = await db.select({ id: games.id }).from(games).where(and(eq(games.id, gameId), eq(games.userId, userId))).limit(1);
  if (!g) throw new HintNotFoundError();
  await db.insert(statusHintDismissals).values({ userId, gameId, rule }).onConflictDoNothing();
}

export async function undismissHint(db: AnyDb, userId: UserId, gameId: number, rule: StatusHintRule): Promise<void> {
  await db.delete(statusHintDismissals).where(and(eq(statusHintDismissals.userId, userId), eq(statusHintDismissals.gameId, gameId), eq(statusHintDismissals.rule, rule)));
}
