// «Игры месяца» (контракт 10.1, Фаза 8): игра в каждом месяце периода, где её секунды > 0 или она завершена/брошена.
// Чистые функции; те же слагаемые, что у hours.byMonth (gameSecondsInRange + estimateByMonth).
import { compareTitleId as cmpTitle } from '@/server/common/compare';
import type { GameItem } from '@/server/collection/types';
import type { FinishedEvent } from './finished';
import type { MonthExclusions } from './exclusions';
import { estimateByMonth, estimateRangeMonths, gameSecondsInRange, secondsToHours, type EstimateInput } from './hours';
import { mskDate, monthRange } from './period';
import type { PlayedBlock, PlayedItem, BoundedPeriod } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

/** Месяцы периода: год = 1..12, месяц = один. */
export function periodMonths(period: Pick<BoundedPeriod, 'type' | 'year' | 'month'>): number[] {
  return period.type === 'month' && period.month !== null ? [period.month] : Array.from({ length: 12 }, (_, i) => i + 1);
}

/** Секунды по (игра, месяц) за месяцы периода: реальные и оценочные отдельно. Только игры с суммой > 0. */
export function playedSecondsByMonth(args: {
  by: Map<number, { date: string; seconds: number }[]>;
  estimates: readonly EstimateInput[];
  year: number;
  months: readonly number[];
}): Map<string, Map<number, { real: number; est: number }>> {
  const { by, estimates, year, months } = args;
  const out = new Map<string, Map<number, { real: number; est: number }>>();
  const keys = months.map((m) => ({ m, key: `${year}-${pad(m)}`, range: monthRange(year, m) }));
  for (const k of keys) out.set(k.key, new Map());
  for (const [id, snaps] of by) {
    for (const k of keys) {
      const real = gameSecondsInRange(snaps, k.range.from, k.range.to);
      if (real > 0) (out.get(k.key) as Map<number, { real: number; est: number }>).set(id, { real, est: 0 });
    }
  }
  for (const inp of estimates) {
    const est = estimateByMonth(inp);
    for (const k of keys) {
      const v = est.get(k.key) ?? 0;
      if (v <= 0) continue;
      const month = out.get(k.key) as Map<number, { real: number; est: number }>;
      const cur = month.get(inp.gameId);
      if (cur) cur.est += v;
      else month.set(inp.gameId, { real: 0, est: v });
    }
  }
  return out;
}

/**
 * Игры, исключённые из месяцев периода (контракт 15.1): ключ месяца -> игра -> реальные секунды месяца.
 * Игра попадает сюда, только если без исключения она была бы в списке месяца: реальные секунды > 0,
 * месяц в диапазоне оценки (без учёта исключений) или игра завершена/брошена в этом месяце.
 */
export function excludedPlayed(args: {
  by: Map<number, { date: string; seconds: number }[]>;
  estimates: readonly EstimateInput[];
  exclusions: MonthExclusions | undefined;
  year: number;
  months: readonly number[];
  finishedEvents: readonly FinishedEvent[];
}): Map<string, Map<number, number>> {
  const out = new Map<string, Map<number, number>>();
  if (!args.exclusions || args.exclusions.size === 0) return out;
  const estById = new Map(args.estimates.map((e) => [e.gameId, e] as const));
  const finishedKeys = new Set<string>();
  for (const e of args.finishedEvents) {
    const d = mskDate(e.at);
    finishedKeys.add(`${e.gameId}|${d.year}-${pad(d.month)}`);
  }
  for (const [gameId, set] of args.exclusions) {
    for (const m of args.months) {
      const key = `${args.year}-${pad(m)}`;
      if (!set.has(key)) continue;
      const range = monthRange(args.year, m);
      const real = gameSecondsInRange(args.by.get(gameId) ?? [], range.from, range.to);
      const est = estById.get(gameId);
      const present = real > 0 || (est !== undefined && estimateRangeMonths(est).includes(key)) || finishedKeys.has(`${gameId}|${key}`);
      if (!present) continue;
      const month = out.get(key) ?? new Map<number, number>();
      month.set(gameId, real);
      out.set(key, month);
    }
  }
  return out;
}

export function groupPlayed(args: {
  by: Map<number, { date: string; seconds: number }[]>;
  estimates: readonly EstimateInput[];
  period: Pick<BoundedPeriod, 'type' | 'year' | 'month'>;
  /** События завершения/броска внутри периода. */
  finishedEvents: readonly FinishedEvent[];
  gameById: ReadonlyMap<number, GameItem>;
  /** Исключения игр из месяцев (15.1). */
  exclusions?: MonthExclusions;
}): PlayedBlock {
  const { period, gameById } = args;
  const games: Record<string, GameItem> = {};
  const months = periodMonths(period);
  const secs = playedSecondsByMonth({ by: args.by, estimates: args.estimates, year: period.year, months });

  const excl = excludedPlayed({ by: args.by, estimates: args.estimates, exclusions: args.exclusions, year: period.year, months, finishedEvents: args.finishedEvents });

  const finishedBy = new Map<string, Map<number, FinishedEvent>>();
  for (const e of args.finishedEvents) {
    const d = mskDate(e.at);
    if (d.year !== period.year || !months.includes(d.month)) continue;
    const key = `${d.year}-${pad(d.month)}`;
    const m = finishedBy.get(key) ?? new Map<number, FinishedEvent>();
    m.set(e.gameId, e);
    finishedBy.set(key, m);
  }

  const groups: PlayedBlock['groups'] = [];
  for (const monthNumber of [...months].sort((a, b) => b - a)) {
    const key = `${period.year}-${pad(monthNumber)}`;
    const s = secs.get(key) ?? new Map<number, { real: number; est: number }>();
    const fin = finishedBy.get(key) ?? new Map<number, FinishedEvent>();
    const out = excl.get(key) ?? new Map<number, number>();
    const ids = new Set<number>([...s.keys(), ...fin.keys()]);
    for (const id of out.keys()) ids.delete(id);
    const rows: { item: PlayedItem; game: GameItem; seconds: number; at: number }[] = [];
    const item = (id: number, v: { real: number; est: number }): PlayedItem => {
      const e = fin.get(id) ?? null;
      return {
        gameId: id,
        hours: secondsToHours(v.real + v.est),
        hoursReal: secondsToHours(v.real),
        hoursEstimated: secondsToHours(v.est),
        estimated: v.est > 0,
        finished: e ? e.kind : null,
        finishedAt: e ? e.at.toISOString() : null,
      };
    };
    for (const id of ids) {
      const game = gameById.get(id);
      if (!game) continue;
      const v = s.get(id) ?? { real: 0, est: 0 };
      const e = fin.get(id) ?? null;
      rows.push({ game, seconds: v.real + v.est, at: e ? e.at.getTime() : 0, item: item(id, v) });
    }
    const excludedItems: { item: PlayedItem; game: GameItem }[] = [];
    for (const [id, real] of out) {
      const game = gameById.get(id);
      if (game) excludedItems.push({ game, item: item(id, { real, est: 0 }) });
    }
    excludedItems.sort((a, b) => cmpTitle(a.game, b.game));
    for (const x of [...rows, ...excludedItems]) games[String(x.game.id)] = x.game;
    if (!rows.length && !excludedItems.length) continue;
    rows.sort((a, b) => {
      const fa = a.item.finished !== null ? 1 : 0;
      const fb = b.item.finished !== null ? 1 : 0;
      return (
        fb - fa ||
        b.at - a.at ||
        b.seconds - a.seconds ||
        cmpTitle(a.game, b.game)
      );
    });
    groups.push({
      month: key,
      year: period.year,
      monthNumber,
      completed: rows.filter((r) => r.item.finished === 'completed').length,
      dropped: rows.filter((r) => r.item.finished === 'dropped').length,
      items: rows.map((r) => r.item),
      excluded: excludedItems.map((x) => x.item),
    });
  }
  return { games, groups };
}

/** id игр, которые попадут в played (для загрузки карточек одним запросом). */
export function playedGameIds(args: {
  by: Map<number, { date: string; seconds: number }[]>;
  estimates: readonly EstimateInput[];
  period: Pick<BoundedPeriod, 'type' | 'year' | 'month'>;
  finishedEvents: readonly FinishedEvent[];
  exclusions?: MonthExclusions;
}): number[] {
  const months = periodMonths(args.period);
  const secs = playedSecondsByMonth({ by: args.by, estimates: args.estimates, year: args.period.year, months });
  const ids = new Set<number>(args.finishedEvents.map((e) => e.gameId));
  for (const m of secs.values()) for (const id of m.keys()) ids.add(id);
  const excl = excludedPlayed({ by: args.by, estimates: args.estimates, exclusions: args.exclusions, year: args.period.year, months, finishedEvents: args.finishedEvents });
  for (const m of excl.values()) for (const id of m.keys()) ids.add(id);
  return [...ids];
}
