// Прогресс интерактивного тура пользователя (контракт 23). db передаётся параметром; все запросы по userId сессии.
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { shouldAutoStartTour, TOUR_VERSION } from '@/shared/tour';
import type { UserId } from '@/server/auth/user-id';

const { allowedUsers } = schema;

export type TourState = { version: number; completedVersion: number; shouldAutoStart: boolean };

function toState(row: { onboardedAt: Date | null; tourVersion: number | null }): TourState {
  const completedVersion = row.tourVersion ?? 0;
  return {
    version: TOUR_VERSION,
    completedVersion,
    shouldAutoStart: shouldAutoStartTour({ onboardedAt: row.onboardedAt, completedVersion }),
  };
}

const cols = { onboardedAt: allowedUsers.onboardedAt, tourVersion: allowedUsers.tourVersion };

/** null, если пользователя нет. */
export async function getTourState(db: AnyDb, userId: UserId): Promise<TourState | null> {
  const [row] = await db.select(cols).from(allowedUsers).where(eq(allowedUsers.id, userId)).limit(1);
  return row ? toState(row) : null;
}

/** Идемпотентно: версия только растёт, tour_completed_at ставится только при росте. */
export async function markTourDone(db: AnyDb, userId: UserId, version: number, now: Date = new Date()): Promise<TourState | null> {
  await db
    .update(allowedUsers)
    .set({ tourVersion: version, tourCompletedAt: now })
    .where(and(eq(allowedUsers.id, userId), sql`coalesce(${allowedUsers.tourVersion}, 0) < ${version}`));
  return getTourState(db, userId);
}

/** Тело PUT: { done: true, version: целое 1..TOUR_VERSION }. null = невалидно. */
export function parseTourBody(body: unknown): { version: number } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (b.done !== true) return null;
  const v = b.version;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > TOUR_VERSION) return null;
  return { version: v };
}
