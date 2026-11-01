// Сбор блоков сводки (контракт F29.5). Каждая выборка несёт user_id и общий фильтр видимости. Блок собирается независимо:
// исключение в одном блоке не мешает остальным (блок = null, сбой считается в failed).
import { and, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { effectiveGameIdSql, snapshotGameVisible, trophySetCounted } from '@/server/collection/visibility';
import { getInbox } from '@/server/inbox/query';
import { getRecommendations } from '@/server/recommend/db';
import { getRoadmap } from '@/server/roadmap/db';
import { getDuplicateMap, mergeDuplicateSnapshots } from '@/server/stats/duplicates';
import { groupSnapshots, secondsByGame, sumSeconds, type Snapshot } from '@/server/stats/hours';
import type { DigestAdvice, DigestData, DigestHours, DigestPlan, DigestTrophies } from './format';
import { dayRangeLabel } from './format';
import type { DigestWeek } from './week';

const { games, gameTrophySets, playtimeSnapshots: ps, trophies } = schema;

export const BLOCK_COUNT = 5;

export async function collectHours(db: AnyDb, userId: UserId, week: DigestWeek): Promise<DigestHours> {
  const [dupMap, inRange, bases, first] = await Promise.all([
    getDuplicateMap(db, userId),
    db
      .select({ gameId: ps.gameId, date: ps.snapshotDate, seconds: ps.playDurationSeconds })
      .from(ps)
      .where(and(eq(ps.userId, userId), gte(ps.snapshotDate, week.prevFrom), lte(ps.snapshotDate, week.to), snapshotGameVisible(ps.gameId, userId))),
    db
      .selectDistinctOn([ps.gameId], { gameId: ps.gameId, date: ps.snapshotDate, seconds: ps.playDurationSeconds })
      .from(ps)
      .where(and(eq(ps.userId, userId), lt(ps.snapshotDate, week.prevFrom), snapshotGameVisible(ps.gameId, userId)))
      .orderBy(ps.gameId, desc(ps.snapshotDate)),
    db.select({ d: sql<string | null>`min(${ps.snapshotDate})` }).from(ps).where(eq(ps.userId, userId)),
  ]);
  const firstDate = first[0]?.d ?? null;
  if (firstDate === null) return { weekSeconds: null, prevWeekSeconds: null, noHistory: true };
  const by = groupSnapshots(mergeDuplicateSnapshots([...bases, ...inRange] as Snapshot[], dupMap));
  return {
    weekSeconds: firstDate > week.to ? null : sumSeconds(secondsByGame(by, week.from, week.to)),
    // неполная прошлая неделя (первый снимок не раньше её понедельника) = нет данных для сравнения
    prevWeekSeconds: firstDate >= week.prevFrom ? null : sumSeconds(secondsByGame(by, week.prevFrom, week.prevTo)),
    noHistory: false,
  };
}

export async function collectTrophies(db: AnyDb, userId: UserId, week: DigestWeek): Promise<DigestTrophies> {
  const inWeek = and(eq(trophies.userId, userId), eq(trophies.earned, true), gte(trophies.earnedAt, week.fromUtc), lt(trophies.earnedAt, week.toUtc), trophySetCounted(trophies.trophySetId, userId));
  const [byType, plat] = await Promise.all([
    db.select({ type: trophies.type, n: sql<number>`count(*)::int` }).from(trophies).where(inWeek).groupBy(trophies.type),
    // игра набора = минимальный id видимой игры (как в статистике); названия отдельным запросом
    db
      .select({ gameId: sql<number>`min(${effectiveGameIdSql('g')})`, at: sql<Date>`min(${trophies.earnedAt})` })
      .from(trophies)
      .innerJoin(gameTrophySets, and(eq(gameTrophySets.trophySetId, trophies.trophySetId), eq(gameTrophySets.userId, userId)))
      .innerJoin(sql`${games} as g`, sql`g."id" = ${gameTrophySets.gameId} and g."user_id" = ${userId} and g."hidden_at" is null`)
      .where(and(inWeek, eq(trophies.type, 'platinum')))
      .groupBy(trophies.trophySetId)
      .orderBy(sql`min(${trophies.earnedAt})`),
  ]);
  const total = byType.reduce((a, r) => a + r.n, 0);
  const platinums = byType.find((r) => r.type === 'platinum')?.n ?? 0;
  const ids = [...new Set(plat.map((p) => p.gameId))];
  const names = ids.length ? await db.select({ id: games.id, name: games.name }).from(games).where(and(eq(games.userId, userId), inArray(games.id, ids))) : [];
  const nameBy = new Map(names.map((n) => [n.id, n.name]));
  const platinumGames = ids.flatMap((id) => (nameBy.has(id) ? [{ gameId: id, title: nameBy.get(id)! }] : []));
  return { total, platinums, platinumGames };
}

export async function collectPlan(db: AnyDb, userId: UserId, week: DigestWeek, now: Date): Promise<DigestPlan | null> {
  const r = await getRoadmap(db, userId, now);
  if (r.status !== 'ok' || r.items.length === 0) return null;
  const next = r.items
    .filter((i) => i.start <= week.nextTo && i.end >= week.nextFrom)
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
    .map((i) => ({ gameId: i.gameId, title: i.title, days: dayRangeLabel(i.start > week.nextFrom ? i.start : week.nextFrom, i.end < week.nextTo ? i.end : week.nextTo) }));
  const st = r.progress?.status;
  const state = st === 'ahead' || st === 'behind' || st === 'onTrack' ? st : null;
  return { state, diffSeconds: Math.round((r.progress?.diffHours ?? 0) * 3600), next };
}

/** Топ-1 «Подскажи» (LLM не вызывается: кэш фраз или шаблон), не равный совету прошлой сводки. */
export async function collectAdvice(db: AnyDb, userId: UserId, now: Date, lastAdviceGameId: number | null): Promise<DigestAdvice | null> {
  const rec = await getRecommendations(db, userId, 'any', now);
  const pick = rec.items.find((i) => i.game.id !== lastAdviceGameId);
  return pick ? { gameId: pick.game.id, title: pick.game.name, reason: pick.reason.text } : null;
}

export async function collectStatuses(db: AnyDb, userId: UserId, now: Date): Promise<number | null> {
  const r = await getInbox(db, userId, now);
  if (r.checkCount === null && r.newUnsorted === null) return null;
  return (r.checkCount ?? 0) + (r.newUnsorted ?? 0);
}

export type Collected = { data: DigestData; failed: number };

export type Collectors = {
  hours: typeof collectHours;
  trophies: typeof collectTrophies;
  plan: typeof collectPlan;
  advice: typeof collectAdvice;
  statuses: typeof collectStatuses;
};
export const defaultCollectors: Collectors = { hours: collectHours, trophies: collectTrophies, plan: collectPlan, advice: collectAdvice, statuses: collectStatuses };

/** Все блоки параллельно; упавший блок = null, его число в failed. Не бросает. */
export async function collectDigest(db: AnyDb, userId: UserId, week: DigestWeek, o: { now: Date; lastAdviceGameId: number | null; collectors?: Collectors }): Promise<Collected> {
  const c = o.collectors ?? defaultCollectors;
  const settled = await Promise.allSettled([
    c.hours(db, userId, week),
    c.trophies(db, userId, week),
    c.plan(db, userId, week, o.now),
    c.advice(db, userId, o.now, o.lastAdviceGameId),
    c.statuses(db, userId, o.now),
  ]);
  const val = <T>(i: number): T | null => (settled[i].status === 'fulfilled' ? (settled[i] as PromiseFulfilledResult<T>).value : null);
  const failed = settled.filter((s) => s.status === 'rejected').length;
  if (failed > 0) console.error(`digest: блоков не собрано: ${failed}`);
  return {
    failed,
    data: {
      weekFrom: week.from,
      weekTo: week.to,
      hours: val<DigestHours>(0),
      trophies: val<DigestTrophies>(1),
      plan: val<DigestPlan | null>(2),
      advice: val<DigestAdvice | null>(3),
      statuses: val<number | null>(4),
    },
  };
}
