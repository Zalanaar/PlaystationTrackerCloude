// Фаза 8: скрытие игры (9.7), сброс статусов всей коллекции (9.8) и откат из бэкапа (9.9).
// Синк сюда не пишет. Все операции в одной транзакции, фиксированное число запросов (без N+1).
import { and, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { StatusBackupRow, StatusResetAllResponse, StatusRestoreResponse } from './types';
import { STATUS_VALUES } from './validation';
import { gameVisible } from './visibility';

const { games, gameStatus, statusBackups } = schema;

export const BACKUPS_KEEP = 10;

export class NotFoundError extends Error {}

/** 9.7: hidden=true ставит hidden_at = now (уже скрытая не трогается), false снимает. game_status не трогается. */
export async function setGameHidden(db: AnyDb, gameId: number, hidden: boolean, now: Date = new Date()): Promise<void> {
  const rows = await db
    .update(games)
    .set({ hiddenAt: hidden ? sql`coalesce(${games.hiddenAt}, ${now.toISOString()}::timestamptz)` : null })
    .where(eq(games.id, gameId))
    .returning({ id: games.id });
  if (!rows.length) throw new NotFoundError('Игра не найдена.');
}

type Tx = Parameters<Parameters<AnyDb['transaction']>[0]>[0];

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Строки game_status видимых игр в формате payload (1.12), по game_id. */
async function visibleStatusRows(tx: Tx): Promise<StatusBackupRow[]> {
  const rows = await tx.select().from(gameStatus).where(gameVisible(gameStatus.gameId)).orderBy(gameStatus.gameId);
  return rows.map((r) => ({
    gameId: r.gameId,
    status: r.status,
    completedAt: iso(r.completedAt),
    droppedAt: iso(r.droppedAt),
    statusChangedAt: r.statusChangedAt.toISOString(),
  }));
}

async function lock(tx: Tx) {
  // Сброс и откат не должны перемежаться (двойной клик, две вкладки).
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('status_backups'))`);
}

async function writeBackup(tx: Tx, reason: string, payload: StatusBackupRow[], now: Date): Promise<number> {
  const [b] = await tx.insert(statusBackups).values({ reason, payload, createdAt: now }).returning({ id: statusBackups.id });
  const keep = tx.select({ id: statusBackups.id }).from(statusBackups).orderBy(desc(statusBackups.id)).limit(BACKUPS_KEEP);
  await tx.delete(statusBackups).where(notInArray(statusBackups.id, keep));
  return b.id;
}

/** 9.8: снимок статусов видимых игр в status_backups и их удаление. 0 строк = бэкап не создаётся. */
export async function resetAllStatuses(db: AnyDb, now: Date = new Date()): Promise<StatusResetAllResponse> {
  return db.transaction(async (tx) => {
    await lock(tx);
    const rows = await visibleStatusRows(tx);
    if (!rows.length) return { backupId: null, reset: 0 };
    const backupId = await writeBackup(tx, 'reset_all', rows, now);
    await tx.delete(gameStatus).where(inArray(gameStatus.gameId, rows.map((r) => r.gameId)));
    return { backupId, reset: rows.length };
  });
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
export async function restoreStatuses(db: AnyDb, backupId: number, now: Date = new Date()): Promise<StatusRestoreResponse> {
  return db.transaction(async (tx) => {
    await lock(tx);
    const [b] = await tx.select({ payload: statusBackups.payload }).from(statusBackups).where(eq(statusBackups.id, backupId)).limit(1);
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
      ? new Set((await tx.select({ id: games.id }).from(games).where(and(inArray(games.id, ids), isNull(games.hiddenAt)))).map((g) => g.id))
      : new Set<number>();

    const current = await visibleStatusRows(tx);
    const beforeId = await writeBackup(tx, 'before_restore', current, now);
    await tx.delete(gameStatus).where(gameVisible(gameStatus.gameId));

    const values = [...parsed.values()]
      .filter((r) => visible.has(r.gameId))
      .map((r) => ({
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
