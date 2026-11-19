// Идея 3 (аудит UX): после «Пройдено» — лист с оценкой, заметкой и «что дальше» из Плана.
// Экраны, где статус меняют карточкой или меню, сообщают событием; лист один на приложение (AppShell).
import type { GameItem } from '@/server/collection/types';
import type { RoadmapResponse } from '@/server/roadmap/types';

export const COMPLETED_EVENT = 'ps:completed';

export type CompletedGame = Pick<GameItem, 'id' | 'title' | 'coverUrl'>;

/**
 * Игру отметили «Пройдено». Окно игры уже показывает «Мою оценку» — поверх него лист не нужен.
 */
export function announceCompleted(game: CompletedGame, doc: Pick<Document, 'querySelector'> | null = typeof document === 'undefined' ? null : document): boolean {
  if (!doc || doc.querySelector('.ps-gd')) return false;
  window.dispatchEvent(new CustomEvent<CompletedGame>(COMPLETED_EVENT, { detail: { id: game.id, title: game.title, coverUrl: game.coverUrl } }));
  return true;
}

export type NextUp = { gameId: number; title: string; coverUrl: string | null; hours: number | null };

/** Следующая игра бэклога по Плану (порядок расписания), не считая только что пройденной. */
export function nextFromPlan(r: Pick<RoadmapResponse, 'items'> | null, doneId: number): NextUp | null {
  const it = r?.items.find((x) => x.kind === 'backlog' && x.gameId !== null && x.gameId !== doneId);
  return it && it.gameId !== null ? { gameId: it.gameId, title: it.title, coverUrl: it.coverUrl, hours: it.hours } : null;
}
