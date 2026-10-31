// Фаза 8: скрытие игры (9.7), сброс статусов всей коллекции (9.8) и откат из бэкапа (9.9).
// Синк сюда не пишет. Все операции в одной транзакции, фиксированное число запросов (без N+1).
import { and, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import type { StatusBackupRow, StatusBackupsResponse,StatusResetAllResponse, StatusRestoreResponse } from './types';
import { STATUS_VALUES } from './validation';
import { gameVisible } from './visibility';

const { games, gameStatus, statusBackups } = schema;

export const BACKUPS_KEEP = 10;

export class NotFoundError extends Error {}

/** 9.7: hidden=true ставит hidden_at = now (уже скрытая не трогается), false снимает. game_status не трогается. */
export async function setGameHidden(db: AnyDb, userId: UserId, gameId: number, hidden: boolean, now: Date = new Date()): Promise<void> {
  const rows = await db
    .update(games)
    .set({ hiddenAt: hidden ? sql`coalesce(${games.hiddenAt}, ${now.toISOString()}::timestamptz)` : null })
    .where(and(eq(games.id, gameId), eq(games.userId, userId)))
    .returning({ id: games.id });
  if (!rows.length) throw new NotFoundError('Игра не найдена.');
}

/**
 * 25.5: «Это не дубль». {id} главная: отвязываются все её дубли (или только versionId, он обязан быть её дублем);
 * {id} сама дубль: отвязывается она. Отвязанным ставится not_duplicate = true (синк больше не склеивает). Идемпотентно.
 */
export async function setNotDuplicate(db: AnyDb, userId: UserId, gameId: number, versionId: number | null): Promise<void> {
  await db.transaction(async (tx) => {
    const [g] = await tx.select({ id: games.id, of: games.duplicateOfGameId }).from(games).where(and(eq(games.id, gameId), eq(games.userId, userId))).limit(1);
    if (!g) throw new NotFoundError('Игра не найдена.');
    let targets: number[];
    if (g.of !== null) targets = [g.id];
    else {
      const dups = await tx.select({ id: games.id }).from(games).where(and(eq(games.userId, userId), eq(games.duplicateOfGameId, gameId)));
      const ids = dups.map((d) => d.id);
      if (versionId !== null) {
        // уже отвязанная версия (повтор запроса) допустима, если принадлежит пользователю и не равна другой чужой группе
        if (ids.includes(versionId)) targets = [versionId];
        else {
          const [v] = await tx.select({ id: games.id, nd: games.notDuplicate, of: games.duplicateOfGameId }).from(games).where(and(eq(games.id, versionId), eq(games.userId, userId))).limit(1);
          if (!v || !v.nd || v.of !== null) throw new NotFoundError('Игра не найдена.');
          targets = [];
        }
      } else targets = ids;
    }
    if (targets.length) {
      await tx.update(games).set({ duplicateOfGameId: null, notDuplicate: true }).where(and(eq(games.userId, userId), inArray(games.id, targets)));
    }
  });
}

/** 16.5: ручная длительность (hours) или сброс (null). Статус и остальные поля не трогаются. */
export async function setDurationOverride(db: AnyDb, userId: UserId, gameId: number, hours: number | null): Promise<void> {
  const rows = await db.update(games).set({ durationOverrideHours: hours }).where(and(eq(games.id, gameId), eq(games.userId, userId))).returning({ id: games.id });
  if (!rows.length) throw new NotFoundError('Игра не найдена.');
}

type Tx = Parameters<Parameters<AnyDb['transaction']>[0]>[0];

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Строки game_status видимых игр в формате payload (1.12), по game_id. */
async function visibleStatusRows(tx: Tx, userId: UserId): Promise<StatusBackupRow[]> {
  const rows = await tx.select().from(gameStatus).where(and(eq(gameStatus.userId, userId), gameVisible(gameStatus.gameId, userId))).orderBy(gameStatus.gameId);
  return rows.map((r) => ({
    gameId: r.gameId,
    status: r.status,
    completedAt: iso(r.completedAt),
    droppedAt: iso(r.droppedAt),
    statusChangedAt: r.statusChangedAt.toISOString(),
  }));
}

async function lock(tx: Tx, userId: UserId) {
  // Сброс и откат не должны перемежаться (двойной клик, две вкладки).
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`status_backups:${userId}`}))`);
}

async function writeBackup(tx: Tx, userId: UserId, reason: string, payload: StatusBackupRow[], now: Date): Promise<number> {
  const [b] = await tx.insert(statusBackups).values({ userId, reason, payload, createdAt: now }).returning({ id: statusBackups.id });
  const keep = tx.select({ id: statusBackups.id }).from(statusBackups).where(eq(statusBackups.userId, userId)).orderBy(desc(statusBackups.id)).limit(BACKUPS_KEEP);
  await tx.delete(statusBackups).where(and(eq(statusBackups.userId, userId), notInArray(statusBackups.id, keep)));
  return b.id;
}

/**
 * Копия ВСЕХ строк game_status (включая скрытые игры) перед восстановлением из файла (контракт 20.3). В транзакции вызывающего.
 * Возвращает id копии или null, если статусов нет.
 */
export async function snapshotAllStatuses(tx: Tx, userId: UserId, reason: string, now: Date): Promise<number | null> {
  await lock(tx, userId);
  const rows = await tx.select().from(gameStatus).where(eq(gameStatus.userId, userId)).orderBy(gameStatus.gameId);
  if (!rows.length) return null;
  const payload: StatusBackupRow[] = rows.map((r) => ({
    gameId: r.gameId,
    status: r.status,
    completedAt: iso(r.completedAt),
    droppedAt: iso(r.droppedAt),
    statusChangedAt: r.statusChangedAt.toISOString(),
  }));
  return writeBackup(tx, userId, reason, payload, now);
}

/** 9.8: снимок статусов видимых игр в status_backups и их удаление. 0 строк = бэкап не создаётся. */
export async function resetAllStatuses(db: AnyDb, userId: UserId, now: Date = new Date()): Promise<StatusResetAllResponse> {
  return db.transaction(async (tx) => {
    await lock(tx, userId);
    const rows = await visibleStatusRows(tx, userId);
    if (!rows.length) return { backupId: null, reset: 0 };
    const backupId = await writeBackup(tx, userId, 'reset_all', rows, now);
    await tx.delete(gameStatus).where(and(eq(gameStatus.userId, userId), inArray(gameStatus.gameId, rows.map((r) => r.gameId))));
    return { backupId, reset: rows.length };
  });
}

/** 9.9a: последняя копия reset_all (count = длина payload). Откат её не удаляет. */
export async function getLatestResetBackup(db: AnyDb, userId: UserId): Promise<StatusBackupsResponse> {
  const [b] = await db
    .select({ id: statusBackups.id, createdAt: statusBackups.createdAt, payload: statusBackups.payload })
    .from(statusBackups)
    .where(and(eq(statusBackups.userId, userId), eq(statusBackups.reason, 'reset_all')))
    .orderBy(desc(statusBackups.id))
    .limit(1);
  if (!b) return { latest: null };
  return {
    latest: { id: b.id, createdAt: b.createdAt.toISOString(), reason: 'reset_all', count: Array.isArray(b.payload) ? b.payload.length : 0 },
  };
}

const isoDate = z.iso.datetime({ offset: true }).nullable();
const backupRowSchema = z
  .object({
    gameId: z.number().int().positive(),
    status: z.enum(STATUS_VALUES),
    completedAt: isoDate,
    droppedAt: isoDate,
    statusChangedAt: z.iso.datetime({ offset: true }),
  })
  // те же CHECK, что у game_status (1.3): дата только при соответствующем статусе
  .refine((r) => (r.completedAt === null || r.status === 'completed') && (r.droppedAt === null || r.status === 'dropped'));

/**
 * 9.9: статусы видимых игр становятся ровно как в бэкапе. Перед этим текущее состояние сохраняется (before_restore).
 * Строки по отсутствующим/скрытым играм и некорректные строки пропускаются.
 */
export async function restoreStatuses(db: AnyDb, userId: UserId, backupId: number, now: Date = new Date()): Promise<StatusRestoreResponse> {
  return db.transaction(async (tx) => {
    await lock(tx, userId);
    const [b] = await tx.select({ payload: statusBackups.payload }).from(statusBackups).where(and(eq(statusBackups.id, backupId), eq(statusBackups.userId, userId))).limit(1);
    if (!b) throw new NotFoundError('Бэкап не найден.');
    const raw: unknown[] = Array.isArray(b.payload) ? b.payload : [];

    const parsed = new Map<number, z.infer<typeof backupRowSchema>>();
    let skipped = 0;
    for (const item of raw) {
      const r = backupRowSchema.safeParse(item);
      if (!r.success || parsed.has(r.data.gameId)) skipped++;
      else parsed.set(r.data.gameId, r.data);
    }
    const ids = [...parsed.keys()];
    const visible = ids.length
      ? new Set((await tx.select({ id: games.id }).from(games).where(and(eq(games.userId, userId), inArray(games.id, ids), isNull(games.hiddenAt)))).map((g) => g.id))
      : new Set<number>();

    const current = await visibleStatusRows(tx, userId);
    const beforeId = await writeBackup(tx, userId, 'before_restore', current, now);
    await tx.delete(gameStatus).where(and(eq(gameStatus.userId, userId), gameVisible(gameStatus.gameId, userId)));

    const values = [...parsed.values()]
      .filter((r) => visible.has(r.gameId))
      .map((r) => ({
        userId,
        gameId: r.gameId,
        status: r.status,
        completedAt: r.completedAt ? new Date(r.completedAt) : null,
        droppedAt: r.droppedAt ? new Date(r.droppedAt) : null,
        statusChangedAt: new Date(r.statusChangedAt),
        updatedAt: now,
      }));
    skipped += parsed.size - values.length;
    if (values.length) await tx.insert(gameStatus).values(values);
    return { restored: values.length, skipped, backupId: beforeId };
  });
}
