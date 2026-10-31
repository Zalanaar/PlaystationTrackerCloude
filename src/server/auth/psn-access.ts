// Ник PSN пользователя и проверка доступа к его профилю (контракт 22.13). Логика без HTTP: роут только мапит результат в коды.
import { and, asc, count, desc, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { getAccessToken } from '@/server/psn/auth';
import { checkProfileAccess, PSN_ONLINE_ID_RE, type AccessCheck } from '@/server/psn/access';
import type { PsnEnv } from '@/server/env';
import { getUserById, type UserRow } from './users';
import type { UserId } from './user-id';

const { allowedUsers, games, syncRuns } = schema;

/** Пауза между ручными проверками одного пользователя. */
export const ACCESS_COOLDOWN_MS = 30_000;
/** Автоматическая перепроверка `unavailable` / `friend_required`: не чаще раза в 6 ч на пользователя, при старте cron-обхода. */
export const RECHECK_AFTER_MS = 6 * 3_600_000;
/** Сколько пользователей перепроверять за один старт обхода (нагрузка на PSN). */
export const RECHECK_LIMIT = 5;

export type CheckFn = (onlineId: string) => Promise<AccessCheck>;

/** Проверка доступа техническим аккаунтом (токены из psn_auth, секреты вырезаются из сообщений). */
export function buildCheck(db: AnyDb, env: PsnEnv): CheckFn {
  const cfg = { npsso: env.npsso, encryptionKey: env.encryptionKey };
  return (onlineId) => checkProfileAccess({ getAccessToken: (force) => getAccessToken(db, cfg, { force }), secrets: [env.npsso, env.encryptionKey] }, onlineId);
}

export type PsnState = {
  onlineId: string | null;
  accessMode: string;
  accessStatus: string;
  checkedAt: string | null;
  canStartSync: boolean;
  onboardedAt: string | null;
  sync: { id: number; kind: string; status: string; phase: string | null; startedAt: string; finishedAt: string | null } | null;
};

export async function getPsnState(db: AnyDb, userId: UserId): Promise<PsnState | null> {
  let u = await getUserById(db, userId);
  if (!u) return null;
  // W-1: success-запуск есть, а onboarded_at не проставлен (сбой UPDATE, запуск до 20.4) -> дозаполняем, иначе member застрянет на онбординге
  if (!u.onboardedAt) {
    try {
      const [ok] = await db
        .select({ id: syncRuns.id })
        .from(syncRuns)
        .where(and(eq(syncRuns.userId, userId), eq(syncRuns.status, 'success'), ne(syncRuns.kind, 'hltb')))
        .limit(1);
      if (ok) {
        const now = new Date();
        await db.update(allowedUsers).set({ onboardedAt: now, updatedAt: now }).where(and(eq(allowedUsers.id, userId), isNull(allowedUsers.onboardedAt)));
        u = { ...u, onboardedAt: now };
      }
    } catch {
      // состояние читается и без отметки; следующий запрос повторит попытку
    }
  }
  const [run] = await db
    .select()
    .from(syncRuns)
    .where(and(eq(syncRuns.userId, userId), ne(syncRuns.kind, 'hltb')))
    .orderBy(desc(syncRuns.startedAt), desc(syncRuns.id))
    .limit(1);
  return {
    onlineId: u.psnOnlineId,
    accessMode: u.psnAccessMode,
    accessStatus: u.psnAccessStatus,
    checkedAt: u.psnAccessCheckedAt?.toISOString() ?? null,
    canStartSync: !!u.psnOnlineId && u.psnAccessStatus === 'ok',
    onboardedAt: u.onboardedAt?.toISOString() ?? null,
    sync: run
      ? { id: run.id, kind: run.kind, status: run.status, phase: run.phase, startedAt: run.startedAt.toISOString(), finishedAt: run.finishedAt?.toISOString() ?? null }
      : null,
  };
}

export type SetPsnResult =
  | { kind: 'ok'; state: PsnState }
  | { kind: 'invalid' }
  | { kind: 'taken' }
  | { kind: 'locked' }
  | { kind: 'rate_limited'; retryAfterSec: number }
  | { kind: 'not_found' | 'private' | 'friend_required' | 'unavailable' };

type AccessStatus = 'ok' | 'not_found' | 'private' | 'friend_required' | 'unavailable';

function toStatus(r: AccessCheck, mode: string): AccessStatus {
  if (r.status === 'private') return mode === 'friend' ? 'friend_required' : 'private';
  return r.status;
}

/** Записывает итог проверки. Рабочий ok-ник неудачной проверкой другого ника не затирается (пишется только время проверки). */
async function applyCheck(db: AnyDb, u: UserRow, onlineId: string, r: AccessCheck, now: Date): Promise<AccessStatus> {
  const status = toStatus(r, u.psnAccessMode);
  const sameNick = u.psnOnlineId?.toLowerCase() === onlineId.toLowerCase();
  if (status === 'ok' && r.status === 'ok') {
    await db.update(allowedUsers).set({ psnOnlineId: onlineId, psnAccountId: r.accountId, psnAccessStatus: 'ok', psnAccessCheckedAt: now, updatedAt: now }).where(eq(allowedUsers.id, u.id));
  } else if (u.psnAccessStatus === 'ok' && u.psnOnlineId && !sameNick) {
    await db.update(allowedUsers).set({ psnAccessCheckedAt: now, updatedAt: now }).where(eq(allowedUsers.id, u.id));
  } else {
    await db.update(allowedUsers).set({ psnOnlineId: onlineId, psnAccessStatus: status, psnAccessCheckedAt: now, updatedAt: now }).where(eq(allowedUsers.id, u.id));
  }
  return status;
}

/** PUT /api/me/psn. input не задан = перепроверка сохранённого ника. */
export async function setPsnAccess(db: AnyDb, userId: UserId, input: string | undefined, check: CheckFn, now: Date = new Date()): Promise<SetPsnResult> {
  const u = await getUserById(db, userId);
  if (!u) return { kind: 'invalid' };
  const onlineId = (input ?? u.psnOnlineId ?? '').trim();
  if (!PSN_ONLINE_ID_RE.test(onlineId)) return { kind: 'invalid' };

  if (u.psnAccessCheckedAt) {
    const wait = u.psnAccessCheckedAt.getTime() + ACCESS_COOLDOWN_MS - now.getTime();
    if (wait > 0) return { kind: 'rate_limited', retryAfterSec: Math.ceil(wait / 1000) };
  }
  const [dup] = await db
    .select({ id: allowedUsers.id })
    .from(allowedUsers)
    .where(and(ne(allowedUsers.id, userId), sql`lower(${allowedUsers.psnOnlineId}) = ${onlineId.toLowerCase()}`))
    .limit(1);
  if (dup) return { kind: 'taken' };

  const r = await check(onlineId);
  if (r.status === 'ok' && u.psnAccountId && u.psnAccountId !== r.accountId) {
    const [g] = await db.select({ n: count() }).from(games).where(eq(games.userId, userId));
    if (Number(g?.n ?? 0) > 0) return { kind: 'locked' };
  }
  const status = await applyCheck(db, u, onlineId, r, now);
  if (status === 'ok') {
    const state = await getPsnState(db, userId);
    return state ? { kind: 'ok', state } : { kind: 'invalid' };
  }
  return { kind: status };
}

/**
 * Автоматическая перепроверка при старте cron-обхода: активные пользователи со статусом unavailable / friend_required,
 * проверенные не позднее RECHECK_AFTER_MS назад. Сбой одного не мешает остальным. Возвращает число проверенных.
 */
export async function recheckPending(db: AnyDb, check: CheckFn, now: Date = new Date(), limit: number = RECHECK_LIMIT): Promise<number> {
  const rows = await db
    .select()
    .from(allowedUsers)
    .where(
      and(
        eq(allowedUsers.status, 'active'),
        inArray(allowedUsers.psnAccessStatus, ['unavailable', 'friend_required']),
        sql`${allowedUsers.psnOnlineId} is not null`,
        or(isNull(allowedUsers.psnAccessCheckedAt), lt(allowedUsers.psnAccessCheckedAt, new Date(now.getTime() - RECHECK_AFTER_MS))),
      ),
    )
    .orderBy(asc(allowedUsers.psnAccessCheckedAt), asc(allowedUsers.id))
    .limit(limit);
  let done = 0;
  for (const u of rows) {
    try {
      const r = await check(u.psnOnlineId as string);
      await applyCheck(db, u, u.psnOnlineId as string, r, now);
      done++;
    } catch {
      // один сбой не останавливает остальных; статус остаётся прежним и будет проверен при следующем обходе
    }
  }
  return done;
}
