// «Не интересно» для внешних игр RAWG (контракт 19.7). Срок как у 18.9, повторный POST продлевает.
import { and, desc, eq, gt } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { DISLIKE_TTL_DAYS, DISLIKE_TTL_MS, dislikeExpiresAt } from '@/shared/recommend';

const { recommendExternalDislikes: t } = schema;

export type ExternalDislikeInput = { externalSource: 'rawg'; externalId: string; title: string; coverUrl: string | null };
export type ExternalDislikeItem = { externalSource: 'rawg'; externalId: string; title: string; coverUrl: string | null; hiddenAt: string; expiresAt: string };

export async function dislikeExternal(db: AnyDb, v: ExternalDislikeInput, now: Date = new Date()): Promise<void> {
  await db
    .insert(t)
    .values({ externalSource: v.externalSource, externalId: v.externalId, title: v.title, coverUrl: v.coverUrl, createdAt: now })
    .onConflictDoUpdate({ target: [t.externalSource, t.externalId], set: { title: v.title, coverUrl: v.coverUrl, createdAt: now } });
}

export async function undislikeExternal(db: AnyDb, externalId: string): Promise<void> {
  await db.delete(t).where(and(eq(t.externalSource, 'rawg'), eq(t.externalId, externalId)));
}

export async function listExternalDislikes(db: AnyDb, now: Date = new Date()): Promise<{ items: ExternalDislikeItem[]; ttlDays: number }> {
  const rows = await db
    .select()
    .from(t)
    .where(gt(t.createdAt, new Date(now.getTime() - DISLIKE_TTL_MS)))
    .orderBy(desc(t.createdAt), t.externalId);
  return {
    items: rows.map((r) => ({
      externalSource: 'rawg' as const, externalId: r.externalId, title: r.title, coverUrl: r.coverUrl,
      hiddenAt: r.createdAt.toISOString(), expiresAt: dislikeExpiresAt(r.createdAt).toISOString(),
    })),
    ttlDays: DISLIKE_TTL_DAYS,
  };
}
