// Пакет 6, п. 9: «Почти платина» на /trophies — полный список игр с прогрессом к платине (та же выборка и порядок, что у блока
// «Ближе всего к платине» на Коллекции, только без лимита 5). Видимые, не dropped, есть хотя бы один трофей, платины ещё нет.
import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { getNearPlatinumCandidates } from '@/server/collection/platinum-query';
import type { NearListResponse } from './types';

const { games } = schema;

export async function getNearPlatinumList(db: AnyDb, userId: UserId): Promise<NearListResponse> {
  const list = await getNearPlatinumCandidates(db, userId, Number.POSITIVE_INFINITY);
  if (list.length === 0) return { items: [] };
  const ids = list.map((c) => c.gameId);
  const covers = new Map<number, string | null>();
  // inArray порциями: длинные списки id не упираются в лимит параметров
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    const rows = await db.select({ id: games.id, url: games.imageUrl }).from(games).where(and(eq(games.userId, userId), inArray(games.id, part)));
    for (const r of rows) covers.set(r.id, r.url);
  }
  return { items: list.map((c) => ({ gameId: c.gameId, title: c.title, coverUrl: covers.get(c.gameId) ?? null, forecast: c.forecast })) };
}
