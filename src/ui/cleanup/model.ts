// Идея 5 (аудит UX): «Чистка бэклога» — игры, которые лежат в бэклоге не меньше 2 лет и наиграно меньше часа.
// По одной: «Оставить», «Отложить», «Бросить»; в конце итог «−N ч из бэклога». Без DOM и React.
import type { BacklogAgeResponse } from '@/server/collection/backlog-age';
import { isCleanupCandidate } from '@/server/collection/backlog-age';
import type { GameItem } from '@/server/collection/types';
import { formatHoursApprox, formatNumber, plural } from '../format';

export type CleanupChoice = 'keep' | 'shelved' | 'dropped';
export type CleanupItem = { game: GameItem; since: string; days: number };
export type Decision = { gameId: number; choice: CleanupChoice; hours: number };

const DAY = 86_400_000;

/** Кандидаты в порядке «дольше всех ждёт — первым». Игры, которых нет в списке бэклога (уже сменили статус), пропускаются. */
export function cleanupQueue(age: Pick<BacklogAgeResponse, 'items'>, backlog: readonly GameItem[], now: number): CleanupItem[] {
  const byId = new Map(backlog.map((g) => [g.id, g]));
  const out: CleanupItem[] = [];
  for (const it of age.items) {
    const g = byId.get(it.gameId);
    if (!g || g.status !== 'backlog') continue;
    const days = Math.floor((now - Date.parse(it.since)) / DAY);
    if (isCleanupCandidate(days, it.playSeconds ?? g.playSeconds)) out.push({ game: g, since: it.since, days });
  }
  return out.sort((a, b) => b.days - a.days || a.game.id - b.game.id);
}

/** Сколько часов уходит из бэклога вместе с игрой: остаток прохождения, иначе полная длительность, иначе 0. */
export function freedHours(g: GameItem): number {
  const d = g.duration;
  return d?.remainingHours ?? d?.hours ?? 0;
}

export type CleanupTotals = { done: number; kept: number; shelved: number; dropped: number; hours: number };

export function cleanupTotals(ds: readonly Decision[]): CleanupTotals {
  const t: CleanupTotals = { done: ds.length, kept: 0, shelved: 0, dropped: 0, hours: 0 };
  for (const d of ds) {
    if (d.choice === 'keep') t.kept += 1;
    else {
      if (d.choice === 'shelved') t.shelved += 1;
      else t.dropped += 1;
      t.hours += d.hours;
    }
  }
  t.hours = Math.round(t.hours * 10) / 10;
  return t;
}

/** «−120 ч из бэклога» или null, если ничего не ушло (или длительности неизвестны). */
export function freedText(t: CleanupTotals): string | null {
  return t.hours > 0 ? `−${formatHoursApprox(t.hours)} из бэклога` : null;
}

/** «Разобрано 12: отложено 3, брошено 5, оставлено 4». */
export function totalsText(t: CleanupTotals): string {
  const parts = [t.shelved && `отложено ${formatNumber(t.shelved)}`, t.dropped && `брошено ${formatNumber(t.dropped)}`, t.kept && `оставлено ${formatNumber(t.kept)}`].filter(Boolean);
  return parts.length ? `Разобрано ${formatNumber(t.done)}: ${parts.join(', ')}` : 'Ничего не разобрано';
}

/** Свайп: вправо — оставить, влево — отложить; короче порога — ничего. Бросить — только кнопкой. */
export const SWIPE_PX = 90;
export function swipeChoice(dx: number): CleanupChoice | null {
  if (dx >= SWIPE_PX) return 'keep';
  if (dx <= -SWIPE_PX) return 'shelved';
  return null;
}

/** «7 игр» для ссылки «Чистка: 7 игр» на Бэклоге. */
export const cleanupText = (n: number) => `${formatNumber(n)} ${plural(n, ['игра', 'игры', 'игр'])}`;
