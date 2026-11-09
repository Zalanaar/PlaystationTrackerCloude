// D-P3: «Следующая по плану» на странице «Бэклог». Чистая логика поверх ответа GET /api/roadmap (контракт 17.5).
import type { PlanItem, RoadmapResponse } from '@/server/roadmap/types';

export type NextUp = { gameId: number; from: string; to: string; then: { title: string; from: string; to: string } | null };

/**
 * Первая по дате игра плана из бэклога, которая ещё не закончилась (end >= today) и может быть в бэклоге (`inList`),
 * плюс следующая за ней запись плана (любого вида). null: плана нет, бюджет не задан или подходящей игры нет.
 * `inList` отвечает «нет» только для игр, которых в бэклоге точно нет (см. mayBeInBacklog): игра вне загруженной
 * страницы списка карточку не прячет и не подменяет следующей (п. 1 пакета 6).
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

/**
 * Пакет 6, п. 1: может ли игра быть в бэклоге. Раньше карточка искала игру только в загруженной странице списка
 * (BACKLOG_PAGE, сортировка по длительности), и долгая игра плана за пределами страницы прятала карточку.
 * Теперь «нет» только если список загружен целиком и игры в нём нет, или игра точно ушла из бэклога (`gone`).
 */
export function mayBeInBacklog(items: readonly { id: number }[], total: number, gone: ReadonlySet<number>) {
  const ids = new Set(items.map((g) => g.id));
  const complete = items.length >= total;
  return (gameId: number) => !gone.has(gameId) && (ids.has(gameId) || !complete);
}
