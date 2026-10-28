// «Забытые игры» (спека Фазы 15 п.10, контракт 14.4): флаг карточки считает frontend по GameItem.
import type { GameItem } from '@/server/collection/types';

export const FORGOTTEN_DAYS = 90;
const DAY_MS = 86_400_000;

type Probe = Pick<GameItem, 'status' | 'playSeconds' | 'lastPlayedAt'>;

/** Без статуса, играл, не запускалась больше 90 суток (момент, не календарный день). */
export function isForgotten(g: Probe, nowMs: number): boolean {
  if (g.status !== null || !(g.playSeconds > 0) || !g.lastPlayedAt || !(nowMs > 0)) return false;
  const t = new Date(g.lastPlayedAt).getTime();
  return Number.isFinite(t) && nowMs - t > FORGOTTEN_DAYS * DAY_MS;
}

/** «5 мес.» / «1 г.» без запуска. null, если даты нет или она не старше месяца. */
export function forgottenSpan(lastPlayedAt: string | null, nowMs: number): string | null {
  if (!lastPlayedAt) return null;
  const t = new Date(lastPlayedAt).getTime();
  if (!Number.isFinite(t) || !(nowMs > 0)) return null;
  const days = Math.floor((nowMs - t) / DAY_MS);
  if (days >= 365) return `${Math.floor(days / 365)} г.`;
  if (days >= 30) return `${Math.floor(days / 30)} мес.`;
  return null;
}

/** Чип над меткой «Не разобрано»: «Забытая · не запускалась 5 мес.» */
export function forgottenChipText(lastPlayedAt: string | null, nowMs: number): string {
  const span = forgottenSpan(lastPlayedAt, nowMs);
  return span ? `Забытая · не запускалась ${span}` : 'Забытая';
}

export const FORGOTTEN_HINT = 'Начата, но давно не запускалась. Хороший кандидат на «Отложено» или «Брошено».';

/** Чип в блоке «Не разобрано» на Коллекции. */
export const forgottenCountText = (n: number) => `Забытых: ${n}`;
/** Подпись сегментов Разбора. */
export const triageSegments = (none: number, forgotten: number) => ({ all: `Все ${none}`, forgotten: `Забытые ${forgotten}` });

/** Безопасное число из ответа (старый ответ без поля = 0). */
export const forgottenCountOf = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
