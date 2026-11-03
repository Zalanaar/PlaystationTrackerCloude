// F3 «Лента трофеев» (контракт §24): страница строк keyset + сводка по типам за период одной агрегатной выборкой.
// Правила видимости как у «Входящих» (чип «+N трофеев» и лента дают одно число): earned, сет учитывается (trophySetCounted).
// Игры-сервисы входят (решение Artem, вопрос 13). Игра строки = главная карточка видимой игры сета (как rare-query).
import { and, desc, eq, gt, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { effectiveGameIdSql, snapshotGameVisible, trophySetCounted } from '@/server/collection/visibility';
import { mskDateString } from '@/server/stats/period';
import { encodeCursor, periodSince, RARE_THRESHOLD, toRate, type FeedQuery } from './feed';
import type { FeedItem, FeedResponse, FeedSummary, TrophyType } from './types';

const { games, gameTrophySets, trophies, trophySets } = schema;

function baseWhere(userId: UserId, q: FeedQuery, now: Date): SQL {
  const since = periodSince(q.period, now);
  return and(
    eq(trophies.userId, userId),
    eq(trophies.earned, true),
    since ? gt(trophies.earnedAt, since) : undefined,
    since ? lte(trophies.earnedAt, now) : undefined,
    q.rare ? lt(trophies.earnedRate, String(RARE_THRESHOLD)) : undefined,
    trophySetCounted(trophies.trophySetId, userId),
  ) as SQL;
}

/** Строки «после» курсора в порядке earned_at desc nulls last, id desc. */
function afterCursor(c: FeedQuery['cursor']): SQL | undefined {
  if (!c) return undefined;
  if (c.at === null) return and(isNull(trophies.earnedAt), lt(trophies.id, c.id));
  const at = new Date(c.at);
  return or(lt(trophies.earnedAt, at), and(eq(trophies.earnedAt, at), lt(trophies.id, c.id)), isNull(trophies.earnedAt));
}

export async function getFeedSummary(db: AnyDb, userId: UserId, q: FeedQuery, now: Date): Promise<FeedSummary> {
  const rows = await db
    .select({ type: trophies.type, n: sql<number>`count(*)::int` })
    .from(trophies)
    .where(baseWhere(userId, q, now))
    .groupBy(trophies.type);
  const s: FeedSummary = { total: 0, platinum: 0, gold: 0, silver: 0, bronze: 0 };
  for (const r of rows) {
    s[r.type as TrophyType] = Number(r.n);
    s.total += Number(r.n);
  }
  return s;
}

export async function getFeedPage(db: AnyDb, userId: UserId, q: FeedQuery, now: Date): Promise<{ items: FeedItem[]; nextCursor: string | null }> {
  const owner = db
    .select({ setId: gameTrophySets.trophySetId, gameId: sql<number>`min(${effectiveGameIdSql('games')})`.as('feed_owner_game_id') })
    .from(gameTrophySets)
    .innerJoin(games, eq(games.id, gameTrophySets.gameId))
    .where(and(eq(gameTrophySets.userId, userId), eq(games.userId, userId), snapshotGameVisible(games.id, userId)))
    .groupBy(gameTrophySets.trophySetId)
    .as('feed_owner');
  const rows = await db
    .select({
      id: trophies.id,
      setId: trophies.trophySetId,
      trophyId: trophies.trophyId,
      type: trophies.type,
      name: trophies.name,
      detail: trophies.detail,
      iconUrl: trophies.iconUrl,
      earnedAt: trophies.earnedAt,
      earnedRate: trophies.earnedRate,
      rarity: trophies.rarity,
      setName: trophySets.name,
      gameId: owner.gameId,
      gameTitle: games.name,
    })
    .from(trophies)
    .innerJoin(trophySets, and(eq(trophySets.id, trophies.trophySetId), eq(trophySets.userId, userId)))
    .leftJoin(owner, eq(owner.setId, trophies.trophySetId))
    .leftJoin(games, and(eq(games.id, owner.gameId), eq(games.userId, userId)))
    .where(and(baseWhere(userId, q, now), afterCursor(q.cursor)))
    .orderBy(sql`${trophies.earnedAt} desc nulls last`, desc(trophies.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const items: FeedItem[] = page.map((r) => ({
    id: r.id,
    setId: r.setId,
    trophyId: r.trophyId,
    type: r.type as TrophyType,
    name: r.name,
    detail: r.detail,
    iconUrl: r.iconUrl,
    earnedAt: r.earnedAt ? r.earnedAt.toISOString() : null,
    day: r.earnedAt ? mskDateString(r.earnedAt) : null,
    earnedRate: toRate(r.earnedRate),
    rarity: r.rarity,
    setName: r.setName,
    game: r.gameId === null ? null : { id: Number(r.gameId), title: r.gameTitle ?? '' },
  }));
  const last = page[page.length - 1];
  const nextCursor = rows.length > q.limit && last ? encodeCursor({ at: last.earnedAt ? last.earnedAt.getTime() : null, id: last.id }) : null;
  return { items, nextCursor };
}

/** Ответ API. Сводка только на первой странице (без курсора): у следующих страниц она та же — клиент её не перезапрашивает. */
export async function getTrophyFeed(db: AnyDb, userId: UserId, q: FeedQuery, now: Date): Promise<FeedResponse> {
  const empty: FeedSummary = { total: 0, platinum: 0, gold: 0, silver: 0, bronze: 0 };
  const [summary, page] = await Promise.all([q.cursor ? Promise.resolve(empty) : getFeedSummary(db, userId, q, now), getFeedPage(db, userId, q, now)]);
  return { period: q.period, rare: q.rare, today: mskDateString(now), summary, ...page };
}
