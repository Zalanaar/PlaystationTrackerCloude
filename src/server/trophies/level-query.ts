// П12.3 «Уровень PSN» (GET /api/trophies/level): официальный уровень из профиля PSN + история по датам трофеев.
// Очки сейчас — из счётчиков профиля (официальные); очки N дней назад = сейчас − очки трофеев, полученных после этой даты
// (по всем трофеям пользователя, включая скрытые игры: PSN считает и их). Если расчёт по очкам не сходится с уровнем PSN
// (старые трофеи без даты, не все сеты загружены) — approximate: true, остаток до уровня из процента PSN.
import { and, eq, gt, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { etaDate, levelFromPoints, milestoneAfter, pointsOf, pointsToReach, stepAt, TROPHY_POINTS } from './level';

const { psnProfile, trophies } = schema;
const DAY = 86_400_000;

export type LevelGain = { points: number; levels: number };
export type LevelResponse = {
  /** null — синк ещё не сохранял профиль или PSN не дал уровень: блока нет */
  level: number | null;
  progress: number | null;
  tier: number | null;
  /** очки сейчас (из счётчиков профиля); null — счётчиков нет */
  points: number | null;
  /** очков до следующего уровня; null — нет данных */
  toNext: number | null;
  gained: { d30: LevelGain; d365: LevelGain } | null;
  /** прогноз по темпу последних 90 дней (МСК «YYYY-MM-DD»); null — темпа нет */
  eta: { next: string | null; milestone: { level: number; date: string | null } | null } | null;
  approximate: boolean;
};

const EMPTY: LevelResponse = { level: null, progress: null, tier: null, points: null, toNext: null, gained: null, eta: null, approximate: false };

async function pointsSince(db: AnyDb, userId: UserId, since: Date): Promise<number> {
  const P = TROPHY_POINTS;
  // очки — константы кода, не ввод: литералами (у параметров внутри case Postgres не выводит тип)
  const pts = sql.raw(`case "type" when 'platinum' then ${P.platinum} when 'gold' then ${P.gold} when 'silver' then ${P.silver} else ${P.bronze} end`);
  const [r] = await db
    .select({ pts: sql<string>`coalesce(sum(${pts}), 0)` })
    .from(trophies)
    .where(and(eq(trophies.userId, userId), eq(trophies.earned, true), gt(trophies.earnedAt, since)));
  return Number(r?.pts ?? 0);
}

export async function getLevel(db: AnyDb, userId: UserId, now: Date): Promise<LevelResponse> {
  const [p] = await db.select().from(psnProfile).where(eq(psnProfile.userId, userId)).limit(1);
  if (!p || p.trophyLevel === null) return EMPTY;
  const level = p.trophyLevel;
  const progress = p.trophyProgress;
  const counts = p.earnedPlatinum !== null && p.earnedGold !== null && p.earnedSilver !== null && p.earnedBronze !== null
    ? { platinum: p.earnedPlatinum, gold: p.earnedGold, silver: p.earnedSilver, bronze: p.earnedBronze }
    : null;
  if (!counts) {
    const toNext = progress !== null ? Math.ceil(stepAt(level) * (100 - progress) / 100) : null;
    return { ...EMPTY, level, progress, tier: p.trophyTier, toNext, approximate: true };
  }
  const points = pointsOf(counts);
  const calc = levelFromPoints(points);
  const exact = calc.level === level;
  const toNext = exact ? pointsToReach(level + 1) - points : progress !== null ? Math.ceil(stepAt(level) * (100 - progress) / 100) : null;
  const [p30, p365, p90] = await Promise.all([
    pointsSince(db, userId, new Date(now.getTime() - 30 * DAY)),
    pointsSince(db, userId, new Date(now.getTime() - 365 * DAY)),
    pointsSince(db, userId, new Date(now.getTime() - 90 * DAY)),
  ]);
  const gain = (pts: number): LevelGain => ({ points: pts, levels: Math.max(0, calc.level - levelFromPoints(points - pts).level) });
  const perDay = p90 / 90;
  const m = milestoneAfter(level);
  const eta = perDay > 0 && toNext !== null
    ? { next: etaDate(toNext, perDay, now), milestone: m !== null ? { level: m, date: etaDate(pointsToReach(m) - (exact ? points : pointsToReach(level + 1) - toNext), perDay, now) } : null }
    : null;
  return { level, progress, tier: p.trophyTier, points, toNext, gained: { d30: gain(p30), d365: gain(p365) }, eta, approximate: !exact };
}
