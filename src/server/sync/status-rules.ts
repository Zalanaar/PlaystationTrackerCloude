// Правила статусов (docs/api-contract.md, 1.3 и 8.7). Синк сюда не пишет: вызывается из API смены статуса.
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';

const { games, gameStatus } = schema;

export type StatusValue = (typeof schema.gameStatusValue.enumValues)[number];

export type StatusRow = {
  status: StatusValue;
  completedAt: Date | null;
  droppedAt: Date | null;
  statusChangedAt: Date;
};

export type Transition =
  | { action: 'noop' }
  | { action: 'delete' }
  | { action: 'upsert'; row: StatusRow };

/**
 * Правила 1-4: next = null сбрасывает в «без статуса» (DELETE); тот же статус ничего не трогает;
 * completed/dropped берут дату последнего запуска (если её нет, now); при уходе с них дата обнуляется.
 */
export function computeStatusChange(
  current: StatusRow | null,
  next: StatusValue | null,
  ctx: { lastPlayedAt: Date | null; now: Date },
): Transition {
  if (next === null) return current ? { action: 'delete' } : { action: 'noop' };
  if (current && current.status === next) return { action: 'noop' };
  const at = ctx.lastPlayedAt ?? ctx.now;
  return {
    action: 'upsert',
    row: {
      status: next,
      completedAt: next === 'completed' ? at : null,
      droppedAt: next === 'dropped' ? at : null,
      statusChangedAt: ctx.now,
    },
  };
}

export class StatusRuleError extends Error {
  constructor(
    readonly code: 'not_found' | 'date_not_allowed' | 'date_in_future',
    message: string,
    /** Для date_not_allowed: текущий статус игры (null = без статуса). */
    readonly currentStatus: StatusValue | null = null,
  ) {
    super(message);
  }
}

/** Правило 5: ручная правка даты допустима только пока статус соответствует; меняется только эта дата. */
export function computeDateEdit(current: StatusRow | null, date: Date): StatusRow {
  if (!current || (current.status !== 'completed' && current.status !== 'dropped')) {
    throw new StatusRuleError('date_not_allowed', 'Дату можно править только у статусов «пройдено» и «брошено».', current?.status ?? null);
  }
  return current.status === 'completed' ? { ...current, completedAt: date } : { ...current, droppedAt: date };
}

async function load(db: AnyDb, gameId: number) {
  const [g] = await db.select({ id: games.id, lastPlayedAt: games.lastPlayedAt }).from(games).where(eq(games.id, gameId)).limit(1);
  if (!g) throw new StatusRuleError('not_found', 'Игра не найдена.');
  const [cur] = await db.select().from(gameStatus).where(eq(gameStatus.gameId, gameId)).limit(1);
  return { game: g, current: cur ?? null };
}

/** Смена статуса с записью в БД. Возвращает итоговую строку или null («без статуса»). */
export async function setGameStatus(db: AnyDb, gameId: number, next: StatusValue | null, now: Date = new Date()): Promise<StatusRow | null> {
  return db.transaction(async (tx) => {
    const { game, current } = await load(tx, gameId);
    const t = computeStatusChange(current, next, { lastPlayedAt: game.lastPlayedAt, now });
    if (t.action === 'noop') return current;
    if (t.action === 'delete') {
      await tx.delete(gameStatus).where(eq(gameStatus.gameId, gameId));
      return null;
    }
    await tx
      .insert(gameStatus)
      .values({ gameId, ...t.row, updatedAt: now })
      .onConflictDoUpdate({ target: gameStatus.gameId, set: { ...t.row, updatedAt: now } });
    return t.row;
  });
}

/** Ручная правка completed_at / dropped_at. Дата не позже now (иначе date_in_future), проверка после соответствия статуса. */
export async function setStatusDate(
  db: AnyDb,
  gameId: number,
  date: Date,
  now: Date = new Date(),
  /** Если задано, поле должно соответствовать статусу (completedAt <-> completed, droppedAt <-> dropped). */
  field?: 'completedAt' | 'droppedAt',
): Promise<StatusRow> {
  return db.transaction(async (tx) => {
    const { current } = await load(tx, gameId);
    const want = field === 'completedAt' ? 'completed' : field === 'droppedAt' ? 'dropped' : null;
    if (want && current?.status !== want) {
      throw new StatusRuleError('date_not_allowed', 'Дата не соответствует статусу игры.', current?.status ?? null);
    }
    const row = computeDateEdit(current, date);
    if (date.getTime() > now.getTime()) throw new StatusRuleError('date_in_future', 'Дата не может быть в будущем.');
    await tx
      .update(gameStatus)
      .set({ completedAt: row.completedAt, droppedAt: row.droppedAt, updatedAt: now })
      .where(eq(gameStatus.gameId, gameId));
    return row;
  });
}

export class BulkMissingError extends Error {
  constructor(readonly missingIds: number[]) {
    super('Игры не найдены.');
  }
}

/**
 * Массовая смена статуса (контракт 9.6): одна транзакция, фиксированное число запросов
 * (чтение игр, чтение статусов, один upsert, один delete). Нет хотя бы одной игры (или она скрыта): BulkMissingError, ничего не записано.
 * Возвращает число реально изменённых игр.
 */
export async function setGamesStatusBulk(db: AnyDb, ids: number[], next: StatusValue | null, now: Date = new Date()): Promise<number> {
  const unique = [...new Set(ids)];
  if (!unique.length) return 0;
  return db.transaction(async (tx) => {
    // Скрытые игры (9.10) считаются отсутствующими.
    const found = await tx
      .select({ id: games.id, lastPlayedAt: games.lastPlayedAt })
      .from(games)
      .where(and(inArray(games.id, unique), isNull(games.hiddenAt)));
    if (found.length !== unique.length) {
      const have = new Set(found.map((g) => g.id));
      throw new BulkMissingError(unique.filter((i) => !have.has(i)).sort((a, b) => a - b));
    }
    const cur = await tx.select().from(gameStatus).where(inArray(gameStatus.gameId, unique));
    const curBy = new Map(cur.map((c) => [c.gameId, c as StatusRow]));
    const upserts: { gameId: number; row: StatusRow }[] = [];
    const deletes: number[] = [];
    for (const g of found) {
      const t = computeStatusChange(curBy.get(g.id) ?? null, next, { lastPlayedAt: g.lastPlayedAt, now });
      if (t.action === 'delete') deletes.push(g.id);
      else if (t.action === 'upsert') upserts.push({ gameId: g.id, row: t.row });
    }
    if (upserts.length) {
      await tx
        .insert(gameStatus)
        .values(upserts.map((u) => ({ gameId: u.gameId, ...u.row, updatedAt: now })))
        .onConflictDoUpdate({
          target: gameStatus.gameId,
          set: {
            status: sql`excluded.status`,
            completedAt: sql`excluded.completed_at`,
            droppedAt: sql`excluded.dropped_at`,
            statusChangedAt: sql`excluded.status_changed_at`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }
    if (deletes.length) await tx.delete(gameStatus).where(inArray(gameStatus.gameId, deletes));
    return upserts.length + deletes.length;
  });
}
