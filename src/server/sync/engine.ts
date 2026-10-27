// Одно звено синка: auth -> фазы по курсору до конца или до бюджета времени. Закрывает запись sync_runs.
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { PsnError, safeErr, type SyncErrorReason } from '@/server/psn/errors';
import type { PsnClient } from '@/server/psn/types';
import { PHASES, RunContext, type PhaseFn, type PhaseName, type RunRow } from './context';
import { gamesPhase, trophyLinkPhase, trophiesPhase, trophySetsPhase } from './phases';

const { syncRuns } = schema;

export const MAX_HOPS = 20;

export type SyncDeps = {
  db: AnyDb;
  /** Авторизация и профиль цели. Бросает PsnError. */
  connect: () => Promise<PsnClient>;
  now: () => Date;
  budgetMs: number;
  /** значения, которые нельзя оставлять в error_message */
  secrets?: ReadonlyArray<string | null | undefined>;
};

export type ChunkResult = {
  status: 'success' | 'partial' | 'failed';
  reason: SyncErrorReason | null;
  /** звену нужно самовызваться (остановка по бюджету и хопы не исчерпаны) */
  continueNext: boolean;
  /** номер звена (cursor.hops) для самовызова; есть, когда continueNext */
  hops?: number;
};

const PHASE_FNS: Record<PhaseName, PhaseFn> = {
  games: gamesPhase,
  trophy_sets: trophySetsPhase,
  trophy_link: trophyLinkPhase,
  trophies: trophiesPhase,
};

/** Сообщение о нашей ошибке: без SQL-параметров (в тексте Drizzle они есть). */
function internalMessage(e: unknown, secrets: SyncDeps['secrets']): string {
  const raw = e instanceof Error ? e.message : String(e);
  return 'Внутренняя ошибка синка: ' + safeErr(raw.split('params:')[0], secrets).slice(0, 300);
}

export async function runChunk(deps: SyncDeps, run: RunRow): Promise<ChunkResult> {
  const ctx = new RunContext(deps.db, run, deps.now, deps.budgetMs);
  const secrets = deps.secrets ?? [];

  const close = async (r: ChunkResult, message: string | null, cursorNull = false): Promise<ChunkResult> => {
    try {
      await ctx.save(deps.db, {
        status: r.status,
        errorReason: r.reason,
        errorMessage: message,
        finishedAt: deps.now(),
        ...(cursorNull ? { cursor: null } : {}),
      });
    } catch (e) {
      // БД недоступна: запись останется running и закроется как брошенная
      console.error('sync: не удалось закрыть запуск', safeErr(e, secrets));
    }
    return r;
  };

  try {
    const psn = await deps.connect();
    for (let i = Math.max(PHASES.indexOf(ctx.cursor.phase), 0); i < PHASES.length; i++) {
      const phase = PHASES[i];
      ctx.cursor = { ...ctx.cursor, phase };
      await ctx.save();
      const res = await PHASE_FNS[phase](ctx, psn);
      if (res === 'timeout') {
        ctx.cursor = { ...ctx.cursor, hops: ctx.cursor.hops + 1 };
        return await close({ status: 'partial', reason: 'timeout', continueNext: ctx.cursor.hops <= MAX_HOPS, hops: ctx.cursor.hops }, null);
      }
    }
    return await close({ status: 'success', reason: null, continueNext: false }, null, true);
  } catch (e) {
    if (e instanceof PsnError) {
      // игры ещё не записаны = ничего не сделано: failed; иначе есть что продолжать: partial
      const transient = e.reason === 'rate_limited' || e.reason === 'psn_unavailable';
      const started = ctx.cursor.phase !== 'games';
      return close({ status: transient && started ? 'partial' : 'failed', reason: e.reason, continueNext: false }, safeErr(e, secrets));
    }
    return close({ status: 'failed', reason: 'internal', continueNext: false }, internalMessage(e, secrets));
  }
}

/** Закрывает запуск как failed, если звено не удалось начать (например, не собрались зависимости). */
export async function failRun(db: AnyDb, runId: number, reason: SyncErrorReason, message: string, now: Date): Promise<void> {
  await db
    .update(syncRuns)
    .set({ status: 'failed', errorReason: reason, errorMessage: message.slice(0, 500), finishedAt: now })
    .where(eq(syncRuns.id, runId));
}
