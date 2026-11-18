// П14.3 «Публичная витрина»: по умолчанию закрыта; владелец открывает её и получает ссылку с ключом (в БД только SHA-256),
// может выпустить новую (старая перестаёт работать) или закрыть. На витрине только: ник и уровень PSN, общие цифры,
// топ игр по часам и последние пройденные (название, обложка, часы / месяц). Никаких заметок, цен, тегов, почты, статусов бэклога.
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { asUserId } from '@/server/auth/user-id';
import { getAchievements } from '@/server/achievements/achievements';
import { visibleGameRow } from '@/server/collection/visibility';
import { FEED_TOKEN_RE, hashFeedToken, newFeedToken } from '@/server/roadmap/calendar-feed';

const { showcaseShares, games, gameStatus, psnProfile } = schema;

export const SHOWCASE_TOP = 6;
export const showcasePath = (token: string): string => `/s/${token}`;

export type ShowcaseState = { open: boolean; createdAt: string | null };
export type ShowcaseGame = { name: string; imageUrl: string | null; hours: number };
export type ShowcaseDone = { name: string; imageUrl: string | null; month: string | null };
export type Showcase = {
  onlineId: string | null; avatarUrl: string | null; trophyLevel: number | null;
  values: { games: number; completed: number; hours: number; trophies: number; platinum: number; achievements: number };
  top: ShowcaseGame[]; done: ShowcaseDone[];
};

export async function getShowcaseState(db: AnyDb, userId: number): Promise<ShowcaseState> {
  const [r] = await db.select({ createdAt: showcaseShares.createdAt }).from(showcaseShares).where(eq(showcaseShares.userId, userId)).limit(1);
  return { open: !!r, createdAt: r ? r.createdAt.toISOString() : null };
}

export async function openShowcase(db: AnyDb, userId: number, now: Date): Promise<{ token: string; createdAt: string }> {
  const token = newFeedToken();
  const tokenHash = hashFeedToken(token);
  await db.insert(showcaseShares).values({ userId, tokenHash, createdAt: now })
    .onConflictDoUpdate({ target: showcaseShares.userId, set: { tokenHash, createdAt: now } });
  return { token, createdAt: now.toISOString() };
}

export async function closeShowcase(db: AnyDb, userId: number): Promise<void> {
  await db.delete(showcaseShares).where(eq(showcaseShares.userId, userId));
}

const gameSecondsSql = sql<number>`("games"."play_duration_seconds" + coalesce((select sum(d."play_duration_seconds") from "games" d where d."user_id" = "games"."user_id" and d."duplicate_of_game_id" = "games"."id"), 0))::int`;
const httpsOrNull = (u: string | null) => (u && /^https:\/\//.test(u) ? u : null);

/** Витрина по ключу; null — ключ кривой, неизвестный или витрина закрыта. */
export async function showcaseByToken(db: AnyDb, token: string): Promise<Showcase | null> {
  if (!FEED_TOKEN_RE.test(token)) return null;
  const [r] = await db.select({ userId: showcaseShares.userId }).from(showcaseShares).where(eq(showcaseShares.tokenHash, hashFeedToken(token))).limit(1);
  if (!r) return null;
  const userId = r.userId;
  const visible = and(eq(games.userId, userId), visibleGameRow());
  const [ach, prof, count, top, done] = await Promise.all([
    getAchievements(db, asUserId(userId)),
    db.select({ onlineId: psnProfile.onlineId, avatarUrl: psnProfile.avatarUrl, level: psnProfile.trophyLevel }).from(psnProfile).where(eq(psnProfile.userId, userId)).limit(1),
    db.select({ n: sql<number>`count(*)::int` }).from(games).where(visible),
    db.select({ name: games.name, imageUrl: games.imageUrl, s: gameSecondsSql }).from(games).where(and(visible, sql`${games.playDurationSeconds} > 0`))
      .orderBy(sql`3 desc`, games.id).limit(SHOWCASE_TOP),
    db.select({ name: games.name, imageUrl: games.imageUrl, at: gameStatus.completedAt }).from(games)
      .innerJoin(gameStatus, and(eq(gameStatus.gameId, games.id), eq(gameStatus.userId, userId)))
      .where(and(visible, eq(gameStatus.status, 'completed'), isNotNull(gameStatus.completedAt)))
      .orderBy(desc(gameStatus.completedAt), games.id).limit(SHOWCASE_TOP),
  ]);
  const v = (id: string) => ach.items.find((i) => i.id === id)?.value ?? 0;
  const p = prof[0];
  return {
    onlineId: p?.onlineId ?? null,
    avatarUrl: httpsOrNull(p?.avatarUrl ?? null),
    trophyLevel: p?.level ?? null,
    values: { games: Number(count[0]?.n ?? 0), completed: v('completed_1'), hours: v('hours_100'), trophies: v('trophies_1000'), platinum: v('platinum_1'), achievements: ach.unlocked },
    top: top.map((g) => ({ name: g.name.trim(), imageUrl: httpsOrNull(g.imageUrl), hours: Math.round(Number(g.s) / 360) / 10 })),
    done: done.map((g) => ({ name: g.name.trim(), imageUrl: httpsOrNull(g.imageUrl), month: g.at ? new Date(g.at.getTime() + 3 * 3600_000).toISOString().slice(0, 7) : null })),
  };
}
