// Журнал событий токена PSN (контракт 27.3). Глобальный, как psn_auth. Секретов в details нет (только числа и причины).
// Запись никогда не бросает: журнал не должен ломать синк (нет таблицы до миграции 0019 = события просто не пишутся).
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';

const { psnTokenEvents } = schema;

export type TokenEventKind = 'pasted' | 'refreshed' | 'expired' | 'from_env';
export type TokenEventDetails = Record<string, number | string | boolean | null>;

export const TOKEN_EVENTS_KEEP = 200;
/** refreshed пишется не чаще раза в это время, иначе шум от каждого часового access. */
export const REFRESHED_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;

async function lastOf(db: AnyDb): Promise<{ event: string; createdAt: Date } | null> {
  const [r] = await db.select({ event: psnTokenEvents.event, createdAt: psnTokenEvents.createdAt }).from(psnTokenEvents).orderBy(desc(psnTokenEvents.createdAt), desc(psnTokenEvents.id)).limit(1);
  return r ?? null;
}

async function insertEvent(db: AnyDb, event: TokenEventKind, o: { userId?: number | null; details?: TokenEventDetails; now: Date }): Promise<void> {
  await db.insert(psnTokenEvents).values({ event, userId: o.userId ?? null, details: o.details ?? null, createdAt: o.now });
  await db.delete(psnTokenEvents).where(sql`${psnTokenEvents.id} not in (select id from psn_token_events order by created_at desc, id desc limit ${TOKEN_EVENTS_KEEP})`);
}

/** Пишет событие; `dedupe` решает по последнему событию, писать ли. Не бросает. */
export async function recordTokenEvent(
  db: AnyDb,
  event: TokenEventKind,
  o: { userId?: number | null; details?: TokenEventDetails; now?: Date } = {},
): Promise<void> {
  const now = o.now ?? new Date();
  try {
    if (event === 'expired') {
      const last = await lastOf(db);
      if (last?.event === 'expired') return;
    } else if (event === 'refreshed') {
      const [r] = await db.select({ at: psnTokenEvents.createdAt }).from(psnTokenEvents).where(eq(psnTokenEvents.event, 'refreshed')).orderBy(desc(psnTokenEvents.createdAt)).limit(1);
      if (r && now.getTime() - r.at.getTime() < REFRESHED_MIN_INTERVAL_MS) return;
    }
    await insertEvent(db, event, { userId: o.userId, details: o.details, now });
  } catch {
    // журнал необязателен
  }
}

export type PsnTokenInfo = {
  issuedAt: string | null;
  ageSeconds: number | null;
  source: 'pasted' | 'from_env' | null;
  lastEvent: { event: TokenEventKind; at: string; details: unknown } | null;
};

/** Данные для /api/sync/status (контракт 27.4). null, если событий нет или таблицы нет. */
export async function getTokenInfo(db: AnyDb, now: Date = new Date()): Promise<{ info: PsnTokenInfo; lastNpssoAt: Date | null } | null> {
  try {
    const [last] = await db.select().from(psnTokenEvents).orderBy(desc(psnTokenEvents.createdAt), desc(psnTokenEvents.id)).limit(1);
    if (!last) return null;
    const [issued] = await db
      .select({ event: psnTokenEvents.event, at: psnTokenEvents.createdAt })
      .from(psnTokenEvents)
      .where(inArray(psnTokenEvents.event, ['pasted', 'from_env']))
      .orderBy(desc(psnTokenEvents.createdAt), desc(psnTokenEvents.id))
      .limit(1);
    return {
      lastNpssoAt: issued?.at ?? null,
      info: {
        issuedAt: issued ? issued.at.toISOString() : null,
        ageSeconds: issued ? Math.max(0, Math.floor((now.getTime() - issued.at.getTime()) / 1000)) : null,
        source: issued ? (issued.event as 'pasted' | 'from_env') : null,
        lastEvent: { event: last.event as TokenEventKind, at: last.createdAt.toISOString(), details: last.details ?? null },
      },
    };
  } catch {
    return null;
  }
}
