// Правила статусов (docs/api-contract.md, 1.3 и 8.7). Синк сюда не пишет: вызывается из API смены статуса.
import { eq } from 'drizzle-orm';
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
    readonly code: 'not_found' | 'date_not_allowed',
    message: string,
  ) {
    super(message);
  }
}

/** Правило 5: ручная правка даты допустима только пока статус соответствует; меняется только эта дата. */
export function computeDateEdit(current: StatusRow | null, date: Date): StatusRow {
  if (!current || (current.status !== 'completed' && current.status !== 'dropped')) {
    throw new StatusRuleError('date_not_allowed', 'Дату можно править только у статусов «пройдено» и «брошено».');
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

/** Ручная правка completed_at / dropped_at. */
export async function setStatusDate(db: AnyDb, gameId: number, date: Date, now: Date = new Date()): Promise<StatusRow> {
  return db.transaction(async (tx) => {
    const { current } = await load(tx, gameId);
    const row = computeDateEdit(current, date);
    await tx
      .update(gameStatus)
      .set({ completedAt: row.completedAt, droppedAt: row.droppedAt, updatedAt: now })
      .where(eq(gameStatus.gameId, gameId));
    return row;
  });
}
