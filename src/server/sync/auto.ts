// Идея 1 из аудита UX: автосинк при открытии приложения, если данным больше 6 ч (крон Hobby — раз в сутки, 23:00 МСК).
// Решение принимает сервер по БД, не клиент: не чаще одного запуска на профиль за 6 ч (любой запуск — ручной, ночной,
// неудачный — сбрасывает окно), не во время идущего синка и не до первого успешного синка (его запускает онбординг).
import { and, desc, eq, ne } from 'drizzle-orm';
import { syncRuns } from '@/db/schema';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';

export const AUTO_SYNC_STALE_MS = 6 * 3600_000;

export type AutoSyncInputs = { last: { status: string; startedAt: Date } | null; lastSuccessAt: Date | null };
export type AutoSyncDecision = { go: true } | { go: false; reason: 'never' | 'running' | 'recent' };

export function autoSyncDecision(i: AutoSyncInputs, now: Date): AutoSyncDecision {
  if (!i.lastSuccessAt) return { go: false, reason: 'never' };
  if (i.last?.status === 'running') return { go: false, reason: 'running' };
  const t = now.getTime();
  if (i.last && t - i.last.startedAt.getTime() < AUTO_SYNC_STALE_MS) return { go: false, reason: 'recent' };
  if (t - i.lastSuccessAt.getTime() < AUTO_SYNC_STALE_MS) return { go: false, reason: 'recent' };
  return { go: true };
}

export async function loadAutoSyncInputs(db: AnyDb, userId: UserId): Promise<AutoSyncInputs> {
  const notHltb = and(eq(syncRuns.userId, userId), ne(syncRuns.kind, 'hltb'));
  const [last] = await db.select({ status: syncRuns.status, startedAt: syncRuns.startedAt }).from(syncRuns).where(notHltb)
    .orderBy(desc(syncRuns.startedAt), desc(syncRuns.id)).limit(1);
  const [ok] = await db.select({ finishedAt: syncRuns.finishedAt }).from(syncRuns).where(and(notHltb, eq(syncRuns.status, 'success')))
    .orderBy(desc(syncRuns.startedAt), desc(syncRuns.id)).limit(1);
  return { last: last ?? null, lastSuccessAt: ok?.finishedAt ?? null };
}
