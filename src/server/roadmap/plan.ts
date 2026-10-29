// Алгоритм плана (контракт 17.4). Чистые функции: без env, БД и сети. Даты YYYY-MM-DD, «сегодня» сюда не нужно.
import { dayNum, dayStr, monthsOfYear, overlapDays, weeksOfYear, yearBounds } from './dates';
import type { Conflict, NotFitEntry, Plan, PlanItem, PlanSegment, QueueRef, RoadmapEntry } from './types';

export const MAX_HOURS_PER_WEEK = 168;
const EPS = 1e-6;

export const round1 = (n: number): number => Math.round(n * 10) / 10;

export function isValidBudget(b: unknown): b is number {
  return typeof b === 'number' && Number.isFinite(b) && b > 0 && b <= MAX_HOURS_PER_WEEK;
}

export const hasHours = (e: RoadmapEntry): e is RoadmapEntry & { hours: number } => typeof e.hours === 'number' && Number.isFinite(e.hours) && e.hours > 0;

/** Недель окна релиза: ceil(часы / бюджет), минимум 1. */
export const releaseWeeks = (hours: number, budget: number): number => Math.max(1, Math.ceil(hours / budget - EPS));

/** Свободных дней очереди: ceil(7 * часы / бюджет), минимум 1. */
export const queueDays = (hours: number, budget: number): number => Math.max(1, Math.ceil((7 * hours) / budget - EPS));

export type PlanInput = {
  year: number;
  hoursPerWeek: number | null | undefined;
  /** Игры бэклога УЖЕ в порядке очереди. */
  backlog: readonly RoadmapEntry[];
  /** planned_games со статусом planned: с галкой (release) и без (planned), в любом порядке. */
  planned: readonly RoadmapEntry[];
};

type Placed = { entry: RoadmapEntry & { hours: number }; segs: { from: number; to: number; hours: number }[]; shifted: number; queuePos: number | null };

function groupSegments(days: readonly number[], hours: number): { from: number; to: number; hours: number }[] {
  const segs: { from: number; to: number; hours: number }[] = [];
  for (const d of days) {
    const last = segs[segs.length - 1];
    if (last && last.to === d - 1) last.to = d;
    else segs.push({ from: d, to: d, hours: 0 });
  }
  for (const s of segs) s.hours = (hours * (s.to - s.from + 1)) / days.length;
  return segs;
}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function buildPlan(input: PlanInput): Plan {
  const { year } = input;
  const bounds = yearBounds(year);
  const base = dayNum(bounds.from);
  const N = bounds.days;
  const budget = isValidBudget(input.hoursPerWeek) ? input.hoursPerWeek : null;
  const perDay = (budget ?? 0) / 7;

  const releases = input.planned.filter((e) => e.wantAtRelease && e.releaseDate !== null);
  const queueEntries: RoadmapEntry[] = [
    ...input.backlog,
    ...input.planned
      .filter((e) => !(e.wantAtRelease && e.releaseDate !== null))
      .sort((a, b) => cmpStr(a.releaseDate ?? '9999-99-99', b.releaseDate ?? '9999-99-99') || cmpStr(a.key, b.key)),
  ];
  const needHours = [...input.backlog, ...releases, ...input.planned.filter((e) => !releases.includes(e))].filter((e) => !hasHours(e));
  const queue: QueueRef[] = queueEntries.map((e) => ({ key: e.key, state: hasHours(e) ? 'scheduled' : 'need_hours' }));
  const queueState = new Map(queue.map((q) => [q.key, q] as const));

  const placed: Placed[] = [];
  const conflicts: Conflict[] = [];
  const notFit: NotFitEntry[] = [];

  if (budget !== null) {
    const owner: boolean[] = new Array<boolean>(N).fill(false);

    // Шаг 1: релизы жёстко, по (дата выхода, key). Курсор = последний занятый релизами день.
    const rel = releases
      .filter(hasHours)
      .sort((a, b) => cmpStr(a.releaseDate as string, b.releaseDate as string) || cmpStr(a.key, b.key));
    let cursor = -1;
    const placedRel: { key: string; end: number }[] = [];
    for (const r of rel) {
      const relOff = dayNum(r.releaseDate as string) - base;
      if (relOff >= N) {
        notFit.push({ ...r, reason: 'after_year_end', hoursShort: null });
        continue;
      }
      const desired = Math.max(relOff, 0);
      const start = Math.max(desired, cursor + 1);
      if (start > desired) {
        const blockers = placedRel.filter((p) => p.end >= desired).map((p) => p.key);
        conflicts.push({ reason: 'release_overlap', from: dayStr(base + desired), to: dayStr(base + Math.min(start, N) - 1), keys: [...blockers, r.key] });
      }
      if (start >= N) {
        notFit.push({ ...r, reason: 'exceeds_year_end', hoursShort: round1(r.hours) });
        continue;
      }
      const windowEnd = start + 7 * releaseWeeks(r.hours, budget) - 1;
      const end = Math.min(windowEnd, N - 1);
      const days = end - start + 1;
      if (windowEnd > N - 1) {
        conflicts.push({ reason: 'exceeds_year_end', from: dayStr(base + start), to: dayStr(base + N - 1), keys: [r.key] });
        if (days * perDay < r.hours - EPS) {
          notFit.push({ ...r, reason: 'exceeds_year_end', hoursShort: round1(r.hours - days * perDay) });
          continue;
        }
      }
      for (let i = start; i <= end; i++) owner[i] = true;
      placed.push({ entry: r, segs: [{ from: start, to: end, hours: r.hours }], shifted: start - desired, queuePos: null });
      placedRel.push({ key: r.key, end });
      cursor = end;
    }

    // Шаг 2: очередь по порядку занимает свободные дни; окно релиза игру прерывает (несколько отрезков).
    const free: number[] = [];
    for (let i = 0; i < N; i++) if (!owner[i]) free.push(i);
    let p = 0;
    queueEntries.forEach((e, idx) => {
      if (!hasHours(e)) return;
      const need = queueDays(e.hours, budget);
      const notBefore = e.kind === 'planned' && e.releaseDate !== null ? Math.max(0, dayNum(e.releaseDate) - base) : 0;
      let q = p;
      while (q < free.length && free[q] < notBefore) q++;
      const avail = free.length - q;
      if (need > avail) {
        notFit.push({ ...e, reason: 'no_capacity', hoursShort: round1((need - avail) * perDay) });
        (queueState.get(e.key) as QueueRef).state = 'not_fit';
        return;
      }
      const days = free.slice(q, q + need);
      p = q + need;
      placed.push({ entry: e, segs: groupSegments(days, e.hours), shifted: 0, queuePos: idx + 1 });
    });
  } else {
    for (const q of queue) if (q.state === 'scheduled') q.state = 'unplanned';
  }

  const items: PlanItem[] = placed
    .map((pl): PlanItem => {
      const segments: PlanSegment[] = pl.segs.map((s) => ({ from: dayStr(base + s.from), to: dayStr(base + s.to), days: s.to - s.from + 1, hours: round1(s.hours) }));
      const first = pl.segs[0];
      const last = pl.segs[pl.segs.length - 1];
      return {
        ...pl.entry,
        start: dayStr(base + first.from),
        end: dayStr(base + last.to),
        days: pl.segs.reduce((n, s) => n + s.to - s.from + 1, 0),
        shiftedDays: pl.shifted,
        queuePosition: pl.queuePos,
        segments,
      };
    })
    .sort((a, b) => cmpStr(a.start, b.start) || cmpStr(a.key, b.key));

  // Нагрузка по неделям и месяцам: часы отрезка равномерно по его дням, считаем по неокруглённым данным.
  const load = (from: string, to: string): { sum: number; items: { key: string; hours: number }[] } => {
    const a = dayNum(from);
    const b = dayNum(to);
    const list: { key: string; hours: number }[] = [];
    let sum = 0;
    for (const pl of placed) {
      let h = 0;
      const total = pl.segs.reduce((n, s) => n + s.to - s.from + 1, 0);
      for (const s of pl.segs) h += (pl.entry.hours * overlapDays(a - base, b - base, s.from, s.to)) / total;
      sum += h;
      if (round1(h) > 0) list.push({ key: pl.entry.key, hours: round1(h) });
    }
    return { sum, items: list };
  };
  const weeks = weeksOfYear(year).map((w) => {
    const l = load(w.from, w.to);
    return { ...w, capacityHours: round1(perDay * w.days), plannedHours: round1(l.sum), items: l.items };
  });
  const months = monthsOfYear(year).map((m) => {
    const l = load(m.from, m.to);
    return { ...m, capacityHours: round1(perDay * m.days), plannedHours: round1(l.sum), items: l.items };
  });
  const plannedTotal = placed.reduce((n, pl) => n + pl.entry.hours, 0);

  conflicts.sort((a, b) => cmpStr(a.from, b.from) || cmpStr(a.reason, b.reason));

  return {
    status: budget === null ? 'no_budget' : 'ok',
    year,
    range: bounds,
    totals: { capacityHours: round1(perDay * N), plannedHours: round1(plannedTotal) },
    weeks,
    months,
    items,
    queue,
    conflicts,
    notFit,
    needHours,
  };
}

/** Часы плана за даты [from, to] включительно (равномерно по дням отрезков). */
export function plannedHoursBetween(items: readonly PlanItem[], from: string, to: string): number {
  const a = dayNum(from);
  const b = dayNum(to);
  let sum = 0;
  for (const it of items) {
    for (const s of it.segments) {
      const sa = dayNum(s.from);
      const sb = dayNum(s.to);
      // часы отрезка до округления восстановить нельзя, поэтому берём часы игры * дни отрезка / дни игры
      sum += (it.hours as number) * (overlapDays(a, b, sa, sb) / it.days);
    }
  }
  return sum;
}
