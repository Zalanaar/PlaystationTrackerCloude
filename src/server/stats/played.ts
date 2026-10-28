// «Игры месяца» (контракт 10.1, Фаза 8): игра в каждом месяце периода, где её секунды > 0 или она завершена/брошена.
// Чистые функции; те же слагаемые, что у hours.byMonth (gameSecondsInRange + estimateByMonth).
import type { GameItem } from '@/server/collection/types';
import type { FinishedEvent } from './finished';
import { estimateByMonth, gameSecondsInRange, secondsToHours, type EstimateInput } from './hours';
import { mskDate, monthRange } from './period';
import type { PlayedGroup, PlayedItem, StatsPeriod } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

/** Месяцы периода: год = 1..12, месяц = один. */
export function periodMonths(period: Pick<StatsPeriod, 'type' | 'year' | 'month'>): number[] {
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

export function groupPlayed(args: {
  by: Map<number, { date: string; seconds: number }[]>;
  estimates: readonly EstimateInput[];
  period: Pick<StatsPeriod, 'type' | 'year' | 'month'>;
  /** События завершения/броска внутри периода. */
  finishedEvents: readonly FinishedEvent[];
  gameById: ReadonlyMap<number, GameItem>;
}): PlayedGroup[] {
  const { period, gameById } = args;
  const months = periodMonths(period);
  const secs = playedSecondsByMonth({ by: args.by, estimates: args.estimates, year: period.year, months });

  const finishedBy = new Map<string, Map<number, FinishedEvent>>();
  for (const e of args.finishedEvents) {
    const d = mskDate(e.at);
    if (d.year !== period.year || !months.includes(d.month)) continue;
    const key = `${d.year}-${pad(d.month)}`;
    const m = finishedBy.get(key) ?? new Map<number, FinishedEvent>();
    m.set(e.gameId, e);
    finishedBy.set(key, m);
  }

  const groups: PlayedGroup[] = [];
  for (const monthNumber of [...months].sort((a, b) => b - a)) {
    const key = `${period.year}-${pad(monthNumber)}`;
    const s = secs.get(key) ?? new Map<number, { real: number; est: number }>();
    const fin = finishedBy.get(key) ?? new Map<number, FinishedEvent>();
    const ids = new Set<number>([...s.keys(), ...fin.keys()]);
    const rows: { item: PlayedItem; seconds: number; at: number }[] = [];
    for (const id of ids) {
      const game = gameById.get(id);
      if (!game) continue;
      const v = s.get(id) ?? { real: 0, est: 0 };
      const e = fin.get(id) ?? null;
      rows.push({
        seconds: v.real + v.est,
        at: e ? e.at.getTime() : 0,
        item: {
          game,
          hours: secondsToHours(v.real + v.est),
          estimated: v.est > 0,
          finished: e ? e.kind : null,
          finishedAt: e ? e.at.toISOString() : null,
        },
      });
    }
    if (!rows.length) continue;
    rows.sort((a, b) => {
      const fa = a.item.finished !== null ? 1 : 0;
      const fb = b.item.finished !== null ? 1 : 0;
      return (
        fb - fa ||
        b.at - a.at ||
        b.seconds - a.seconds ||
        a.item.game.title.toLowerCase().localeCompare(b.item.game.title.toLowerCase()) ||
        a.item.game.id - b.item.game.id
      );
    });
    groups.push({
      month: key,
      year: period.year,
      monthNumber,
      completed: rows.filter((r) => r.item.finished === 'completed').length,
      dropped: rows.filter((r) => r.item.finished === 'dropped').length,
      items: rows.map((r) => r.item),
    });
  }
  return groups;
}

/** id игр, которые попадут в played (для загрузки карточек одним запросом). */
export function playedGameIds(args: {
  by: Map<number, { date: string; seconds: number }[]>;
  estimates: readonly EstimateInput[];
  period: Pick<StatsPeriod, 'type' | 'year' | 'month'>;
  finishedEvents: readonly FinishedEvent[];
}): number[] {
  const secs = playedSecondsByMonth({ by: args.by, estimates: args.estimates, year: args.period.year, months: periodMonths(args.period) });
  const ids = new Set<number>(args.finishedEvents.map((e) => e.gameId));
  for (const m of secs.values()) for (const id of m.keys()) ids.add(id);
  return [...ids];
}
