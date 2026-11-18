// П14.1 «Сравнение профилей»: два профиля PSN одного входа рядом — ключевые цифры и общие игры.
// Только профили входа сессии (чужой/архивный/несуществующий — null, неотличимы). Цифры — те же, что в «Достижениях»
// (видимые игры, трофеи как в PSN), общие игры — по concept_id (иначе title_id), часы с версиями-дублями.
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { asUserId } from '@/server/auth/user-id';
import { getProfileDto } from '@/server/auth/profiles';
import { getAchievements } from '@/server/achievements/achievements';
import { visibleGameRow } from '@/server/collection/visibility';

const { games, gameStatus } = schema;

export const COMMON_LIMIT = 20;

export type CompareMetricId = 'games' | 'completed' | 'hours' | 'trophies' | 'platinum' | 'ultra_rare' | 'achievements';
export type CompareSide = { id: number; onlineId: string | null; isPrimary: boolean; values: Record<CompareMetricId, number> };
export type CommonGame = { name: string; a: { hours: number; status: string | null }; b: { hours: number; status: string | null } };
export type CompareResponse = { a: CompareSide; b: CompareSide; common: { count: number; items: CommonGame[] } };

const gameSecondsSql = sql<number>`("games"."play_duration_seconds" + coalesce((select sum(d."play_duration_seconds") from "games" d where d."user_id" = "games"."user_id" and d."duplicate_of_game_id" = "games"."id"), 0))::int`;

type Row = { key: string; name: string; seconds: number; status: string | null };

async function gamesOf(db: AnyDb, userId: number): Promise<Row[]> {
  const rows = await db
    .select({ key: sql<string>`coalesce(${games.conceptId}, ${games.titleId})`, name: games.name, seconds: gameSecondsSql, status: gameStatus.status })
    .from(games)
    .leftJoin(gameStatus, and(eq(gameStatus.gameId, games.id), eq(gameStatus.userId, userId)))
    .where(and(eq(games.userId, userId), visibleGameRow()));
  return rows.map((r) => ({ key: r.key, name: r.name, seconds: Number(r.seconds) || 0, status: r.status ?? null }));
}

const hours = (s: number) => Math.round((s / 3600) * 10) / 10;

/** Чистая часть: пересечение по ключу (одна игра — одна строка; при нескольких версиях — больше часов), сортировка по сумме часов. */
export function commonGames(a: Row[], b: Row[], limit = COMMON_LIMIT): { count: number; items: CommonGame[] } {
  const pick = (rows: Row[]) => {
    const m = new Map<string, Row>();
    for (const r of rows) { const p = m.get(r.key); if (!p || r.seconds > p.seconds) m.set(r.key, r); }
    return m;
  };
  const ma = pick(a);
  const mb = pick(b);
  const both: { ra: Row; rb: Row }[] = [];
  for (const [k, ra] of ma) { const rb = mb.get(k); if (rb) both.push({ ra, rb }); }
  both.sort((x, y) => (y.ra.seconds + y.rb.seconds) - (x.ra.seconds + x.rb.seconds) || x.ra.name.localeCompare(y.ra.name, 'ru'));
  return {
    count: both.length,
    items: both.slice(0, limit).map(({ ra, rb }) => ({
      name: ra.name.trim(), a: { hours: hours(ra.seconds), status: ra.status }, b: { hours: hours(rb.seconds), status: rb.status },
    })),
  };
}

async function side(db: AnyDb, p: { id: number; onlineId: string | null; isPrimary: boolean }, rows: Row[]): Promise<CompareSide> {
  const ach = await getAchievements(db, asUserId(p.id));
  const v = (id: string) => ach.items.find((i) => i.id === id)?.value ?? 0;
  return {
    id: p.id, onlineId: p.onlineId, isPrimary: p.isPrimary,
    values: {
      games: rows.length,
      completed: v('completed_1'),
      hours: v('hours_100'),
      trophies: v('trophies_1000'),
      platinum: v('platinum_1'),
      ultra_rare: v('ultra_rare'),
      achievements: ach.unlocked,
    },
  };
}

export async function compareProfiles(db: AnyDb, loginId: number, aId: number, bId: number): Promise<CompareResponse | null> {
  if (aId === bId) return null;
  const [pa, pb] = await Promise.all([getProfileDto(db, loginId, aId), getProfileDto(db, loginId, bId)]);
  if (!pa || !pb) return null;
  const [ra, rb] = await Promise.all([gamesOf(db, pa.id), gamesOf(db, pb.id)]);
  const [a, b] = await Promise.all([side(db, pa, ra), side(db, pb, rb)]);
  return { a, b, common: commonGames(ra, rb) };
}
