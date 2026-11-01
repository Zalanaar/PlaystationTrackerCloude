// Профили PSN у одного входа (Фаза 41, контракт 41.1-41.4). Профиль = строка allowed_users с primary_user_id = id основного.
// Чистая логика БД без HTTP: loginId приходит ТОЛЬКО из сессии, db передаётся параметром. Ники и email в логи не пишутся.
import { and, asc, count, eq, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { PSN_ONLINE_ID_RE, type AccessCheck } from '@/server/psn/access';
import { isSyncRunningFresh } from '@/server/sync/overdue';
import { asUserId } from './user-id';
import { statsByUser, type UserRow } from './users';

const { allowedUsers } = schema;

export const ARCHIVE_DAYS = 30;
export const ARCHIVE_MS = ARCHIVE_DAYS * 24 * 3_600_000;
/** Пауза между добавлениями профиля одним входом (41.3). */
export const ADD_COOLDOWN_MS = 30_000;
const LOCK_KEY = 7204002;

export type Profile = {
  id: number;
  isPrimary: boolean;
  onlineId: string | null;
  accessStatus: string;
  onboardedAt: string | null;
  canStartSync: boolean;
  gamesCount: number;
  lastSyncAt: string | null;
};
export type ArchivedProfile = { id: number; onlineId: string | null; archivedAt: string; purgeAt: string };
export type ProfileLimits = { maxProfiles: number; maxUsers: number };
export type ProfilesView = { loginId: number; activeProfileId: number; limit: number; canAdd: boolean; profiles: Profile[]; archived: ArchivedProfile[] };

const loginOf = sql`coalesce(${allowedUsers.primaryUserId}, ${allowedUsers.id})`;

function toProfile(u: UserRow, games: number, lastSync: Date | null): Profile {
  return {
    id: u.id,
    isPrimary: u.primaryUserId === null,
    onlineId: u.psnOnlineId,
    accessStatus: u.psnAccessStatus,
    onboardedAt: u.onboardedAt?.toISOString() ?? null,
    canStartSync: !!u.psnOnlineId && u.psnAccessStatus === 'ok',
    gamesCount: games,
    lastSyncAt: lastSync?.toISOString() ?? null,
  };
}

/** Активные строки входа: основной первым, дальше по id. */
async function activeRows(db: AnyDb, loginId: number): Promise<UserRow[]> {
  return db
    .select()
    .from(allowedUsers)
    .where(and(eq(allowedUsers.status, 'active'), sql`${loginOf} = ${loginId}`))
    .orderBy(sql`${allowedUsers.primaryUserId} is null desc`, asc(allowedUsers.id));
}

export async function listProfiles(db: AnyDb, loginId: number, activeProfileId: number, lim: ProfileLimits): Promise<ProfilesView> {
  const rows = await activeRows(db, loginId);
  const stats = await statsByUser(db, rows.map((r) => r.id));
  const archivedRows = await db
    .select()
    .from(allowedUsers)
    .where(and(eq(allowedUsers.status, 'archived'), eq(allowedUsers.primaryUserId, loginId)))
    .orderBy(asc(allowedUsers.archivedAt));
  const [total] = await db.select({ n: count() }).from(allowedUsers).where(inArray(allowedUsers.status, ['invited', 'active']));
  return {
    loginId,
    activeProfileId,
    limit: lim.maxProfiles,
    canAdd: rows.length < lim.maxProfiles && Number(total?.n ?? 0) < lim.maxUsers,
    profiles: rows.map((u) => toProfile(u, stats.get(u.id)?.games ?? 0, stats.get(u.id)?.lastSync ?? null)),
    archived: archivedRows.map((u) => {
      const at = u.archivedAt ?? u.updatedAt;
      return { id: u.id, onlineId: u.psnOnlineId, archivedAt: at.toISOString(), purgeAt: new Date(at.getTime() + ARCHIVE_MS).toISOString() };
    }),
  };
}

export async function getProfileDto(db: AnyDb, loginId: number, profileId: number): Promise<Profile | null> {
  const [u] = await db
    .select()
    .from(allowedUsers)
    .where(and(eq(allowedUsers.id, profileId), eq(allowedUsers.status, 'active'), sql`${loginOf} = ${loginId}`))
    .limit(1);
  if (!u) return null;
  const s = (await statsByUser(db, [u.id])).get(u.id);
  return toProfile(u, s?.games ?? 0, s?.lastSync ?? null);
}

/** Лёгкий список для переключателя (/api/auth/me): без счётчиков. */
export async function listProfilesLight(db: AnyDb, loginId: number): Promise<{ id: number; onlineId: string | null; isPrimary: boolean }[]> {
  return (await activeRows(db, loginId)).map((u) => ({ id: u.id, onlineId: u.psnOnlineId, isPrimary: u.primaryUserId === null }));
}

/** Профиль доступен для переключения: active и принадлежит входу сессии. Чужой/архивный/несуществующий неразличимы (null). */
export async function findSwitchTarget(db: AnyDb, loginId: number, profileId: number): Promise<Profile | null> {
  return getProfileDto(db, loginId, profileId);
}

function isUniqueViolation(e: unknown): boolean {
  for (let x: unknown = e, i = 0; x && typeof x === 'object' && i < 4; i++) {
    const o = x as { code?: unknown; message?: unknown; cause?: unknown };
    if (o.code === '23505') return true;
    if (typeof o.message === 'string' && /duplicate key|unique constraint/i.test(o.message)) return true;
    x = o.cause;
  }
  return false;
}

export type AddProfileResult =
  | { kind: 'created' | 'restored'; profileId: number }
  | { kind: 'invalid' | 'profile_limit' | 'user_limit' | 'taken' | 'not_found' | 'private' | 'login_inactive' }
  | { kind: 'rate_limited'; retryAfterSec: number }
  | { kind: 'unavailable' };

// Отказы проверки по входу в памяти процесса (best effort между инстансами); успешные добавления ограничивает created_at в БД.
const lastAttempt = new Map<number, number>();
export function resetAddProfileThrottle(): void {
  lastAttempt.clear();
}

export type AddProfileInput = {
  loginId: number;
  onlineId: string;
  check: (onlineId: string) => Promise<AccessCheck>;
  limits: ProfileLimits;
  /** public: закрытый профиль = отказ psn_private; friend: строка создаётся со статусом friend_required (план Б 22.2). */
  mode: 'public' | 'friend';
  /** PSN_TARGET_ONLINE_ID: ник владельца занят (кроме случая, когда у основного профиля владельца свой другой ник). */
  ownerOnlineId?: string | null;
  now?: Date;
};

async function limitsReason(tx: AnyDb, loginId: number, lim: ProfileLimits, excludeId?: number): Promise<'profile_limit' | 'user_limit' | null> {
  const mine = await tx
    .select({ n: count() })
    .from(allowedUsers)
    .where(and(eq(allowedUsers.status, 'active'), sql`${loginOf} = ${loginId}`, excludeId ? ne(allowedUsers.id, excludeId) : undefined));
  if (Number(mine[0]?.n ?? 0) >= lim.maxProfiles) return 'profile_limit';
  const all = await tx.select({ n: count() }).from(allowedUsers).where(and(inArray(allowedUsers.status, ['invited', 'active']), excludeId ? ne(allowedUsers.id, excludeId) : undefined));
  return Number(all[0]?.n ?? 0) >= lim.maxUsers ? 'user_limit' : null;
}

/**
 * POST /api/me/profiles (41.3). Порядок: формат ника -> пауза -> лимиты -> занятость ника -> проверка PSN -> запись под advisory lock
 * (лимиты проверяются повторно, гонка за один ник/аккаунт решается unique-индексами). Строка создаётся только при результате ok
 * (или friend_required в режиме friend); при ошибках «полупрофилей» не остаётся.
 */
export async function addProfile(db: AnyDb, i: AddProfileInput): Promise<AddProfileResult> {
  const now = i.now ?? new Date();
  const onlineId = i.onlineId.trim();
  if (!PSN_ONLINE_ID_RE.test(onlineId)) return { kind: 'invalid' };
  const nick = onlineId.toLowerCase();

  const [login] = await db.select().from(allowedUsers).where(eq(allowedUsers.id, i.loginId)).limit(1);
  if (!login || login.primaryUserId !== null || login.status !== 'active') return { kind: 'login_inactive' };

  const prev = lastAttempt.get(i.loginId) ?? 0;
  const [lastCreated] = await db
    .select({ at: sql<Date | null>`max(${allowedUsers.createdAt})` })
    .from(allowedUsers)
    .where(and(eq(allowedUsers.primaryUserId, i.loginId)));
  const dbLast = lastCreated?.at ? new Date(lastCreated.at).getTime() : 0;
  const wait = Math.max(prev, dbLast) + ADD_COOLDOWN_MS - now.getTime();
  if (wait > 0) return { kind: 'rate_limited', retryAfterSec: Math.ceil(wait / 1000) };

  const early = await limitsReason(db, i.loginId, i.limits);
  if (early) return { kind: early };

  const env = i.ownerOnlineId?.trim().toLowerCase();
  if (env && env === nick) {
    const ownLogin = login.role === 'owner';
    const ownNick = login.psnOnlineId?.trim().toLowerCase();
    if (!ownLogin || !ownNick || ownNick === nick) return { kind: 'taken' };
  }
  const [dup] = await db
    .select({ id: allowedUsers.id })
    .from(allowedUsers)
    .where(and(ne(allowedUsers.status, 'archived'), sql`lower(${allowedUsers.psnOnlineId}) = ${nick}`))
    .limit(1);
  if (dup) return { kind: 'taken' };

  lastAttempt.set(i.loginId, now.getTime());
  let r: AccessCheck;
  try {
    r = await i.check(onlineId);
  } catch {
    return { kind: 'unavailable' };
  }
  if (r.status === 'unavailable') return { kind: 'unavailable' };
  if (r.status === 'not_found') return { kind: 'not_found' };
  if (r.status === 'private' && i.mode !== 'friend') return { kind: 'private' };
  const accessStatus = r.status === 'ok' ? 'ok' : 'friend_required';
  const accountId = r.status === 'ok' ? r.accountId : null;

  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY})`);
      const [l] = await tx.select().from(allowedUsers).where(eq(allowedUsers.id, i.loginId)).limit(1);
      if (!l || l.primaryUserId !== null || l.status !== 'active') return { kind: 'login_inactive' as const };
      // восстановление из архива этого входа: тот же аккаунт PSN (или, если аккаунта нет, тот же ник)
      const [arch] = await tx
        .select()
        .from(allowedUsers)
        .where(
          and(
            eq(allowedUsers.status, 'archived'),
            eq(allowedUsers.primaryUserId, i.loginId),
            accountId ? sql`(${allowedUsers.psnAccountId} = ${accountId} or lower(${allowedUsers.psnOnlineId}) = ${nick})` : sql`lower(${allowedUsers.psnOnlineId}) = ${nick}`,
          ),
        )
        .orderBy(sql`${allowedUsers.archivedAt} desc`)
        .limit(1);
      const lim = await limitsReason(tx, i.loginId, i.limits);
      if (lim) return { kind: lim };
      if (arch) {
        await tx
          .update(allowedUsers)
          .set({ status: 'active', archivedAt: null, psnOnlineId: onlineId, psnAccountId: accountId ?? arch.psnAccountId, psnAccessStatus: accessStatus, psnAccessCheckedAt: now, updatedAt: now, ...(accessStatus === 'ok' ? { onboardedAt: arch.onboardedAt ?? now } : {}) })
          .where(eq(allowedUsers.id, arch.id));
        return { kind: 'restored' as const, profileId: arch.id };
      }
      const [row] = await tx
        .insert(allowedUsers)
        .values({
          email: l.email,
          role: 'member',
          status: 'active',
          primaryUserId: l.id,
          invitedBy: l.id,
          psnOnlineId: onlineId,
          psnAccountId: accountId,
          psnAccessMode: i.mode,
          psnAccessStatus: accessStatus,
          psnAccessCheckedAt: now,
          // ник проверен при добавлении -> онбординг не нужен (QA-41-1); при friend_required онбординг остаётся
          onboardedAt: accessStatus === 'ok' ? now : null,
          tourVersion: l.tourVersion,
          tourCompletedAt: l.tourCompletedAt,
        })
        .returning({ id: allowedUsers.id });
      return { kind: 'created' as const, profileId: row.id };
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { kind: 'taken' };
    throw e;
  }
}

export type RemoveProfileResult =
  | { kind: 'archived' | 'purged' }
  | { kind: 'not_found' | 'primary_protected' | 'sync_in_progress' | 'confirm_mismatch' };

/** DELETE /api/me/profiles/{id} (41.3): архив по умолчанию (30 дней), purge = безвозвратно. Чужой/несуществующий профиль = not_found. */
export async function removeProfile(db: AnyDb, loginId: number, profileId: number, confirmOnlineId: string, purge: boolean, now: Date = new Date()): Promise<RemoveProfileResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY})`);
    const [u] = await tx.select().from(allowedUsers).where(and(eq(allowedUsers.id, profileId), sql`${loginOf} = ${loginId}`)).limit(1);
    if (!u) return { kind: 'not_found' as const };
    if (u.primaryUserId === null) return { kind: 'primary_protected' as const };
    if ((u.psnOnlineId ?? '').trim().toLowerCase() !== confirmOnlineId.trim().toLowerCase() || !u.psnOnlineId) return { kind: 'confirm_mismatch' as const };
    if (await isSyncRunningFresh(tx, asUserId(u.id), now)) return { kind: 'sync_in_progress' as const };
    if (purge) {
      await tx.delete(allowedUsers).where(eq(allowedUsers.id, u.id)); // каскад по FK сносит данные профиля
      return { kind: 'purged' as const };
    }
    if (u.status !== 'archived') await tx.update(allowedUsers).set({ status: 'archived', archivedAt: now, updatedAt: now }).where(eq(allowedUsers.id, u.id));
    return { kind: 'archived' as const };
  });
}

/** Watchdog (41.4): физическое удаление архивных профилей старше 30 дней (каскад). Возвращает число удалённых. */
export async function purgeExpiredArchive(db: AnyDb, now: Date = new Date()): Promise<number> {
  const rows = await db
    .delete(allowedUsers)
    .where(and(eq(allowedUsers.status, 'archived'), isNotNull(allowedUsers.archivedAt), lt(allowedUsers.archivedAt, new Date(now.getTime() - ARCHIVE_MS))))
    .returning({ id: allowedUsers.id });
  return rows.length;
}
