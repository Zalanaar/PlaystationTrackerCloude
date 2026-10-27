// Чистая логика «Разбора»: очередь игр без статуса, история действий, отмена, свайп (design-system §4.9).
import type { GameItem, GameStatusValue } from '@/server/collection/types';
import { TRIAGE_KEYS, TRIAGE_SWIPE } from '../tokens';

export type Action = { kind: 'status'; game: GameItem; status: GameStatusValue } | { kind: 'skip'; game: GameItem };
export type TriageState = { queue: GameItem[]; history: Action[] };

export const SWIPE_THRESHOLD = 0.3; // доля ширины карточки
export const SWIPE_STAMP = 0.12;    // с какой доли показывается штамп

export function initState(queue: GameItem[]): TriageState {
  return { queue, history: [] };
}

/** Присвоить статус первой игре очереди. */
export function applyStatus(s: TriageState, status: GameStatusValue): TriageState {
  const [head, ...rest] = s.queue;
  if (!head) return s;
  return { queue: rest, history: [...s.history, { kind: 'status', game: head, status }] };
}

/** Пропуск: игра уходит в конец очереди. */
export function skip(s: TriageState): TriageState {
  const [head, ...rest] = s.queue;
  if (!head) return s;
  return { queue: [...rest, head], history: [...s.history, { kind: 'skip', game: head }] };
}

/** Отмена последнего действия. Возвращает отменённое действие, чтобы вызвать PUT с прежним статусом (null). */
export function undo(s: TriageState): { state: TriageState; undone: Action | null } {
  const last = s.history[s.history.length - 1];
  if (!last) return { state: s, undone: null };
  const history = s.history.slice(0, -1);
  if (last.kind === 'status') return { state: { queue: [last.game, ...s.queue], history }, undone: last };
  // пропуск: игра была в конце очереди
  const q = s.queue.filter((g) => g.id !== last.game.id);
  return { state: { queue: [last.game, ...q], history }, undone: last };
}

/** Откат неудачного PUT: игра возвращается в начало, запись истории по ней убирается. */
export function rollback(s: TriageState, game: GameItem): TriageState {
  const idx = [...s.history].reverse().findIndex((a) => a.kind === 'status' && a.game.id === game.id);
  const history = idx < 0 ? s.history : s.history.filter((_, i) => i !== s.history.length - 1 - idx);
  return { queue: [game, ...s.queue.filter((g) => g.id !== game.id)], history };
}

/** Итог сессии по статусам (экран «Всё разобрано»). */
export function summarize(history: readonly Action[]): Partial<Record<GameStatusValue, number>> {
  const out: Partial<Record<GameStatusValue, number>> = {};
  for (const a of history) if (a.kind === 'status') out[a.status] = (out[a.status] ?? 0) + 1;
  return out;
}

export type SwipeTarget = GameStatusValue | 'skip';

/** Направление свайпа -> действие. null, пока смещение меньше порога (доля ширины). «Играю» и «Отложено» только кнопками. */
export function swipeTarget(dx: number, dy: number, width: number, fraction = SWIPE_THRESHOLD): SwipeTarget | null {
  const min = width * fraction;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < min) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? TRIAGE_SWIPE.right : TRIAGE_SWIPE.left;
  return dy < 0 ? TRIAGE_SWIPE.up : TRIAGE_SWIPE.down;
}

export type TriageCommand = { type: 'status'; status: GameStatusValue } | { type: 'skip' } | { type: 'undo' } | { type: 'exit' };

/** Клавиша -> команда. Модификаторы и ввод в поля обрабатывает вызывающий. */
export function keyCommand(key: string): TriageCommand | null {
  if (TRIAGE_KEYS[key]) return { type: 'status', status: TRIAGE_KEYS[key] };
  switch (key) {
    case ' ': case 'ArrowRight': case '0': return { type: 'skip' };
    case 'z': case 'Z': case 'я': case 'Я': case 'ArrowLeft': return { type: 'undo' };
    case 'Escape': return { type: 'exit' };
    default: return null;
  }
}

/** Прогресс: «37 / 214», осталось. Разобрано = все - без статуса. */
export function progress(all: number, none: number): { done: number; total: number; left: number; fraction: number } {
  const total = Math.max(all, 0);
  const left = Math.min(Math.max(none, 0), total);
  const done = total - left;
  return { done, total, left, fraction: total ? done / total : 1 };
}
