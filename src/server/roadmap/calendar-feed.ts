// Живая подписка на календарь релизов (контракт «Подписка на календарь релизов»). Ключ — 32 случайных байта (base64url, 43 символа),
// в БД только SHA-256; ссылка показывается один раз при выпуске. В ленте только названия и даты релизов.
import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { asUserId, type UserId } from '@/server/auth/user-id';
import { buildIcs, getReleases } from './releases-ics';

const { calendarFeeds } = schema;

export const FEED_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
/** Подписка показывает и релизы прошедших 30 дней (иначе событие пропадает из календаря в день выхода). */
export const FEED_SINCE_DAYS = 30;

export const newFeedToken = (): string => randomBytes(32).toString('base64url');
export const hashFeedToken = (token: string): string => createHash('sha256').update(token).digest('hex');
export const feedPath = (token: string): string => `/api/cal/${token}.ics`;

export type FeedState = { active: boolean; createdAt: string | null };

export async function getFeedState(db: AnyDb, userId: UserId): Promise<FeedState> {
  const [r] = await db.select({ createdAt: calendarFeeds.createdAt }).from(calendarFeeds).where(eq(calendarFeeds.userId, userId)).limit(1);
  return { active: !!r, createdAt: r ? r.createdAt.toISOString() : null };
}

/** Выпустить ссылку (или заменить прежнюю: старая перестаёт работать). Возвращает ключ — единственный раз. */
export async function issueFeed(db: AnyDb, userId: UserId, now: Date): Promise<{ token: string; createdAt: string }> {
  const token = newFeedToken();
  const tokenHash = hashFeedToken(token);
  await db.insert(calendarFeeds).values({ userId, tokenHash, createdAt: now })
    .onConflictDoUpdate({ target: calendarFeeds.userId, set: { tokenHash, createdAt: now } });
  return { token, createdAt: now.toISOString() };
}

export async function revokeFeed(db: AnyDb, userId: UserId): Promise<void> {
  await db.delete(calendarFeeds).where(eq(calendarFeeds.userId, userId));
}

/** Лента по ключу; null — ключ неверный или отозван. */
export async function feedByToken(db: AnyDb, token: string, now: Date): Promise<string | null> {
  if (!FEED_TOKEN_RE.test(token)) return null;
  const [r] = await db.select({ userId: calendarFeeds.userId }).from(calendarFeeds).where(eq(calendarFeeds.tokenHash, hashFeedToken(token))).limit(1);
  if (!r) return null;
  const items = await getReleases(db, asUserId(r.userId), now, { sinceDays: FEED_SINCE_DAYS, notes: false });
  return buildIcs(items, now, { subscription: true });
}
