// Детали игры для окна (контракт 12.5, 26): GameItem + даты + список трофеев всех сетов игры + история по неделям. Пять запросов, без N+1.
import { and, asc, eq, or } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { mergeDuplicateSnapshots } from '@/server/stats/duplicates';
import type { EstimateInput } from '@/server/stats/hours';
import { buildGameHistory } from './history';
import { platinumForecast, setAggsFromTrophies } from './platinum';
import { getGamesByIds } from './query';
import type { GameDetailsResponse, GameGuide, GameTrophyItem } from './types';
import { getGameGuide } from '@/server/guides/game-guide';

const { games, gameStatus, gameReviews, gameMonthExclusions, gameTrophySets, playtimeSnapshots, trophies } = schema;

export type TrophyRow = {
  setId: number;
  trophyId: number;
  groupId?: string | null;
  type: GameTrophyItem['type'];
  name: string | null;
  detail: string | null;
  iconUrl: string | null;
  hidden: boolean;
  earned: boolean;
  earnedAt: Date | null;
  rarity: number | null;
  /** numeric(5,2) приходит строкой */
  earnedRate: string | null;
};

/** Строка БД -> трофей API. Скрытый и не полученный: name/detail/iconUrl = null (12.5). */
export function toTrophyItem(r: TrophyRow): GameTrophyItem {
  const mask = r.hidden && !r.earned;
  const rate = r.earnedRate === null ? null : Number(r.earnedRate);
  return {
    setId: r.setId,
    trophyId: r.trophyId,
    groupId: r.groupId ?? null,
    type: r.type,
    name: mask ? null : r.name,
    detail: mask ? null : r.detail,
    iconUrl: mask ? null : r.iconUrl,
    hidden: r.hidden,
    earned: r.earned,
    earnedAt: r.earned && r.earnedAt ? r.earnedAt.toISOString() : null,
    rarity: r.rarity,
    earnedRate: rate !== null && Number.isFinite(rate) ? Math.round(rate * 100) / 100 : null,
  };
}

/** null, если игры нет. Скрытые игры отдаются (hiddenAt не null). */
/** 26.3: два запроса (снимки группы и исключённые месяцы), оба с user_id, число запросов не зависит от числа игр. */
async function loadHistoryInput(db: AnyDb, userId: UserId, id: number) {
  const [rows, exRows] = await Promise.all([
    db
      .select({
        gameId: playtimeSnapshots.gameId,
        date: playtimeSnapshots.snapshotDate,
        seconds: playtimeSnapshots.playDurationSeconds,
        snapLastPlayedAt: playtimeSnapshots.lastPlayedAt,
        firstPlayedAt: games.firstPlayedAt,
        gameLastPlayedAt: games.lastPlayedAt,
        duplicateOf: games.duplicateOfGameId,
      })
      .from(playtimeSnapshots)
      .innerJoin(games, and(eq(games.id, playtimeSnapshots.gameId), eq(games.userId, userId)))
      .where(and(eq(playtimeSnapshots.userId, userId), or(eq(games.id, id), eq(games.duplicateOfGameId, id))))
      .orderBy(asc(playtimeSnapshots.gameId), asc(playtimeSnapshots.snapshotDate)),
    db
      .select({ month: gameMonthExclusions.month })
      .from(gameMonthExclusions)
      .where(and(eq(gameMonthExclusions.userId, userId), eq(gameMonthExclusions.gameId, id))),
  ]);
  const excluded = new Set(exRows.map((r) => r.month));
  const dup = new Map<number, number>();
  const firstByVersion = new Map<number, EstimateInput>();
  for (const r of rows) {
    if (r.duplicateOf !== null) dup.set(r.gameId, id);
    // строки по возрастанию даты: первая строка версии = первый снимок (D0, S0, L0, 1.6)
    if (!firstByVersion.has(r.gameId)) {
      firstByVersion.set(r.gameId, {
        gameId: id,
        firstSnapshotDate: r.date,
        firstSeconds: r.seconds,
        firstPlayedAt: r.firstPlayedAt,
        lastPlayedAt: r.snapLastPlayedAt ?? r.gameLastPlayedAt,
        ...(excluded.size > 0 ? { excludedMonths: excluded } : {}),
      });
    }
  }
  return {
    snaps: mergeDuplicateSnapshots(rows.map((r) => ({ gameId: r.gameId, date: r.date, seconds: r.seconds })), dup),
    estimates: [...firstByVersion.values()],
  };
}

export async function getGameDetails(db: AnyDb, userId: UserId, id: number): Promise<GameDetailsResponse | null> {
  const [[game], [meta], rows, historyInput] = await Promise.all([
    getGamesByIds(db, userId, [id]).then((g) => [g[0]] as const),
    db
      .select({
        firstPlayedAt: games.firstPlayedAt,
        statusChangedAt: gameStatus.statusChangedAt,
        reviewRating: gameReviews.rating,
        reviewNote: gameReviews.note,
        reviewUpdatedAt: gameReviews.updatedAt,
      })
      .from(games)
      .leftJoin(gameStatus, and(eq(gameStatus.gameId, games.id), eq(gameStatus.userId, userId)))
      .leftJoin(gameReviews, and(eq(gameReviews.gameId, games.id), eq(gameReviews.userId, userId)))
      .where(and(eq(games.id, id), eq(games.userId, userId)))
      .limit(1)
      .then((m) => [m[0]] as const),
    db
      .selectDistinct({
        setId: trophies.trophySetId,
        trophyId: trophies.trophyId,
        groupId: trophies.groupId,
        type: trophies.type,
        name: trophies.name,
        detail: trophies.detail,
        iconUrl: trophies.iconUrl,
        hidden: trophies.hidden,
        earned: trophies.earned,
        earnedAt: trophies.earnedAt,
        rarity: trophies.rarity,
        earnedRate: trophies.earnedRate,
      })
      .from(gameTrophySets)
      .innerJoin(trophies, and(eq(trophies.trophySetId, gameTrophySets.trophySetId), eq(trophies.userId, userId)))
      .innerJoin(games, and(eq(games.id, gameTrophySets.gameId), eq(games.userId, userId)))
      // 25.3: трофеи всей группы (сама игра и её дубли); сет, привязанный к нескольким версиям, не задваивается (distinct)
      .where(and(eq(gameTrophySets.userId, userId), or(eq(games.id, id), eq(games.duplicateOfGameId, id))))
      .orderBy(asc(trophies.trophySetId), asc(trophies.trophyId)),
    loadHistoryInput(db, userId, id),
  ]);
  if (!game || !meta) return null;
  // F2-B: гайд не роняет окно игры (нет снимка индекса / сбой — только ссылки-поиск)
  const guide = await getGameGuide(db, userId, id).catch((): GameGuide => ({ match: null, override: null, dismissed: false }));
  const trophyList = rows.map(toTrophyItem);
  const history = buildGameHistory({ ...historyInput, trophies: trophyList });
  return {
    game,
    firstPlayedAt: meta.firstPlayedAt ? meta.firstPlayedAt.toISOString() : null,
    statusChangedAt: meta.statusChangedAt ? meta.statusChangedAt.toISOString() : null,
    trophyList,
    // 14.2: из уже загруженного списка, без нового запроса
    platinumForecast: platinumForecast(setAggsFromTrophies(trophyList)),
    history,
    review: meta.reviewUpdatedAt ? { rating: meta.reviewRating, note: meta.reviewNote, updatedAt: meta.reviewUpdatedAt.toISOString() } : null,
    guide,
  };
}
