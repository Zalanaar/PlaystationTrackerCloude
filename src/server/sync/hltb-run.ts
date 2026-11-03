// Массовая подгрузка длительности HLTB отдельным запуском (контракт 16.7). К PSN не обращается.
// П. 3: запуск живёт в hltb_runs со своим слотом running и не занимает слот синка (sync_runs).
import { and, eq } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { RunCancelledError, RunContext, type RunRow, type Warning } from './context';
import { HLTB_RUN_BUDGET_MS, hltbRun, type HltbDeps, type HltbRunResult } from './hltb-step';
import { startHltbRun, type HltbRunRow } from './hltb-slot';

const { hltbRuns, syncRuns } = schema;

export type HltbRunOutcome =
  | { kind: 'done'; result: HltbRunResult; warnings: Warning[] }
  | { kind: 'already_running'; runId: number | null };

/** Строка hltb_runs в форме RunRow: шаги HLTB работают с общим RunContext (бюджет, предупреждения, счётчики). */
function asRunRow(r: HltbRunRow): RunRow {
  return {
    id: r.id, userId: r.userId, kind: 'hltb', status: r.status, errorReason: r.errorReason, errorMessage: r.errorMessage,
    snapshotDate: '', startedAt: r.startedAt, finishedAt: r.finishedAt, phase: 'hltb', cursor: { phase: 'games', hops: 0 },
    gamesSeen: r.gamesSeen, gamesUpserted: r.gamesUpserted, snapshotsWritten: 0, trophySetsSynced: 0, trophiesUpserted: 0, warnings: r.warnings,
  };
}

/** RunContext, который пишет состояние в hltb_runs. Как и у синка: 0 обновлённых строк = запуск закрыт -> RunCancelledError. */
export class HltbRunContext extends RunContext {
  constructor(db: AnyDb, row: HltbRunRow, now: () => Date, budgetMs: number) {
    super(db, asRunRow(row), now, budgetMs);
  }

  override async save(db: AnyDb = this.db, extra: Partial<typeof syncRuns.$inferInsert> = {}): Promise<void> {
    const rows = await db
      .update(hltbRuns)
      .set({
        heartbeatAt: this.now(),
        gamesSeen: this.counters.gamesSeen,
        gamesUpserted: this.counters.gamesUpserted,
        warnings: this.warnings,
        ...(extra.status !== undefined ? { status: extra.status } : {}),
        ...(extra.errorReason !== undefined ? { errorReason: extra.errorReason } : {}),
        ...(extra.errorMessage !== undefined ? { errorMessage: extra.errorMessage } : {}),
        ...(extra.finishedAt !== undefined ? { finishedAt: extra.finishedAt } : {}),
      })
      .where(and(eq(hltbRuns.id, this.run.id), eq(hltbRuns.userId, this.userId), eq(hltbRuns.status, 'running')))
      .returning({ id: hltbRuns.id });
    if (rows.length === 0) throw new RunCancelledError(this.run.id);
  }
}

export async function runHltbMass(o: {
  db: AnyDb;
  userId: UserId;
  deps: HltbDeps;
  now?: () => Date;
  budgetMs?: number;
  batch?: number;
  recheckBefore?: Date;
}): Promise<HltbRunOutcome> {
  const now = o.now ?? (() => new Date());
  const started = await startHltbRun(o.db, o.userId, now());
  if (started.kind === 'already_running') return started;
  const ctx = new HltbRunContext(o.db, started.run, now, o.budgetMs ?? HLTB_RUN_BUDGET_MS);
  try {
    const result = await hltbRun(ctx, o.deps, { batch: o.batch, recheckBefore: o.recheckBefore });
    ctx.counters.gamesSeen = result.processed + result.failed;
    ctx.counters.gamesUpserted = result.found;
    // HLTB-сбои = предупреждения, запись закрывается как success (16.7)
    await ctx.save(o.db, { status: 'success', errorReason: null, errorMessage: null, finishedAt: now() });
    return { kind: 'done', result, warnings: ctx.warnings };
  } catch (e) {
    // сюда попадает только сбой БД; сообщение без SQL-параметров
    const msg = e instanceof Error ? e.message.split('params:')[0].slice(0, 300) : 'internal';
    await o.db
      .update(hltbRuns)
      .set({ status: 'failed', errorReason: 'internal', errorMessage: `Ошибка запуска HLTB: ${msg}`, finishedAt: now() })
      .where(and(eq(hltbRuns.id, started.run.id), eq(hltbRuns.userId, o.userId)))
      .catch(() => undefined);
    throw e;
  }
}
