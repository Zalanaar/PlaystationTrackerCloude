// D-P3: «Следующая по плану» на странице «Бэклог». Чистая логика поверх ответа GET /api/roadmap (контракт 17.5).
import type { PlanItem, RoadmapResponse } from '@/server/roadmap/types';

export type NextUp = { gameId: number; from: string; to: string; then: { title: string; from: string; to: string } | null };

/**
 * Первая по дате игра плана из бэклога, которая ещё не закончилась (end >= today) и есть в загруженном списке,
 * плюс следующая за ней запись плана (любого вида). null: плана нет, бюджет не задан или игры в списке нет.
 */
export function pickNextUp(plan: Pick<RoadmapResponse, 'status' | 'items' | 'today'> | null, inList: (gameId: number) => boolean): NextUp | null {
  if (!plan || plan.status !== 'ok') return null;
  const items = [...plan.items].filter((i) => i.end >= plan.today).sort((a, b) => a.start.localeCompare(b.start) || (a.queuePosition ?? 1e9) - (b.queuePosition ?? 1e9));
  const idx = items.findIndex((i) => i.kind === 'backlog' && i.gameId !== null && inList(i.gameId));
  if (idx < 0) return null;
  const cur = items[idx] as PlanItem & { gameId: number };
  const nx = items.slice(idx + 1).find((i) => i.key !== cur.key) ?? null;
  return { gameId: cur.gameId, from: cur.start, to: cur.end, then: nx ? { title: nx.title, from: nx.start, to: nx.end } : null };
}
