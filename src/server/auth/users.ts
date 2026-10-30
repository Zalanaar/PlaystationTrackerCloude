// Белый список (allowed_users, контракт 22.2): чистый доступ к БД, db передаётся параметром (Neon в рантайме, PGlite в тестах).
// Email не логируется.
import { and, asc, count, eq, inArray, max, ne, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';

const { allowedUsers, games, syncRuns } = schema;

export type UserRow = typeof allowedUsers.$inferSelect;
export type Role = 'owner' | 'member';
export type UserStatus = 'invited' | 'active' | 'blocked';

export const EMAIL_RE = /^[^@\s]+@[^@\s]+$/;

/** trim + lower-case; точки Gmail не схлопываются. null, если не похоже на email. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

export async function getUserById(db: AnyDb, id: number): Promise<UserRow | null> {
  const [row] = await db.select().from(allowedUsers).where(eq(allowedUsers.id, id)).limit(1);
  return row ?? null;
}

/** Единственная строка role = owner. */
export async function getOwner(db: AnyDb): Promise<UserRow | null> {
  const [row] = await db.select().from(allowedUsers).where(eq(allowedUsers.role, 'owner')).limit(1);
  return row ?? null;
}

export type LoginLookup = { ok: true; user: UserRow } | { ok: false };

/**
 * Контракт 22.4 п.5-6: сначала по google_sub, иначе по email (привязка sub).
 * Строка с другим google_sub, blocked, нет в списке: одинаковый отказ { ok: false }.
 */
export async function lookupForLogin(db: AnyDb, sub: string, email: string): Promise<LoginLookup> {
  const [bySub] = await db.select().from(allowedUsers).where(eq(allowedUsers.googleSub, sub)).limit(1);
  let user = bySub ?? null;
  if (!user) {
    const [byEmail] = await db.select().from(allowedUsers).where(eq(allowedUsers.email, email)).limit(1);
    if (!byEmail) return { ok: false };
    if (byEmail.googleSub !== null && byEmail.googleSub !== sub) return { ok: false };
    user = byEmail;
  }
  if (user.status !== 'invited' && user.status !== 'active') return { ok: false };
  return { ok: true, user };
}

/** Привязка sub, invited -> active, last_login_at. false, если гонка/конфликт sub (отказ как обычно). */
export async function completeLogin(db: AnyDb, user: UserRow, sub: string, displayName: string | null, now: Date = new Date()): Promise<boolean> {
  try {
    const rows = await db
      .update(allowedUsers)
      .set({
        googleSub: sub,
        status: 'active',
        lastLoginAt: now,
        updatedAt: now,
        ...(displayName ? { displayName: displayName.slice(0, 200) } : {}),
      })
      .where(
        and(
          eq(allowedUsers.id, user.id),
          inArray(allowedUsers.status, ['invited', 'active']),
          // привязка только к пустому sub либо к тому же
          sql`(${allowedUsers.googleSub} is null or ${allowedUsers.googleSub} = ${sub})`,
        ),
      )
      .returning({ id: allowedUsers.id });
    return rows.length === 1;
  } catch {
    return false; // unique(google_sub): sub уже у другой строки
  }
}

export type AccessUser = {
  id: number;
  email: string;
  displayName: string | null;
  role: Role;
  status: UserStatus;
  psnOnlineId: string | null;
  psnAccessStatus: string;
  lastLoginAt: string | null;
  createdAt: string;
  gamesCount: number;
  lastSyncAt: string | null;
};

function toAccessUser(u: UserRow, gamesCount: number, lastSyncAt: Date | null): AccessUser {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role as Role,
    status: u.status as UserStatus,
    psnOnlineId: u.psnOnlineId,
    psnAccessStatus: u.psnAccessStatus,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    gamesCount,
    lastSyncAt: lastSyncAt?.toISOString() ?? null,
  };
}

/**
 * Пока данные не user-scoped (до 0014), общая коллекция принадлежит owner: gamesCount/lastSyncAt считаются только для него,
 * у остальных 0/null. В 20.3 заменяется на выборку по user_id.
 */
async function ownerStats(db: AnyDb): Promise<{ games: number; lastSync: Date | null }> {
  const [g] = await db.select({ n: count() }).from(games);
  const [s] = await db.select({ at: max(syncRuns.finishedAt) }).from(syncRuns).where(inArray(syncRuns.status, ['success', 'partial']));
  return { games: Number(g?.n ?? 0), lastSync: s?.at ?? null };
}

export async function listAccessUsers(db: AnyDb): Promise<AccessUser[]> {
  const rows = await db.select().from(allowedUsers).orderBy(asc(allowedUsers.id));
  const stats = rows.some((r) => r.role === 'owner') ? await ownerStats(db) : { games: 0, lastSync: null };
  return rows.map((u) => (u.role === 'owner' ? toAccessUser(u, stats.games, stats.lastSync) : toAccessUser(u, 0, null)));
}

export async function toAccessUserById(db: AnyDb, id: number): Promise<AccessUser | null> {
  const u = await getUserById(db, id);
  if (!u) return null;
  if (u.role !== 'owner') return toAccessUser(u, 0, null);
  const s = await ownerStats(db);
  return toAccessUser(u, s.games, s.lastSync);
}

export type CreateResult = { ok: true; id: number } | { ok: false; reason: 'exists' | 'limit' };

/** Создание member со статусом invited. Лимит и уникальность под advisory lock (одновременные POST не обходят MAX_USERS). */
export async function createMember(db: AnyDb, email: string, invitedBy: number, maxUsers: number, psnMode: 'public' | 'friend' = 'public'): Promise<CreateResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7204002)`);
    const [dup] = await tx.select({ id: allowedUsers.id }).from(allowedUsers).where(eq(allowedUsers.email, email)).limit(1);
    if (dup) return { ok: false as const, reason: 'exists' as const };
    const [c] = await tx.select({ n: count() }).from(allowedUsers).where(inArray(allowedUsers.status, ['invited', 'active']));
    if (Number(c?.n ?? 0) >= maxUsers) return { ok: false as const, reason: 'limit' as const };
    const [row] = await tx
      .insert(allowedUsers)
      .values({ email, role: 'member', status: 'invited', invitedBy, psnAccessMode: psnMode })
      .returning({ id: allowedUsers.id });
    return { ok: true as const, id: row.id };
  });
}

export type PatchResult = { ok: true } | { ok: false; reason: 'not_found' | 'owner_protected' | 'limit' };

/** Блокировка/разблокировка (blocked -> active, а если ни разу не входил, invited) и режим доступа к PSN. */
export async function patchUser(db: AnyDb, id: number, patch: { status?: 'active' | 'blocked'; psnAccessMode?: 'public' | 'friend' }, maxUsers: number): Promise<PatchResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7204002)`);
    const [u] = await tx.select().from(allowedUsers).where(eq(allowedUsers.id, id)).limit(1);
    if (!u) return { ok: false as const, reason: 'not_found' as const };
    const set: Partial<typeof allowedUsers.$inferInsert> = { updatedAt: new Date() };
    if (patch.status === 'blocked') {
      if (u.role === 'owner') return { ok: false as const, reason: 'owner_protected' as const };
      set.status = 'blocked';
    } else if (patch.status === 'active' && u.status === 'blocked') {
      const [c] = await tx.select({ n: count() }).from(allowedUsers).where(and(inArray(allowedUsers.status, ['invited', 'active']), ne(allowedUsers.id, id)));
      if (Number(c?.n ?? 0) >= maxUsers) return { ok: false as const, reason: 'limit' as const };
      set.status = u.googleSub === null && u.lastLoginAt === null ? 'invited' : 'active';
    }
    if (patch.psnAccessMode) set.psnAccessMode = patch.psnAccessMode;
    await tx.update(allowedUsers).set(set).where(eq(allowedUsers.id, id));
    return { ok: true as const };
  });
}

export type DeleteResult = { ok: true } | { ok: false; reason: 'not_found' | 'owner_protected' | 'not_blocked' | 'confirm_mismatch' };

/** Удаление (каскад по FK снесёт данные пользователя). Только blocked/invited; confirmEmail совпадает с email. */
export async function deleteUser(db: AnyDb, id: number, confirmEmail: string): Promise<DeleteResult> {
  return db.transaction(async (tx) => {
    const [u] = await tx.select().from(allowedUsers).where(eq(allowedUsers.id, id)).limit(1);
    if (!u) return { ok: false as const, reason: 'not_found' as const };
    if (u.role === 'owner') return { ok: false as const, reason: 'owner_protected' as const };
    if (u.status === 'active') return { ok: false as const, reason: 'not_blocked' as const };
    if (normalizeEmail(confirmEmail) !== u.email) return { ok: false as const, reason: 'confirm_mismatch' as const };
    await tx.delete(allowedUsers).where(eq(allowedUsers.id, id));
    return { ok: true as const };
  });
}

/** Идемпотентная вставка owner (db:bootstrap-owner). true, если вставили. */
export async function bootstrapOwner(db: AnyDb, email: string, psnOnlineId: string | null): Promise<boolean> {
  const rows = await db
    .insert(allowedUsers)
    .values({ email, role: 'owner', status: 'active', psnOnlineId, psnAccessStatus: psnOnlineId ? 'ok' : 'unchecked' })
    .onConflictDoNothing()
    .returning({ id: allowedUsers.id });
  return rows.length === 1;
}

