// Шаг «длительность по HLTB» в конце успешного звена синка (контракт 16.6). Не фаза курсора: остаток определяют данные.
// Любая ошибка HLTB = предупреждение в sync_runs.warnings, итог запуска не меняется.
import { and, asc, count, eq, isNull, lt, ne, notInArray, or, sql } from 'drizzle-orm';
import { schema } from '@/db';
import { HltbError, capDetail, createHltbClient, type HltbClient } from '@/server/hltb/client';
import { pickAny, searchTerms } from '@/server/hltb/normalize';
import type { UserId } from '@/server/auth/user-id';
import type { RunContext } from './context';

const { games, gameStatus } = schema;

export const HLTB_BATCH = 20;
export const HLTB_RECHECK_MS = 30 * 86400_000;
export const HLTB_PAUSE_MS = 600;
export const HLTB_MIN_LEFT_MS = 3000;
export const HLTB_MAX_ERRORS_IN_ROW = 3;

/** Массовый запуск (16.7): пачка и порог остатка времени (таймаут запроса HLTB 8 с + запас). */
export const HLTB_RUN_BATCH = 10;
export const HLTB_RUN_MIN_LEFT_MS = 9000;
export const HLTB_RUN_BUDGET_MS = 45_000;

export type HltbDeps = { client: HltbClient; sleep: (ms: number) => Promise<void>; pauseMs?: number };

export const defaultHltbDeps = (): HltbDeps => ({ client: createHltbClient(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), pauseMs: HLTB_PAUSE_MS });

/** recheckBefore: дополнительно берём «не найдено» (hltb_id пуст), проверенные раньше этого момента (16.7, перепроверка после смены матчера). */
const dueWhere = (userId: UserId, now: Date, recheckBefore?: Date) =>
  and(
    eq(games.userId, userId),
    isNull(games.hiddenAt),
    isNull(games.durationOverrideHours),
    // 20.1: любой статус, кроме service (completed/dropped тоже нужны: фильтры и «Подскажи» опираются на длительность)
    or(isNull(gameStatus.status), ne(gameStatus.status, 'service')),
    or(
      isNull(games.hltbCheckedAt),
      lt(games.hltbCheckedAt, new Date(now.getTime() - HLTB_RECHECK_MS)),
      recheckBefore ? and(isNull(games.hltbId), lt(games.hltbCheckedAt, recheckBefore)) : undefined,
    ),
  );

/** Сколько игр сейчас подходит под правило шага (16.6). */
export async function hltbRemaining(ctx: RunContext, recheckBefore?: Date): Promise<number> {
  const [r] = await ctx.db.select({ n: count() }).from(games).leftJoin(gameStatus, and(eq(gameStatus.gameId, games.id), eq(gameStatus.userId, ctx.userId))).where(dueWhere(ctx.userId, ctx.now(), recheckBefore));
  return Number(r?.n ?? 0);
}

export type HltbStepOpts = {
  limit?: number;
  minLeftMs?: number;
  /** игры, уже тронутые в этом запуске (ошибка/пустая выдача): повторно не берём */
  excludeIds?: number[];
  recheckBefore?: Date;
  /** в запуске уже был непустой ответ HLTB: «не найдено» можно фиксировать и в пачке из пустых ответов */
  sawNonEmpty?: boolean;
};
export type HltbBatchResult = {
  checked: number;
  found: number;
  failed: number;
  /** выбрано из БД (0 = подходящих больше нет) */
  picked: number;
  /** id игр, на которые отправлен запрос (успешно или с ошибкой) */
  attemptedIds: number[];
  sawNonEmpty: boolean;
  stop: 'errors' | 'empty' | 'time' | null;
  /** `<код>[: деталь]` последней ошибки HLTB; пусто, если ошибок не было */
  failDetail?: string;
};

const failedWarning = (n: number, detail: string) => `HLTB: ошибок ${n} (${detail}), эти игры будут проверены в следующем синке.`;

export async function hltbStep(ctx: RunContext, deps: HltbDeps): Promise<{ checked: number; found: number; failed: number }> {
  const r = await hltbBatch(ctx, deps);
  if (r.failed > 0) ctx.warn('hltb_failed', failedWarning(r.failed, r.failDetail ?? ''));
  return { checked: r.checked, found: r.found, failed: r.failed };
}

/** Одна пачка шага. Предупреждения пишет в ctx; hltb_failed по пачкам не дублируется вызывающим (см. hltbRun). */
export async function hltbBatch(ctx: RunContext, deps: HltbDeps, opts: HltbStepOpts = {}): Promise<HltbBatchResult> {
  const minLeft = opts.minLeftMs ?? HLTB_MIN_LEFT_MS;
  const none: HltbBatchResult = { checked: 0, found: 0, failed: 0, picked: 0, attemptedIds: [], sawNonEmpty: opts.sawNonEmpty ?? false, stop: null };
  if (ctx.timeLeft() < minLeft) return { ...none, stop: 'time' };
  const now = ctx.now();
  const priority = sql`case ${gameStatus.status} when 'backlog' then 0 when 'playing' then 1 when 'shelved' then 2 when 'completed' then 4 when 'dropped' then 5 else 3 end`;
  const excl = opts.excludeIds?.length ? notInArray(games.id, opts.excludeIds) : undefined;
  const due = await ctx.db
    .select({ id: games.id, name: games.name, hltbId: games.hltbId, main: games.hltbMainHours, extra: games.hltbExtraHours })
    .from(games)
    .leftJoin(gameStatus, and(eq(gameStatus.gameId, games.id), eq(gameStatus.userId, ctx.userId)))
    .where(and(dueWhere(ctx.userId, now, opts.recheckBefore), excl))
    .orderBy(priority, asc(games.id))
    .limit(opts.limit ?? HLTB_BATCH);

  type Outcome = { g: (typeof due)[number]; hit: ReturnType<typeof pickAny>; empty: boolean };
  const outcomes: Outcome[] = [];
  let failed = 0;
  let inRow = 0;
  let lastCode = '';
  let lastDetail = '';
  const attemptedIds: number[] = [];
  let stop: HltbBatchResult['stop'] = null;
  for (const g of due) {
    if (ctx.timeLeft() < minLeft) {
      stop = 'time';
      break;
    }
    attemptedIds.push(g.id);
    try {
      // до MAX_QUERIES_PER_GAME запросов: следующий только если совпадения ещё нет и хватает времени
      let hit: ReturnType<typeof pickAny> = null;
      let empty = true;
      let cut = false;
      const terms = searchTerms(g.name);
      for (let q = 0; q < terms.length; q++) {
        if (q > 0) {
          if (deps.pauseMs) await deps.sleep(deps.pauseMs);
          if (ctx.timeLeft() < minLeft) {
            cut = true;
            break;
          }
        }
        const cands = await deps.client.search(terms[q]);
        if (cands.length > 0) empty = false;
        hit = pickAny(g.name, cands);
        if (hit) break;
      }
      // время вышло посреди поиска: «не найдено» не фиксируем, игра останется непроверенной
      if (cut && !hit) {
        stop = 'time';
        break;
      }
      outcomes.push({ g, hit, empty });
      inRow = 0;
    } catch (e) {
      failed++;
      inRow++;
      lastCode = e instanceof HltbError ? e.code : 'internal';
      // message HltbError формируется клиентом без тел ответов и токенов; чужие ошибки не раскрываем
      lastDetail = e instanceof HltbError ? capDetail(e.message) : '';
      if (inRow >= HLTB_MAX_ERRORS_IN_ROW) {
        stop = 'errors';
        break;
      }
    }
    if (deps.pauseMs) await deps.sleep(deps.pauseMs);
  }

  // Без единого непустого ответа в запуске «не найдено» не фиксируем при любом размере партии (16.6): иначе сломанный HLTB пометил бы игры на 30 дней.
  const sawNonEmpty = (opts.sawNonEmpty ?? false) || outcomes.some((o) => !o.empty);
  if (outcomes.length > 0 && !sawNonEmpty) {
    ctx.warn('hltb_empty', 'HLTB вернул пустую выдачу на все запросы: формат мог измениться, результаты не сохранены.');
    return { checked: 0, found: 0, failed, picked: due.length, attemptedIds, sawNonEmpty, stop: 'empty', failDetail: failed > 0 ? `${lastCode}${lastDetail ? `: ${lastDetail}` : ''}` : '' };
  }

  let found = 0;
  for (const { g, hit } of outcomes) {
    if (hit) {
      found++;
      const same = g.hltbId === hit.id;
      await ctx.db
        .update(games)
        .set({
          hltbId: hit.id,
          hltbName: hit.name,
          hltbMainHours: hit.mainHours ?? (same ? g.main : null),
          hltbExtraHours: hit.extraHours ?? (same ? g.extra : null),
          hltbCheckedAt: now,
        })
        .where(and(eq(games.id, g.id), eq(games.userId, ctx.userId)));
    } else if (g.hltbId !== null) {
      // раньше находили, теперь нет: возможный сбой HLTB, прежние данные не стираем
      await ctx.db.update(games).set({ hltbCheckedAt: now }).where(and(eq(games.id, g.id), eq(games.userId, ctx.userId)));
    } else {
      await ctx.db
        .update(games)
        .set({ hltbId: null, hltbName: null, hltbMainHours: null, hltbExtraHours: null, hltbCheckedAt: now })
        .where(and(eq(games.id, g.id), eq(games.userId, ctx.userId)));
    }
  }
  const failDetail = failed > 0 ? `${lastCode}${lastDetail ? `: ${lastDetail}` : ''}` : '';
  return { checked: outcomes.length, found, failed, picked: due.length, attemptedIds, sawNonEmpty, stop, failDetail };
}

export type HltbRunResult = {
  processed: number;
  found: number;
  notFound: number;
  failed: number;
  remaining: number;
  done: boolean;
  stopReason: 'complete' | 'budget' | 'errors' | 'empty' | 'no_time';
};

/**
 * Массовый запуск (16.7): пачки по HLTB_RUN_BATCH, пока есть игры и время. Тот же отбор и правила, что у шага синка.
 * done=false только если вышло время и прогресс был: цикл фронта конечен (каждая такая итерация помечает хотя бы одну игру проверенной).
 */
export async function hltbRun(ctx: RunContext, deps: HltbDeps, o: { batch?: number; minLeftMs?: number; recheckBefore?: Date } = {}): Promise<HltbRunResult> {
  const batch = o.batch ?? HLTB_RUN_BATCH;
  const minLeftMs = o.minLeftMs ?? HLTB_RUN_MIN_LEFT_MS;
  let processed = 0;
  let found = 0;
  let failed = 0;
  let detail = '';
  let sawNonEmpty = false;
  const touched: number[] = [];
  let stop: HltbRunResult['stopReason'] = 'budget';
  for (;;) {
    if (ctx.timeLeft() < minLeftMs) {
      stop = processed + failed === 0 ? 'no_time' : 'budget';
      break;
    }
    const r = await hltbBatch(ctx, deps, { limit: batch, minLeftMs, excludeIds: touched, sawNonEmpty, recheckBefore: o.recheckBefore });
    if (r.picked === 0) {
      stop = 'complete';
      break;
    }
    sawNonEmpty = r.sawNonEmpty;
    // heartbeat (L-1): убитая по maxDuration функция освободит слот за ~2 минуты
    await ctx.save();
    touched.push(...r.attemptedIds);
    processed += r.checked;
    found += r.found;
    failed += r.failed;
    if (r.failDetail) detail = r.failDetail;
    if (r.stop === 'errors' || r.stop === 'empty') {
      stop = r.stop;
      break;
    }
    if (r.stop === 'time') {
      stop = processed + failed === 0 ? 'no_time' : 'budget';
      break;
    }
  }
  if (failed > 0) ctx.warn('hltb_failed', failedWarning(failed, detail));
  const remaining = await hltbRemaining(ctx, o.recheckBefore);
  // «budget» без единой проверенной игры прогресса не даёт: завершаем, чтобы цикл фронта не был бесконечным
  if (stop === 'budget' && processed === 0) stop = 'no_time';
  const done = remaining === 0 || stop !== 'budget';
  return { processed, found, notFound: processed - found, failed, remaining, done, stopReason: remaining === 0 && stop === 'budget' ? 'complete' : stop };
}
