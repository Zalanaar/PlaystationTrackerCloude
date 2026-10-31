// Кто и под каким ником участвует в синке (контракт 22.13). Чистая выборка из allowed_users.
import { and, asc, eq, gt } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { asUserId, type UserId } from '@/server/auth/user-id';
import type { UserRow } from '@/server/auth/users';

const { allowedUsers } = schema;

export type OnlineIdResolution = { kind: 'ok'; onlineId: string } | { kind: 'not_set' } | { kind: 'not_verified' };

/**
 * Ник PSN для синка пользователя. Свой ник требует psn_access_status = 'ok'. Владелец без своего ника читает fallback
 * (PSN_TARGET_ONLINE_ID, 22.12); остальным чужой ник из env не подставляется никогда.
 */
export function resolveOnlineIdFor(u: Pick<UserRow, 'role' | 'psnOnlineId' | 'psnAccessStatus'>, fallbackOnlineId: string): OnlineIdResolution {
  const own = u.psnOnlineId?.trim();
  if (own) return u.psnAccessStatus === 'ok' ? { kind: 'ok', onlineId: own } : { kind: 'not_verified' };
  return u.role === 'owner' ? { kind: 'ok', onlineId: fallbackOnlineId } : { kind: 'not_set' };
}

export type SyncUser = { id: UserId; role: 'owner' | 'member'; onlineId: string };

/** Активные пользователи, которых можно синкать, по возрастанию id (владелец первым). afterId: только с id больше. */
export async function listSyncUsers(db: AnyDb, fallbackOnlineId: string, o: { afterId?: number } = {}): Promise<SyncUser[]> {
  const rows = await db
    .select()
    .from(allowedUsers)
    .where(and(eq(allowedUsers.status, 'active'), o.afterId !== undefined ? gt(allowedUsers.id, o.afterId) : undefined))
    .orderBy(asc(allowedUsers.id));
  const out: SyncUser[] = [];
  for (const u of rows) {
    const r = resolveOnlineIdFor(u, fallbackOnlineId);
    if (r.kind === 'ok') out.push({ id: asUserId(u.id), role: u.role as 'owner' | 'member', onlineId: r.onlineId });
  }
  return out;
}
