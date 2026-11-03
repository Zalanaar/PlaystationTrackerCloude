// Одно звено синка: auth -> фазы по курсору до конца или до бюджета времени. Закрывает запись sync_runs.
import { and, eq } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { PsnError, safeErr, type SyncErrorReason } from '@/server/psn/errors';
import type { PsnClient } from '@/server/psn/types';
import { PHASES, RunCancelledError, RunContext, type PhaseFn, type PhaseName, type RunRow } from './context';
import { gamesPhase, trophyLinkPhase, trophiesPhase, trophySetsPhase } from './phases';
import { applyDuplicates } from './duplicates';
import { hltbStep, type HltbDeps } from './hltb-step';
import { hltbRunActive } from './hltb-slot';
import { discoverStep, type DiscoverStepDeps } from './discover-step';
import { manualMatchStep, type ManualMatchDeps } from './manual-match-step';
import { llmStep, type LlmStepDeps } from './llm-step';
import { tintStep, type TintDeps } from './tint';

const { syncRuns } = schema;

export const MAX_HOPS = 60;

export type SyncDeps = {
  db: AnyDb;
  /** Авторизация и профиль цели. Бросает PsnError. */
  connect: () => Promise<PsnClient>;
  now: () => Date;
  budgetMs: number;
  /** значения, которые нельзя оставлять в error_message */
  secrets?: ReadonlyArray<string | null | undefined>;
  /** Шаг «цвет акцента» (15.2) в конце успешного звена. Нет = шаг отключён (тесты). */
  tint?: TintDeps;
  /** Шаг «длительность по HLTB» (16.6) после цвета акцента. Нет = шаг отключён (тесты). */
  hltb?: HltbDeps;
  /** Шаг «LLM» (20.5): фразы бэклога и «Новое от ИИ» после HLTB. Нет = шаг отключён (тесты). */
  llm?: LlmStepDeps;
  /** Шаг «У тебя нет» (Фаза 30, 30.4) после LLM: подборка игр вне библиотеки из RAWG раз в сутки. Нет = шаг отключён (тесты). */
  discover?: DiscoverStepDeps;
  /** Шаг «не куплено» (Фаза 43, 43.5) после склейки дублей: сопоставление manual_games с библиотекой. Нет = шаг отключён (тесты). */
  manualMatch?: ManualMatchDeps;
};

export type ChunkResult = {
  status: 'success' | 'partial' | 'failed';
  reason: SyncErrorReason | null;
  /** звену нужно самовызваться (остановка по бюджету и хопы не исчерпаны) */
  continueNext: boolean;
  /** номер звена (cursor.hops) для самовызова; есть, когда continueNext */
  hops?: number;
};

const CANCELLED: ChunkResult = { status: 'failed', reason: 'cancelled', continueNext: false };

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
      // запуск отменён (8.8): ничего не перезаписываем, самовызова нет
      if (e instanceof RunCancelledError) return CANCELLED;
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
    try {
      await applyDuplicates(deps.db, ctx.userId);
    } catch {
      // склейка дублей необязательна: сбой оставляет прежние пометки
      ctx.warn('duplicates_failed', 'Шаг склейки дублей завершился ошибкой.');
    }
    if (deps.manualMatch) {
      try {
        await manualMatchStep(ctx, deps.manualMatch);
      } catch (e) {
        if (e instanceof RunCancelledError) throw e;
        // записи «не куплено» остаются как были (на схеме до 0026 таблицы нет): ошибка шага не влияет на итог синка
        ctx.warn('manual_match_failed', 'Шаг «не куплено» завершился ошибкой.');
      }
    }
    if (deps.tint) {
      try {
        await tintStep(ctx, deps.tint);
      } catch (e) {
        if (e instanceof RunCancelledError) throw e;
        // цвет акцента необязателен: ошибка шага не влияет на итог синка
        ctx.warn('tint_failed', 'Шаг расчёта цвета акцента завершился ошибкой.');
      }
    }
    if (deps.hltb) {
      try {
        // п. 3: идёт массовый прогон HLTB этого пользователя (свой слот) — он и так подгружает те же игры
        if (!(await hltbRunActive(deps.db, ctx.userId, ctx.now()))) await hltbStep(ctx, deps.hltb);
      } catch (e) {
        if (e instanceof RunCancelledError) throw e;
        // длительность необязательна (есть ручной ввод): ошибка шага не влияет на итог синка
        ctx.warn('hltb_failed', 'Шаг длительности по HLTB завершился ошибкой.');
      }
    }
    if (deps.llm) {
      try {
        await llmStep(ctx, deps.llm);
      } catch (e) {
        if (e instanceof RunCancelledError) throw e;
        // фразы и подборка необязательны (есть шаблоны): ошибка шага не влияет на итог синка
        ctx.warn('llm_failed', 'Шаг LLM завершился ошибкой.');
      }
    }
    if (deps.discover) {
      try {
        await discoverStep(ctx, deps.discover);
      } catch (e) {
        if (e instanceof RunCancelledError) throw e;
        // подборка необязательна (экран покажет прежнюю или пустое состояние): ошибка шага не влияет на итог синка
        ctx.warn('discover_step_failed', 'Шаг «У тебя нет» завершился ошибкой.');
      }
    }
    return await close({ status: 'success', reason: null, continueNext: false }, null, true);
  } catch (e) {
    if (e instanceof RunCancelledError) return CANCELLED;
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
export async function failRun(db: AnyDb, userId: UserId, runId: number, reason: SyncErrorReason, message: string, now: Date): Promise<void> {
  await db
    .update(syncRuns)
    .set({ status: 'failed', errorReason: reason, errorMessage: message.slice(0, 500), finishedAt: now })
    .where(and(eq(syncRuns.id, runId), eq(syncRuns.userId, userId), eq(syncRuns.status, 'running')));
}
