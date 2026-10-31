// Массовая подгрузка длительности HLTB отдельным запуском (контракт 16.7). К PSN не обращается.
import { and, eq } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { RunContext, type Warning } from './context';
import { HLTB_RUN_BUDGET_MS, hltbRun, type HltbDeps, type HltbRunResult } from './hltb-step';
import { startHltbRun } from './runs';

const { syncRuns } = schema;

export type HltbRunOutcome =
  | { kind: 'done'; result: HltbRunResult; warnings: Warning[] }
  | { kind: 'already_running'; runId: number | null };

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
  const ctx = new RunContext(o.db, started.run, now, o.budgetMs ?? HLTB_RUN_BUDGET_MS);
  try {
    const result = await hltbRun(ctx, o.deps, { batch: o.batch, recheckBefore: o.recheckBefore });
    ctx.counters.gamesSeen = result.processed + result.failed;
    ctx.counters.gamesUpserted = result.found;
    // HLTB-сбои = предупреждения, запись закрывается как success (16.7)
    await ctx.save(o.db, { status: 'success', errorReason: null, errorMessage: null, finishedAt: now(), cursor: null });
    return { kind: 'done', result, warnings: ctx.warnings };
  } catch (e) {
    // сюда попадает только сбой БД; сообщение без SQL-параметров
    const msg = e instanceof Error ? e.message.split('params:')[0].slice(0, 300) : 'internal';
    await o.db
      .update(syncRuns)
      .set({ status: 'failed', errorReason: 'internal', errorMessage: `Ошибка запуска HLTB: ${msg}`, finishedAt: now() })
      .where(and(eq(syncRuns.id, started.run.id), eq(syncRuns.userId, o.userId)))
      .catch(() => undefined);
    throw e;
  }
}
