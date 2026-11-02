// Фаза 45: отзыв сессий на сервере. «Выйти» = sid в revoked_sessions до истечения сессии; «Выйти на всех устройствах» = эпоха входа + 1.
import { eq, lt, sql } from 'drizzle-orm';
import { allowedUsers, revokedSessions } from '@/db/schema';
import type { AnyDb } from '@/db/types';
import { sessionRevocationKey, type Session } from './session';

/** true, если сессия отозвана выходом. */
export async function isSessionRevoked(db: AnyDb, session: Session): Promise<boolean> {
  const rows = await db.select({ sid: revokedSessions.sid }).from(revokedSessions).where(eq(revokedSessions.sid, sessionRevocationKey(session))).limit(1);
  return rows.length > 0;
}

/** Отзывает одну сессию (идемпотентно) и заодно удаляет записи уже истёкших сессий. */
export async function revokeSession(db: AnyDb, session: Session, now: Date = new Date()): Promise<void> {
  await db
    .insert(revokedSessions)
    .values({ sid: sessionRevocationKey(session), userId: session.uid, expiresAt: new Date(session.exp * 1000), revokedAt: now })
    .onConflictDoNothing();
  await db.delete(revokedSessions).where(lt(revokedSessions.expiresAt, now));
}

/** Отзывает все сессии входа: эпоха + 1. Возвращает новую эпоху или null, если строки нет. */
export async function revokeAllSessions(db: AnyDb, loginId: number): Promise<number | null> {
  const [row] = await db
    .update(allowedUsers)
    .set({ sessionEpoch: sql`${allowedUsers.sessionEpoch} + 1` })
    .where(eq(allowedUsers.id, loginId))
    .returning({ sessionEpoch: allowedUsers.sessionEpoch });
  return row?.sessionEpoch ?? null;
}
