// Жизненный цикл запуска: старт, возобновление, закрытие брошенных. Контракт: 1.7, 8.2.
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { asUserId, type UserId } from '@/server/auth/user-id';
import { parseCursor, type PhaseName, type RunRow } from './context';
import { MAX_HOPS } from './engine';
import { mskDate } from './time';
import { HLTB_STALE_RUN_MS } from './hltb-slot';

export { HLTB_STALE_RUN_MS };

const { syncRuns } = schema;

// п. 3: слот массового прогона HLTB вынесен в hltb-slot.ts (без зависимости от engine)
export { closeStaleHltbRuns, hltbRunActive, startHltbRun, type HltbRunRow } from './hltb-slot';

export const STALE_RUN_MS = 15 * 60_000;
export const RESUME_WINDOW_MS = 6 * 3600_000;

export type RunKind = (typeof schema.syncRunKind.enumValues)[number];
export type StartResult =
  | { kind: 'started'; run: RunRow; resumed: boolean; /** restart (8.8): id отменённого идущего запуска */ cancelledRunId?: number | null }
  | { kind: 'already_running'; runId: number | null }
  | { kind: 'not_resumable' };

function isUniqueViolation(e: unknown): boolean {
  let x: unknown = e;
  for (let i = 0; i < 4 && x && typeof x === 'object'; i++) {
    if ((x as { code?: unknown }).code === '23505') return true;
    x = (x as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * running без признаков жизни дольше 15 минут -> failed/timeout. Данные не трогаются.
 * Строки kind='hltb' в sync_runs пишет только старый код (до п. 3, на время выката и при откате): для них порог 2 минуты.
 */
export async function closeStaleRuns(db: AnyDb, now: Date): Promise<number> {
  const threshold = new Date(now.getTime() - STALE_RUN_MS).toISOString();
  const hltbThreshold = new Date(now.getTime() - HLTB_STALE_RUN_MS).toISOString();
  const closed = await db
    .update(syncRuns)
    .set({ status: 'failed', errorReason: 'timeout', errorMessage: 'Запуск завис и закрыт автоматически.', finishedAt: now })
    .where(and(eq(syncRuns.status, 'running'), sql`coalesce((${syncRuns.cursor}->>'heartbeat')::timestamptz, ${syncRuns.startedAt}) < (case when ${syncRuns.kind} = 'hltb' then ${hltbThreshold}::timestamptz else ${threshold}::timestamptz end)`))
    .returning({ id: syncRuns.id });
  return closed.length;
}

async function resume(db: AnyDb, userId: UserId, row: RunRow, now: Date, keepHops: boolean): Promise<RunRow | null> {
  const cur = parseCursor(row.cursor);
  const [updated] = await db
    .update(syncRuns)
    .set({
      status: 'running',
      errorReason: null,
      errorMessage: null,
      finishedAt: null,
      phase: 'auth',
      cursor: { ...cur, hops: keepHops ? cur.hops : 0, heartbeat: now.toISOString() },
    })
    .where(and(eq(syncRuns.id, row.id), eq(syncRuns.userId, userId), eq(syncRuns.status, 'partial')))
    .returning();
  return updated ?? null;
}

export const CANCEL_MESSAGE_SELF = 'Остановлено пользователем.';
export const CANCEL_MESSAGE_OWNER = 'Остановлено владельцем.';

export type CancelledRun = { id: number; cursor: unknown; snapshotDate: string; startedAt: Date };

/**
 * Отмена идущего запуска пользователя (контракт 8.8): атомарно running -> failed/cancelled, слот освобождается сразу.
 * Данные, курсор и счётчики не трогаются. Нет запуска = null (идемпотентно). Запуски kind='hltb' не отменяются.
 */
export async function cancelRun(db: AnyDb, userId: UserId, now: Date, message: string = CANCEL_MESSAGE_SELF): Promise<CancelledRun | null> {
  const [row] = await db
    .update(syncRuns)
    .set({ status: 'failed', errorReason: 'cancelled', errorMessage: message, finishedAt: now })
    .where(and(eq(syncRuns.userId, userId), eq(syncRuns.status, 'running'), ne(syncRuns.kind, 'hltb')))
    .returning({ id: syncRuns.id, cursor: syncRuns.cursor, snapshotDate: syncRuns.snapshotDate, startedAt: syncRuns.startedAt });
  return row ?? null;
}

/**
 * «Перезапуск» (8.8): отмена идущего запуска и старт нового. Курсор (фаза) отменённого переносится в новый,
 * если тот начался в ту же дату МСК и не раньше RESUME_WINDOW назад; иначе новый идёт с фазы games.
 * Нет идущего запуска = обычный старт.
 */
export async function restartRun(db: AnyDb, userId: UserId, o: { kind: RunKind; now: Date }): Promise<StartResult> {
  const cancelled = await cancelRun(db, userId, o.now);
  const carry: PhaseName | undefined =
    cancelled && cancelled.snapshotDate === mskDate(o.now) && o.now.getTime() - cancelled.startedAt.getTime() < RESUME_WINDOW_MS ? parseCursor(cancelled.cursor).phase : undefined;
  const r = await startRun(db, userId, { kind: o.kind, now: o.now, carryPhase: carry });
  return r.kind === 'started' ? { ...r, cancelledRunId: cancelled?.id ?? null } : r;
}

export async function startRun(db: AnyDb, userId: UserId, o: { kind: RunKind; now: Date; continueRunId?: number; /** номер звена от отправителя; проверяется на принимающей стороне */ hop?: number; /** фаза отменённого запуска, с которой продолжить новый (8.8) */ carryPhase?: PhaseName }): Promise<StartResult> {
  const { now } = o;
  await closeStaleRuns(db, now);
  try {
    if (o.continueRunId !== undefined) {
      const [row] = await db.select().from(syncRuns).where(and(eq(syncRuns.id, o.continueRunId), eq(syncRuns.userId, userId))).limit(1);
      if (!row || row.status !== 'partial' || row.errorReason !== 'timeout') return { kind: 'not_resumable' };
      if (o.hop !== undefined && (o.hop > MAX_HOPS || o.hop !== parseCursor(row.cursor).hops)) return { kind: 'not_resumable' };
      if (parseCursor(row.cursor).hops > MAX_HOPS) return { kind: 'not_resumable' };
      const run = await resume(db, userId, row, now, true);
      return run ? { kind: 'started', run, resumed: true } : { kind: 'not_resumable' };
    }
    const [last] = await db.select().from(syncRuns).where(and(eq(syncRuns.userId, userId), ne(syncRuns.kind, 'hltb'))).orderBy(desc(syncRuns.startedAt), desc(syncRuns.id)).limit(1);
    if (last && last.status === 'partial' && now.getTime() - last.startedAt.getTime() < RESUME_WINDOW_MS) {
      const run = await resume(db, userId, last, now, false);
      if (run) return { kind: 'started', run, resumed: true };
    }
    const [run] = await db
      .insert(syncRuns)
      .values({
        userId,
        kind: o.kind,
        status: 'running',
        snapshotDate: mskDate(now),
        startedAt: now,
        phase: 'auth',
        cursor: { phase: o.carryPhase ?? 'games', hops: 0, heartbeat: now.toISOString() },
      })
      .returning();
    return { kind: 'started', run, resumed: o.carryPhase !== undefined && o.carryPhase !== 'games' };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const [running] = await db.select({ id: syncRuns.id }).from(syncRuns).where(eq(syncRuns.status, 'running')).limit(1);
    return { kind: 'already_running', runId: running?.id ?? null };
  }
}

/** Владелец запуска по id (для продолжения звена из cron: пользователь берётся из строки БД, не из запроса). */
export async function getRunUserId(db: AnyDb, runId: number): Promise<UserId | null> {
  const [row] = await db.select({ userId: syncRuns.userId }).from(syncRuns).where(eq(syncRuns.id, runId)).limit(1);
  return row ? asUserId(row.userId) : null;
}
