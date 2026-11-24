// Единый источник «следующей игры»: незакрытые цели месяца (порядок выбора), затем очередь Плана.
export type NextGamePlanItem = {
  kind: string;
  gameId: number | null;
  title: string;
  coverUrl: string | null;
  hours: number | null;
};

export type NextGameGoal = {
  id: number;
  title: string;
  coverUrl: string | null;
  completed?: boolean;
};

export type NextUp = {
  gameId: number;
  title: string;
  coverUrl: string | null;
  hours: number | null;
  source: 'month_goal' | 'plan';
};

/** Часы цели месяца из «часов в неделю» Плана: недели = дни месяца / 7. */
export function planMonthHoursHint(hoursPerWeek: number | null | undefined, year: number, monthNum: number): number | null {
  if (hoursPerWeek == null || !Number.isFinite(hoursPerWeek) || hoursPerWeek <= 0) return null;
  const days = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  const n = Math.round(hoursPerWeek * (days / 7));
  if (n < 1) return null;
  return Math.min(744, n);
}

/** Полный список «что дальше», без doneId и уже пройденных целей. */
export function listNextGames(
  planItems: readonly NextGamePlanItem[] | null | undefined,
  monthGoals: readonly NextGameGoal[] | null | undefined,
  doneId?: number | null,
): NextUp[] {
  const out: NextUp[] = [];
  const seen = new Set<number>();
  const skip = (id: number) => id === doneId || seen.has(id);
  const planById = new Map<number, NextGamePlanItem>();
  for (const it of planItems ?? []) {
    if (it.kind === 'backlog' && it.gameId !== null) planById.set(it.gameId, it);
  }
  for (const g of monthGoals ?? []) {
    if (g.completed || skip(g.id)) continue;
    seen.add(g.id);
    const p = planById.get(g.id);
    out.push({ gameId: g.id, title: g.title, coverUrl: g.coverUrl, hours: p?.hours ?? null, source: 'month_goal' });
  }
  for (const it of planItems ?? []) {
    if (it.kind !== 'backlog' || it.gameId === null || skip(it.gameId)) continue;
    seen.add(it.gameId);
    out.push({ gameId: it.gameId, title: it.title, coverUrl: it.coverUrl, hours: it.hours, source: 'plan' });
  }
  return out;
}

export function firstNextGame(
  planItems: readonly NextGamePlanItem[] | null | undefined,
  monthGoals: readonly NextGameGoal[] | null | undefined,
  doneId?: number | null,
): NextUp | null {
  return listNextGames(planItems, monthGoals, doneId)[0] ?? null;
}
