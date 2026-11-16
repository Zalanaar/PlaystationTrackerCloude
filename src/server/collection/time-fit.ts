// П12.5 «У меня 2 часа»: что успеть за вечер. «Успеешь пройти» — остаток по длительности (ручная или HLTB) минус наигранное
// помещается в бюджет (с запасом 15%); «Продолжить» — остальные игры «Играю» по давности запуска. Скрытые и дубли не считаются.
import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { effectiveSecondsSql } from './query';
import { visibleGameRow } from './visibility';

const { games, gameStatus } = schema;

export const TIME_FIT_MINUTES = [60, 120, 180, 240] as const;
export const TIME_FIT_DEFAULT = 120;
export const TIME_FIT_SLACK = 1.15;
export const FINISH_LIMIT = 5;
export const RESUME_LIMIT = 3;

export type TimeFitItem = {
  id: number; title: string; coverUrl: string | null; status: 'playing' | 'backlog';
  /** минут до конца по длительности; null — длительность неизвестна или уже переиграна */
  remainingMinutes: number | null;
  lastPlayedAt: string | null;
};
export type TimeFitResponse = { minutes: number; finish: TimeFitItem[]; resume: TimeFitItem[] };

export type TimeFitRow = {
  id: number; title: string; coverUrl: string | null; status: 'playing' | 'backlog';
  hours: number | null; playSeconds: number; lastPlayedAt: Date | null;
};

export function parseMinutes(v: string | null): number | null {
  if (v === null || v === '') return TIME_FIT_DEFAULT;
  const n = Number(v);
  return Number.isInteger(n) && n >= 15 && n <= 600 ? n : null;
}

export function remainingMinutes(hours: number | null, playSeconds: number): number | null {
  if (hours === null || !(hours > 0)) return null;
  const m = Math.round(hours * 60 - playSeconds / 60);
  return m > 0 ? m : null;
}

/** Чистый выбор по строкам (без БД и часов). */
export function pickTimeFit(rows: readonly TimeFitRow[], minutes: number): TimeFitResponse {
  const items = rows.map((r) => ({
    id: r.id, title: r.title, coverUrl: r.coverUrl, status: r.status,
    remainingMinutes: remainingMinutes(r.hours, r.playSeconds), lastPlayedAt: r.lastPlayedAt ? r.lastPlayedAt.toISOString() : null,
  } satisfies TimeFitItem));
  const cap = Math.round(minutes * TIME_FIT_SLACK);
  const finish = items
    .filter((i) => i.remainingMinutes !== null && i.remainingMinutes <= cap)
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'playing' ? -1 : 1) || b.remainingMinutes! - a.remainingMinutes! || a.title.localeCompare(b.title, 'ru') || a.id - b.id)
    .slice(0, FINISH_LIMIT);
  const taken = new Set(finish.map((i) => i.id));
  const resume = items
    .filter((i) => i.status === 'playing' && !taken.has(i.id))
    .sort((a, b) => (b.lastPlayedAt ?? '').localeCompare(a.lastPlayedAt ?? '') || a.id - b.id)
    .slice(0, RESUME_LIMIT);
  return { minutes, finish, resume };
}

export async function getTimeFit(db: AnyDb, userId: UserId, minutes: number): Promise<TimeFitResponse> {
  const rows = await db
    .select({
      id: games.id, title: games.name, coverUrl: games.imageUrl, status: gameStatus.status,
      override: games.durationOverrideHours, main: games.hltbMainHours, playSeconds: effectiveSecondsSql, lastPlayedAt: games.lastPlayedAt,
    })
    .from(games)
    .innerJoin(gameStatus, and(eq(gameStatus.gameId, games.id), eq(gameStatus.userId, userId)))
    .where(and(eq(games.userId, userId), visibleGameRow(), inArray(gameStatus.status, ['playing', 'backlog'])));
  return pickTimeFit(rows.map((r) => ({
    id: r.id, title: r.title, coverUrl: r.coverUrl, status: r.status as 'playing' | 'backlog',
    hours: r.override ?? r.main ?? null, playSeconds: Number(r.playSeconds) || 0, lastPlayedAt: r.lastPlayedAt,
  })), minutes);
}
