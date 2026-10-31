// Связанные версии игры (Фаза 23): PS4/PS5-копии одной игры склеены в главную карточку.
import type { GameItem } from '@/server/collection/types';
import { formatHoursShort } from '../format';

export type LinkedVersion = { gameId: number; title: string; platform: string; hours: number };

/** Связанные версии главной игры; пусто, если поля нет (старый ответ) или версий нет. */
export function linkedVersionsOf(game: Pick<GameItem, 'id'> | null | undefined): LinkedVersion[] {
  const v = (game as { linkedVersions?: LinkedVersion[] | null } | null | undefined)?.linkedVersions;
  return Array.isArray(v) ? v : [];
}

export function linkedHoursText(hours: number): string {
  return hours >= 0.5 ? formatHoursShort(hours) : 'нет часов';
}
