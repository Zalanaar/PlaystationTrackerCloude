// Исключение игры из месяца (контракт 15.1). Чистая проверка + выборки/мутация. Синк сюда не пишет.
import { asc, eq, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { NotFoundError } from '@/server/collection/mutations';
import { gameVisible } from '@/server/collection/visibility';
import { estimateRangeMonths, type EstimateInput } from './hours';

const { games, gameMonthExclusions: ex, playtimeSnapshots: ps } = schema;

export type MonthExclusions = ReadonlyMap<number, ReadonlySet<string>>;

export const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Бросается, когда исключение оставило бы оценку без месяцев (15.1, HTTP 409). */
export class MonthExclusionConflictError extends Error {
  constructor(
    readonly gameId: number,
    readonly month: string,
    readonly rangeMonths: string[],
    readonly excludedMonths: string[],
  ) {
    super('Нельзя убрать игру из всех месяцев: часы некуда перераспределить.');
  }
}

/**
 * Можно ли добавить `month` к уже исключённым. false, если диапазон длиннее одного месяца и после этого
 * исключены все его месяцы. Диапазон из одного месяца (перераспределять некуда: оценка просто выпадает),
 * пустой диапазон (оценки нет) или месяц вне диапазона: всегда можно.
 */
export function canExclude(rangeMonths: readonly string[], excluded: ReadonlySet<string>, month: string): boolean {
  if (rangeMonths.length <= 1 || !rangeMonths.includes(month)) return true;
  return rangeMonths.some((m) => m !== month && !excluded.has(m));
}

/** Добавляет исключённые месяцы во входы оценки (чистая; игры без исключений не копируются). */
export function applyExclusions(inputs: readonly EstimateInput[], exclusions: MonthExclusions): EstimateInput[] {
  return inputs.map((i) => (exclusions.has(i.gameId) ? { ...i, excludedMonths: exclusions.get(i.gameId) } : i));
}

/** Исключения видимых игр: gameId -> месяцы. Один запрос. */
export async function getMonthExclusions(db: AnyDb): Promise<Map<number, Set<string>>> {
  const rows = await db.select({ gameId: ex.gameId, month: ex.month }).from(ex).where(gameVisible(ex.gameId));
  const out = new Map<number, Set<string>>();
  for (const r of rows) {
    const set = out.get(r.gameId) ?? new Set<string>();
    set.add(r.month);
    out.set(r.gameId, set);
  }
  return out;
}

/**
 * 15.1: добавляет/снимает исключение. Идемпотентно. Возвращает все исключённые месяцы игры по возрастанию.
 * Бросает NotFoundError (нет игры) и MonthExclusionConflictError (исключён бы последний месяц диапазона оценки).
 */
export type MonthExclusionResult = {
  excludedMonths: string[];
  /** Оценочные часы месяца перераспределены по остальным месяцам диапазона. */
  redistributed: boolean;
  /** Диапазон из одного месяца: оценочные часы игры выпали из часов (перераспределять некуда). */
  estimateDropped: boolean;
};

export async function setMonthExclusion(db: AnyDb, gameId: number, month: string, excluded: boolean): Promise<MonthExclusionResult> {
  return db.transaction(async (tx) => {
    // параллельные запросы по одной игре не должны вместе исключить последний месяц
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('game_month_exclusions'), ${gameId})`);
    const [game] = await tx
      .select({ firstPlayedAt: games.firstPlayedAt, lastPlayedAt: games.lastPlayedAt })
      .from(games)
      .where(eq(games.id, gameId))
      .limit(1);
    if (!game) throw new NotFoundError('Игра не найдена.');

    let range: string[] = [];
    const current = new Set((await tx.select({ month: ex.month }).from(ex).where(eq(ex.gameId, gameId))).map((r) => r.month));
    {
      const [first] = await tx
        .select({ date: ps.snapshotDate, seconds: ps.playDurationSeconds, lastPlayedAt: ps.lastPlayedAt })
        .from(ps)
        .where(eq(ps.gameId, gameId))
        .orderBy(asc(ps.snapshotDate))
        .limit(1);
      range = first
        ? estimateRangeMonths({
            gameId,
            firstSnapshotDate: first.date,
            firstSeconds: first.seconds,
            firstPlayedAt: game.firstPlayedAt,
            lastPlayedAt: first.lastPlayedAt ?? game.lastPlayedAt,
          })
        : [];
    }
    if (excluded && !current.has(month)) {
      if (!canExclude(range, current, month)) {
        throw new MonthExclusionConflictError(gameId, month, range, [...current].sort());
      }
      await tx.insert(ex).values({ gameId, month }).onConflictDoNothing();
      current.add(month);
    } else if (!excluded && current.has(month)) {
      await tx.delete(ex).where(sql`${ex.gameId} = ${gameId} and ${ex.month} = ${month}`);
      current.delete(month);
    }
    const inRange = excluded && range.includes(month);
    return { excludedMonths: [...current].sort(), redistributed: inRange && range.length > 1, estimateDropped: inRange && range.length === 1 };
  });
}
