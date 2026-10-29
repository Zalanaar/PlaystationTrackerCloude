// Чтение коллекции (контракт, раздел 9). Агрегация трофеев одним подзапросом, без N+1.
import { type AnyColumn, and, asc, desc, eq, gt, ilike, inArray, isNotNull, isNull, lt, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { GENRE_LABELS_RU, GENRE_NONE, effectiveGenres, hasNoGenres, type GenreFilterKey } from '@/shared/genres';
import { bucketSql, buildDuration, durationFilterSql, hltbFilterSql, hltbStatusSql, effectiveHoursSql, type DurationRow } from './duration';
import type {
  CollectionSummaryResponse,
  DurationCounts,
  HltbCounts,
  GenreCounts,
  GameItem,
  GameTrophies,
  GamesListResponse,
  Platform,
  StatusCounts,
} from './types';
import { forgottenCutoff } from './forgotten';
import { getNearPlatinumCandidates } from './platinum-query';
import { getPsnProfile } from './profile';
import type { ListQuery } from './validation';
import { trophySetCounted } from './visibility';

const { games, gameStatus, gameTrophySets, trophySets, trophies } = schema;

export const CONTINUE_LIMIT = 8;
export const PLAYING_LIMIT = 20;
export const SERVICES_LIMIT = 50;
const TZ = 'Europe/Moscow';

const PLATFORM: Record<string, Platform> = { ps4_game: 'PS4', ps5_native_game: 'PS5', pspc_game: 'PC' };

/** Дата «для года» = дата завершения: completed_at, иначе dropped_at (без fallback на last_played_at); год по Москве. */
const yearDate = sql`coalesce(${gameStatus.completedAt}, ${gameStatus.droppedAt})`;
const yearExpr = sql<number | null>`extract(year from (${yearDate} at time zone ${TZ}))::int`;

function trophyAgg(db: AnyDb) {
  const sumOf = (col: AnyColumn) => sql<number>`coalesce(sum(${col}), 0)::int`;
  return db
    .select({
      gameId: gameTrophySets.gameId,
      dB: sumOf(trophySets.definedBronze).as('d_bronze'),
      dS: sumOf(trophySets.definedSilver).as('d_silver'),
      dG: sumOf(trophySets.definedGold).as('d_gold'),
      dP: sumOf(trophySets.definedPlatinum).as('d_platinum'),
      eB: sumOf(trophySets.earnedBronze).as('e_bronze'),
      eS: sumOf(trophySets.earnedSilver).as('e_silver'),
      eG: sumOf(trophySets.earnedGold).as('e_gold'),
      eP: sumOf(trophySets.earnedPlatinum).as('e_platinum'),
    })
    .from(gameTrophySets)
    .innerJoin(trophySets, eq(trophySets.id, gameTrophySets.trophySetId))
    .groupBy(gameTrophySets.gameId)
    .as('tr');
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function statusFilterSql(statuses: ListQuery['statuses']): SQL | undefined {
  if (!statuses) return undefined;
  const real = statuses.filter((s) => s !== 'none') as Exclude<ListQuery['statuses'], null>;
  const parts: (SQL | undefined)[] = [];
  if (real.length) parts.push(inArray(gameStatus.status, real as never));
  if (statuses.includes('none')) parts.push(isNull(gameStatus.status));
  return or(...parts);
}

type Row = DurationRow & {
  id: number;
  name: string;
  imageUrl: string | null;
  bannerUrl: string | null;
  tint: string | null;
  category: string;
  psnGenres: string[];
  genresOverride: string[] | null;
  playSeconds: number;
  playCount: number;
  lastPlayedAt: Date | null;
  status: (typeof gameStatus.$inferSelect)['status'] | null;
  completedAt: Date | null;
  droppedAt: Date | null;
  hiddenAt: Date | null;
  tr: { dB: number; dS: number; dG: number; dP: number; eB: number; eS: number; eG: number; eP: number } | null;
};

export function toGameItem(r: Row): GameItem {
  let trophiesOut: GameTrophies | null = null;
  if (r.tr) {
    const t = r.tr;
    const defined = t.dB + t.dS + t.dG + t.dP;
    const earned = t.eB + t.eS + t.eG + t.eP;
    if (defined > 0) {
      trophiesOut = {
        earned,
        defined,
        progress: Math.min(100, Math.round((earned / defined) * 100)),
        platinumDefined: t.dP > 0,
        platinumEarned: t.eP > 0,
        byType: {
          platinum: { earned: t.eP, defined: t.dP },
          gold: { earned: t.eG, defined: t.dG },
          silver: { earned: t.eS, defined: t.dS },
          bronze: { earned: t.eB, defined: t.dB },
        },
      };
    }
  }
  return {
    id: r.id,
    title: r.name,
    coverUrl: r.imageUrl,
    bannerUrl: r.bannerUrl,
    tint: r.tint,
    platform: PLATFORM[r.category] ?? 'PS4',
    playSeconds: r.playSeconds,
    hours: Math.round(r.playSeconds / 360) / 10,
    playCount: r.playCount,
    lastPlayedAt: r.lastPlayedAt ? r.lastPlayedAt.toISOString() : null,
    status: r.status,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    droppedAt: r.droppedAt ? r.droppedAt.toISOString() : null,
    trophies: trophiesOut,
    genres: effectiveGenres(r.psnGenres, r.genresOverride).map((key) => ({ key, label: GENRE_LABELS_RU[key] })),
    hiddenAt: r.hiddenAt ? r.hiddenAt.toISOString() : null,
    duration: buildDuration(r),
  };
}

function itemsQuery(db: AnyDb) {
  const tr = trophyAgg(db);
  const q = db
    .select({
      id: games.id,
      name: games.name,
      imageUrl: games.imageUrl,
      bannerUrl: games.bannerUrl,
      tint: games.tint,
      category: games.category,
      psnGenres: games.psnGenres,
      genresOverride: games.genresOverride,
      playSeconds: games.playDurationSeconds,
      playCount: games.playCount,
      lastPlayedAt: games.lastPlayedAt,
      status: gameStatus.status,
      completedAt: gameStatus.completedAt,
      droppedAt: gameStatus.droppedAt,
      hiddenAt: games.hiddenAt,
      durationOverrideHours: games.durationOverrideHours,
      hltbId: games.hltbId,
      hltbName: games.hltbName,
      hltbMainHours: games.hltbMainHours,
      hltbExtraHours: games.hltbExtraHours,
      hltbCheckedAt: games.hltbCheckedAt,
      tr: {
        dB: tr.dB, dS: tr.dS, dG: tr.dG, dP: tr.dP,
        eB: tr.eB, eS: tr.eS, eG: tr.eG, eP: tr.eP,
      },
      hasTr: sql<boolean>`${tr.gameId} is not null`,
    })
    .from(games)
    .leftJoin(gameStatus, eq(gameStatus.gameId, games.id))
    .leftJoin(tr, eq(tr.gameId, games.id));
  return { q, tr };
}

/** Строка запроса -> Row (leftJoin отдаёт tr как объект с null-полями, если сета нет). */
function normalizeRow(r: Omit<Row, 'tr'> & { tr: Row['tr']; hasTr: boolean }): Row {
  const { hasTr, ...rest } = r;
  return { ...rest, tr: hasTr ? r.tr : null };
}

/** Игры по списку id (для ответов мутаций и карточек статистики), порядок по id. Видимость не фильтрует: вызывающий передаёт нужные id. */
export async function getGamesByIds(db: AnyDb, ids: number[]): Promise<GameItem[]> {
  if (!ids.length) return [];
  const { q } = itemsQuery(db);
  const rows = await q.where(inArray(games.id, ids)).orderBy(asc(games.id));
  return rows.map((r) => toGameItem(normalizeRow(r as never)));
}

export function emptyCounts(): StatusCounts {
  return { all: 0, playing: 0, completed: 0, dropped: 0, backlog: 0, shelved: 0, service: 0, none: 0 };
}

async function statusCounts(db: AnyDb, where: SQL | undefined): Promise<StatusCounts> {
  const rows = await db
    .select({ status: gameStatus.status, n: sql<number>`count(*)::int` })
    .from(games)
    .leftJoin(gameStatus, eq(gameStatus.gameId, games.id))
    .where(where)
    .groupBy(gameStatus.status);
  const c = emptyCounts();
  for (const r of rows) {
    c[r.status ?? 'none'] += r.n;
    c.all += r.n;
  }
  return c;
}

/** Только видимые игры (контракт 9.10). */
export const visibleGames = isNull(games.hiddenAt);

/** 14.4: забытая игра (видимая, без статуса, playtime > 0, последний запуск раньше now - 90 суток). Нужен leftJoin game_status. */
export function forgottenSql(now: Date): SQL {
  return and(
    visibleGames,
    isNull(gameStatus.status),
    gt(games.playDurationSeconds, 0),
    isNotNull(games.lastPlayedAt),
    lt(games.lastPlayedAt, forgottenCutoff(now)),
  ) as SQL;
}

/** 16.4: id игр в области, у которых эффективные жанры (1.9) пересекаются с выбранными. Нормализация в коде, поэтому фильтр по id. */
export async function genreFilterSql(db: AnyDb, keys: readonly GenreFilterKey[] | null, scope: SQL | undefined): Promise<SQL | undefined> {
  if (!keys || keys.length === 0) return undefined;
  const rows = await db.select({ id: games.id, psn: games.psnGenres, ov: games.genresOverride }).from(games).where(scope);
  const want = new Set<string>(keys);
  const ids = rows
    .filter((r) => (want.has(GENRE_NONE) && hasNoGenres(r.psn, r.ov)) || effectiveGenres(r.psn, r.ov).some((g) => want.has(g)))
    .map((r) => r.id);
  return ids.length ? inArray(games.id, ids) : sql`false`;
}

/** 16.4: сколько игр подошло бы под каждый жанровый чип (включая `none`) в области запроса без фильтра `genres`. Игра с несколькими жанрами считается в каждом. */
async function genreCountsFor(db: AnyDb, where: SQL | undefined): Promise<GenreCounts> {
  const rows = await db
    .select({ psn: games.psnGenres, ov: games.genresOverride })
    .from(games)
    .leftJoin(gameStatus, eq(gameStatus.gameId, games.id))
    .where(where);
  const out: GenreCounts = {};
  for (const r of rows) {
    for (const g of effectiveGenres(r.psn, r.ov)) out[g] = (out[g] ?? 0) + 1;
    if (hasNoGenres(r.psn, r.ov)) out[GENRE_NONE] = (out[GENRE_NONE] ?? 0) + 1;
  }
  return out;
}

async function hltbCountsFor(db: AnyDb, where: SQL | undefined): Promise<HltbCounts> {
  const [r] = await db
    .select({
      found: sql<number>`(count(*) filter (where ${hltbStatusSql('found')}))::int`,
      notFound: sql<number>`(count(*) filter (where ${hltbStatusSql('not_found')}))::int`,
      // «Ждут проверки»: без ручной длительности и не сервисы (их шаг HLTB пропускает, 20.1)
      unchecked: sql<number>`(count(*) filter (where ${hltbStatusSql('unchecked')} and ${games.durationOverrideHours} is null and ${gameStatus.status} is distinct from 'service'))::int`,
    })
    .from(games)
    .leftJoin(gameStatus, eq(gameStatus.gameId, games.id))
    .where(where);
  return { found: r?.found ?? 0, not_found: r?.notFound ?? 0, unchecked: r?.unchecked ?? 0 };
}

async function durationCounts(db: AnyDb, where: SQL | undefined): Promise<DurationCounts> {
  const out: DurationCounts = { lt10: 0, '10_30': 0, '30_60': 0, '60plus': 0, unknown: 0 };
  const rows = await db
    .select({
      lt10: sql<number>`(count(*) filter (where ${bucketSql('lt10')}))::int`,
      b1030: sql<number>`(count(*) filter (where ${bucketSql('10_30')}))::int`,
      b3060: sql<number>`(count(*) filter (where ${bucketSql('30_60')}))::int`,
      b60: sql<number>`(count(*) filter (where ${bucketSql('60plus')}))::int`,
      unknown: sql<number>`(count(*) filter (where ${bucketSql('unknown')}))::int`,
    })
    .from(games)
    .leftJoin(gameStatus, eq(gameStatus.gameId, games.id))
    .where(where);
  const r = rows[0];
  if (r) Object.assign(out, { lt10: r.lt10, '10_30': r.b1030, '30_60': r.b3060, '60plus': r.b60, unknown: r.unknown });
  return out;
}

export async function listGames(db: AnyDb, p: ListQuery, now: Date = new Date()): Promise<GamesListResponse> {
  const scope = p.hiddenOnly ? isNotNull(games.hiddenAt) : visibleGames;
  const textYear: (SQL | undefined)[] = [
    scope,
    p.q ? ilike(games.name, `%${escapeLike(p.q)}%`) : undefined,
    p.year !== null ? sql`${yearExpr} = ${p.year}` : undefined,
  ];
  const whereText = and(...textYear);
  const genreSql = await genreFilterSql(db, p.genres, whereText);
  const durationSql = durationFilterSql(p.durations);
  // 16.4: счётчики статусов и бакетов учитывают жанры; счётчики статусов ещё и длительность, бакеты нет
  const hltbSql = hltbFilterSql(p.hltb);
  const whereBase = and(whereText, genreSql, durationSql, hltbSql);
  const whereNoDuration = and(whereText, genreSql, statusFilterSql(p.statuses), p.forgottenOnly ? forgottenSql(now) : undefined, hltbSql);
  const whereAll = and(whereNoDuration, durationSql);
  const whereNoHltb = and(whereText, genreSql, statusFilterSql(p.statuses), p.forgottenOnly ? forgottenSql(now) : undefined, durationSql);

  const { q, tr } = itemsQuery(db);
  const dir = p.order === 'asc' ? sql`asc` : sql`desc`;
  const progress = sql`((${tr.eB} + ${tr.eS} + ${tr.eG} + ${tr.eP})::numeric / nullif(${tr.dB} + ${tr.dS} + ${tr.dG} + ${tr.dP}, 0))`;
  const earnedAll = sql`(${tr.eB} + ${tr.eS} + ${tr.eG} + ${tr.eP})`;
  const sortKeys: Record<ListQuery['sort'], SQL[]> = {
    last_played: [sql`${games.lastPlayedAt} ${dir} nulls last`],
    hours: [sql`${games.playDurationSeconds} ${dir}`],
    title: [sql`lower(${games.name}) ${dir}`],
    trophies_progress: [sql`${progress} ${dir} nulls last`, sql`${earnedAll} ${dir} nulls last`],
    completed_at: [sql`coalesce(${gameStatus.completedAt}, ${gameStatus.droppedAt}) ${dir} nulls last`],
    duration: [sql`${effectiveHoursSql} ${dir} nulls last`],
  };

  const [rows, totalRows, counts, yearRows, forgottenRows, dCounts, gCounts, hCounts] = await Promise.all([
    q
      .where(whereAll)
      .orderBy(...sortKeys[p.sort], asc(sql`lower(${games.name})`), asc(games.id))
      .limit(p.limit)
      .offset(p.offset),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(games)
      .leftJoin(gameStatus, eq(gameStatus.gameId, games.id))
      .where(whereAll),
    statusCounts(db, whereBase),
    db
      .selectDistinct({ y: yearExpr })
      .from(games)
      .leftJoin(gameStatus, eq(gameStatus.gameId, games.id))
      .where(scope),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(games)
      .leftJoin(gameStatus, eq(gameStatus.gameId, games.id))
      .where(forgottenSql(now)),
    durationCounts(db, whereNoDuration),
    genreCountsFor(db, and(whereText, statusFilterSql(p.statuses), p.forgottenOnly ? forgottenSql(now) : undefined, durationSql, hltbSql)),
    hltbCountsFor(db, whereNoHltb),
  ]);

  return {
    items: rows.map((r) => toGameItem(normalizeRow(r as never))),
    total: totalRows[0]?.n ?? 0,
    limit: p.limit,
    offset: p.offset,
    counts,
    years: yearRows
      .map((r) => r.y)
      .filter((y): y is number => y !== null)
      .sort((a, b) => b - a),
    forgottenCount: forgottenRows[0]?.n ?? 0,
    durationCounts: dCounts,
    genreCounts: gCounts,
    hltbCounts: hCounts,
  };
}

export async function getCollectionSummary(db: AnyDb): Promise<CollectionSummaryResponse> {
  const byRecent = [sql`${games.lastPlayedAt} desc nulls last`, asc(sql`lower(${games.name})`), asc(games.id)];
  const [gameTotals, trophyTotals, counts, playingRows, serviceRows, continueRows, profile, near] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int`, sec: sql<number>`coalesce(sum(${games.playDurationSeconds}), 0)::float8` })
      .from(games)
      .where(visibleGames),
    db
      .select({
        earned: sql<number>`(count(*) filter (where ${trophies.earned}))::int`,
        plat: sql<number>`(count(*) filter (where ${trophies.earned} and ${trophies.type} = 'platinum'))::int`,
      })
      .from(trophies)
      .where(trophySetCounted(trophies.trophySetId)),
    statusCounts(db, visibleGames),
    itemsQuery(db).q.where(and(visibleGames, eq(gameStatus.status, 'playing'))).orderBy(...byRecent).limit(PLAYING_LIMIT),
    itemsQuery(db).q.where(and(visibleGames, eq(gameStatus.status, 'service'))).orderBy(...byRecent).limit(SERVICES_LIMIT),
    itemsQuery(db)
      .q.where(and(visibleGames, isNotNull(games.lastPlayedAt), or(isNull(gameStatus.status), notInArray(gameStatus.status, ['completed', 'dropped']))))
      .orderBy(desc(games.lastPlayedAt), desc(games.id))
      .limit(CONTINUE_LIMIT),
    getPsnProfile(db),
    getNearPlatinumCandidates(db),
  ]);
  // 14.2: карточки «ближе к платине» тем же запросом GameItem (до 5 id)
  const nearItems = await getGamesByIds(db, near.map((c) => c.gameId));
  const nearById = new Map(nearItems.map((g) => [g.id, g]));
  const sec = Number(gameTotals[0]?.sec ?? 0);
  return {
    profile,
    totals: {
      games: gameTotals[0]?.n ?? 0,
      playSeconds: sec,
      hours: Math.round(sec / 360) / 10,
      trophiesEarned: trophyTotals[0]?.earned ?? 0,
      platinumEarned: trophyTotals[0]?.plat ?? 0,
    },
    counts,
    playing: playingRows.map((r) => toGameItem(normalizeRow(r as never))),
    services: serviceRows.map((r) => toGameItem(normalizeRow(r as never))),
    continue: continueRows.map((r) => toGameItem(normalizeRow(r as never))),
    nearPlatinum: near.flatMap((c) => {
      const game = nearById.get(c.gameId);
      return game ? [{ game, forecast: c.forecast }] : [];
    }),
  };
}
