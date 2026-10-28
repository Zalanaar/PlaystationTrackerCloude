// Шаг «длительность по HLTB» в конце успешного звена синка (контракт 16.6). Не фаза курсора: остаток определяют данные.
// Любая ошибка HLTB = предупреждение в sync_runs.warnings, итог запуска не меняется.
import { and, asc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { schema } from '@/db';
import { HltbError, createHltbClient, type HltbClient } from '@/server/hltb/client';
import { pickBest, searchTerm } from '@/server/hltb/normalize';
import type { RunContext } from './context';

const { games, gameStatus } = schema;

export const HLTB_BATCH = 20;
export const HLTB_RECHECK_MS = 30 * 86400_000;
export const HLTB_PAUSE_MS = 600;
export const HLTB_MIN_LEFT_MS = 3000;
export const HLTB_MAX_ERRORS_IN_ROW = 3;

export type HltbDeps = { client: HltbClient; sleep: (ms: number) => Promise<void>; pauseMs?: number };

export const defaultHltbDeps = (): HltbDeps => ({ client: createHltbClient(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), pauseMs: HLTB_PAUSE_MS });

export async function hltbStep(ctx: RunContext, deps: HltbDeps): Promise<{ checked: number; found: number; failed: number }> {
  const none = { checked: 0, found: 0, failed: 0 };
  if (ctx.timeLeft() < HLTB_MIN_LEFT_MS) return none;
  const now = ctx.now();
  const before = new Date(now.getTime() - HLTB_RECHECK_MS);
  const priority = sql`case ${gameStatus.status} when 'backlog' then 0 when 'playing' then 1 when 'shelved' then 2 else 3 end`;
  const due = await ctx.db
    .select({ id: games.id, name: games.name, hltbId: games.hltbId, main: games.hltbMainHours, extra: games.hltbExtraHours })
    .from(games)
    .leftJoin(gameStatus, eq(gameStatus.gameId, games.id))
    .where(
      and(
        isNull(games.hiddenAt),
        isNull(games.durationOverrideHours),
        or(isNull(gameStatus.status), inArray(gameStatus.status, ['backlog', 'playing', 'shelved'])),
        or(isNull(games.hltbCheckedAt), lt(games.hltbCheckedAt, before)),
      ),
    )
    .orderBy(priority, asc(games.id))
    .limit(HLTB_BATCH);

  type Outcome = { g: (typeof due)[number]; hit: ReturnType<typeof pickBest>; empty: boolean };
  const outcomes: Outcome[] = [];
  let failed = 0;
  let inRow = 0;
  let lastCode = '';
  for (const g of due) {
    if (ctx.timeLeft() < HLTB_MIN_LEFT_MS) break;
    try {
      const cands = await deps.client.search(searchTerm(g.name));
      outcomes.push({ g, hit: pickBest(g.name, cands), empty: cands.length === 0 });
      inRow = 0;
    } catch (e) {
      failed++;
      inRow++;
      lastCode = e instanceof HltbError ? e.code : 'internal';
      if (inRow >= HLTB_MAX_ERRORS_IN_ROW) break;
    }
    if (deps.pauseMs) await deps.sleep(deps.pauseMs);
  }

  // Без единого непустого ответа в запуске «не найдено» не фиксируем при любом размере партии (16.6): иначе сломанный HLTB пометил бы игры на 30 дней.
  if (outcomes.length > 0 && outcomes.every((o) => o.empty)) {
    ctx.warn('hltb_empty', 'HLTB вернул пустую выдачу на все запросы: формат мог измениться, результаты не сохранены.');
    return { checked: 0, found: 0, failed };
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
        .where(eq(games.id, g.id));
    } else if (g.hltbId !== null) {
      // раньше находили, теперь нет: возможный сбой HLTB, прежние данные не стираем
      await ctx.db.update(games).set({ hltbCheckedAt: now }).where(eq(games.id, g.id));
    } else {
      await ctx.db
        .update(games)
        .set({ hltbId: null, hltbName: null, hltbMainHours: null, hltbExtraHours: null, hltbCheckedAt: now })
        .where(eq(games.id, g.id));
    }
  }
  if (failed > 0) ctx.warn('hltb_failed', `HLTB: ошибок ${failed} (${lastCode}), эти игры будут проверены в следующем синке.`);
  return { checked: outcomes.length, found, failed };
}
