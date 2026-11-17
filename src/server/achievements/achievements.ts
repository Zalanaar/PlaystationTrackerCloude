// П13.1 «Достижения»: личные вехи по данным коллекции (без новых таблиц). Каждое — цель, текущее значение и дата получения,
// если её можно восстановить (N-я пройденная игра, N-й трофей, первый ультраредкий). Часы и «Марафон» — без даты.
// Пройденные/жанры/оценки — по видимым играм (без скрытых и дублей); трофеи — все трофеи пользователя (как PSN).
import { and, asc, count, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { effectiveGenres } from '@/shared/genres';
import { visibleGameRow } from '@/server/collection/visibility';

const { games, gameStatus, trophies, gameReviews } = schema;

export type AchievementId =
  | 'completed_1' | 'completed_10' | 'completed_50' | 'platinum_1' | 'platinum_10' | 'trophies_1000'
  | 'ultra_rare' | 'hours_100' | 'hours_1000' | 'marathon' | 'genres_5' | 'critic_10';

export type Achievement = {
  id: AchievementId;
  target: number;
  /** текущее значение (не больше цели не обрезаем: UI сам пишет «12 из 10» как получено) */
  value: number;
  unlocked: boolean;
  /** ISO момента получения; null — не получено или дату не восстановить */
  at: string | null;
  /** подпись к получению (название игры для «Марафона»), иначе null */
  detail: string | null;
};
export type AchievementsResponse = { items: Achievement[]; unlocked: number; total: number };

export const ULTRA_RARE_RATE = 1;
export const MARATHON_HOURS = 100;

type Facts = {
  completedAt: (Date | null)[]; // по возрастанию, без даты — в конце
  platinumAt: (Date | null)[];
  trophyCount: number; trophy1000At: Date | null;
  ultraRareAt: Date | null; ultraRareCount: number;
  totalSeconds: number;
  maxGame: { title: string; seconds: number } | null;
  genres: number;
  rated: number;
};

// часы игры с версиями-дублями; квалификаторы явные: в запросе по одной таблице drizzle пишет колонки без имени таблицы,
// и "id" внутри подзапроса ссылался бы на сам подзапрос
const gameSecondsSql = sql<number>`("games"."play_duration_seconds" + coalesce((select sum(d."play_duration_seconds") from "games" d where d."user_id" = "games"."user_id" and d."duplicate_of_game_id" = "games"."id"), 0))::int`;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Чистая сборка из фактов. */
export function buildAchievements(f: Facts): AchievementsResponse {
  const nth = (list: (Date | null)[], n: number) => (list.length >= n ? iso(list[n - 1]) : null);
  const mk = (id: AchievementId, target: number, value: number, at: string | null = null, detail: string | null = null): Achievement => {
    const unlocked = value >= target;
    return { id, target, value, unlocked, at: unlocked ? at : null, detail: unlocked ? detail : null };
  };
  const hours = Math.floor(f.totalSeconds / 3600);
  const maxH = f.maxGame ? Math.floor(f.maxGame.seconds / 3600) : 0;
  const items: Achievement[] = [
    mk('completed_1', 1, f.completedAt.length, nth(f.completedAt, 1)),
    mk('completed_10', 10, f.completedAt.length, nth(f.completedAt, 10)),
    mk('completed_50', 50, f.completedAt.length, nth(f.completedAt, 50)),
    mk('platinum_1', 1, f.platinumAt.length, nth(f.platinumAt, 1)),
    mk('platinum_10', 10, f.platinumAt.length, nth(f.platinumAt, 10)),
    mk('trophies_1000', 1000, f.trophyCount, iso(f.trophy1000At)),
    mk('ultra_rare', 1, f.ultraRareCount, iso(f.ultraRareAt)),
    mk('hours_100', 100, hours),
    mk('hours_1000', 1000, hours),
    mk('marathon', MARATHON_HOURS, maxH, null, f.maxGame?.title.trim() ?? null),
    mk('genres_5', 5, f.genres),
    mk('critic_10', 10, f.rated),
  ];
  return { items, unlocked: items.filter((i) => i.unlocked).length, total: items.length };
}

export async function getAchievements(db: AnyDb, userId: UserId): Promise<AchievementsResponse> {
  const visible = and(eq(games.userId, userId), visibleGameRow());
  const [done, plats, tCount, t1000, rare, rareCount, secs, maxGame, rated] = await Promise.all([
    db.select({ at: gameStatus.completedAt, psn: games.psnGenres, override: games.genresOverride })
      .from(games).innerJoin(gameStatus, and(eq(gameStatus.gameId, games.id), eq(gameStatus.userId, userId)))
      .where(and(visible, eq(gameStatus.status, 'completed')))
      .orderBy(sql`${gameStatus.completedAt} asc nulls last`, asc(games.id)),
    db.select({ at: trophies.earnedAt }).from(trophies)
      .where(and(eq(trophies.userId, userId), eq(trophies.earned, true), eq(trophies.type, 'platinum')))
      .orderBy(sql`${trophies.earnedAt} asc nulls last`, asc(trophies.id)),
    db.select({ n: count() }).from(trophies).where(and(eq(trophies.userId, userId), eq(trophies.earned, true))),
    db.select({ at: trophies.earnedAt }).from(trophies)
      .where(and(eq(trophies.userId, userId), eq(trophies.earned, true), isNotNull(trophies.earnedAt)))
      .orderBy(asc(trophies.earnedAt), asc(trophies.id)).offset(999).limit(1),
    db.select({ at: trophies.earnedAt }).from(trophies)
      .where(and(eq(trophies.userId, userId), eq(trophies.earned, true), isNotNull(trophies.earnedAt), lt(trophies.earnedRate, String(ULTRA_RARE_RATE))))
      .orderBy(asc(trophies.earnedAt), asc(trophies.id)).limit(1),
    db.select({ n: count() }).from(trophies)
      .where(and(eq(trophies.userId, userId), eq(trophies.earned, true), lt(trophies.earnedRate, String(ULTRA_RARE_RATE)))),
    db.select({ s: sql<string>`coalesce(sum(${games.playDurationSeconds}), 0)` }).from(games)
      .where(and(eq(games.userId, userId), isNull(games.hiddenAt))),
    db.select({ title: games.name, s: gameSecondsSql }).from(games).where(visible)
      .orderBy(sql`2 desc`, asc(games.id)).limit(1),
    db.select({ n: count() }).from(gameReviews)
      .innerJoin(games, and(eq(games.id, gameReviews.gameId), eq(games.userId, userId)))
      .where(and(eq(gameReviews.userId, userId), isNotNull(gameReviews.rating), visibleGameRow())),
  ]);
  const genres = new Set<string>();
  for (const d of done) for (const g of effectiveGenres(d.psn, d.override)) genres.add(g);
  const m = maxGame[0];
  return buildAchievements({
    completedAt: done.map((d) => d.at),
    platinumAt: plats.map((p) => p.at),
    trophyCount: Number(tCount[0]?.n ?? 0),
    trophy1000At: t1000[0]?.at ?? null,
    ultraRareAt: rare[0]?.at ?? null,
    ultraRareCount: Number(rareCount[0]?.n ?? 0),
    totalSeconds: Number(secs[0]?.s ?? 0),
    maxGame: m && Number(m.s) > 0 ? { title: m.title, seconds: Number(m.s) } : null,
    genres: genres.size,
    rated: Number(rated[0]?.n ?? 0),
  });
}
