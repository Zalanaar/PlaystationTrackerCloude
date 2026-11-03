// P2-16: серверная отметка «Что нового прочитано до id N» (allowed_users.whats_new_seen, миграция 0030, expand).
// Хранится на сервере, чтобы Safari и PWA на iPhone (у них разные localStorage) не показывали одно и то же дважды.
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';

const { allowedUsers } = schema;

/** Верхняя граница id записи (защита от мусора в теле PUT) */
export const WHATS_NEW_MAX_ID = 100_000;

/** null = ещё не отмечал; undefined = пользователя нет. */
export async function getWhatsNewSeen(db: AnyDb, userId: UserId): Promise<number | null | undefined> {
  const [row] = await db.select({ seen: allowedUsers.whatsNewSeen }).from(allowedUsers).where(eq(allowedUsers.id, userId)).limit(1);
  return row ? row.seen : undefined;
}

/** Только растёт: меньшее значение не понижает сохранённое. Возвращает итог (undefined = пользователя нет). */
export async function markWhatsNewSeen(db: AnyDb, userId: UserId, seen: number): Promise<number | null | undefined> {
  await db
    .update(allowedUsers)
    .set({ whatsNewSeen: seen })
    .where(and(eq(allowedUsers.id, userId), sql`coalesce(${allowedUsers.whatsNewSeen}, -1) < ${seen}`));
  return getWhatsNewSeen(db, userId);
}

/** Тело PUT: { seen: целое 0..WHATS_NEW_MAX_ID }. null = невалидно. */
export function parseWhatsNewBody(body: unknown): { seen: number } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const v = (body as Record<string, unknown>).seen;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > WHATS_NEW_MAX_ID) return null;
  return { seen: v };
}
