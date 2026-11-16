// Пакет 7, п. 2: копия данных для офлайн-просмотра (/offline). Только чтение, только активный профиль.
// Собирается из тех же функций, что и экраны: коллекция (listGames), бэклог (порядок по умолчанию), сводка и статистика года.
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { getCollectionSummary, listGames } from '@/server/collection/query';
import { parseListQuery } from '@/server/collection/validation';
import type { GameItem } from '@/server/collection/types';
import { getStats } from '@/server/stats/query';
import { mskDate } from '@/server/stats/period';
import { OFFLINE_SNAPSHOT_VERSION, type OfflineGame, type OfflineSnapshot } from '@/shared/offline-snapshot';

const PAGE = 300;
/** Потолок игр в копии: размер записи в Cache Storage остаётся небольшим (~250 байт на игру). */
export const OFFLINE_MAX_GAMES = 1200;

function query(params: Record<string, string>) {
  const p = parseListQuery(new URLSearchParams(params));
  if (!p.ok) throw new Error(`offline snapshot query: ${p.message}`);
  return p.value;
}

async function allPages(db: AnyDb, userId: UserId, params: Record<string, string>, now: Date): Promise<GameItem[]> {
  const out: GameItem[] = [];
  for (let offset = 0; offset < OFFLINE_MAX_GAMES; offset += PAGE) {
    const r = await listGames(db, userId, query({ ...params, limit: String(PAGE), offset: String(offset) }), now);
    out.push(...r.items);
    if (r.items.length < PAGE || out.length >= r.total) break;
  }
  return out.slice(0, OFFLINE_MAX_GAMES);
}

export function toOfflineGame(g: GameItem): OfflineGame {
  return {
    id: g.id,
    title: g.title,
    coverUrl: g.coverUrl,
    platform: g.platform,
    status: g.status,
    hours: g.hours,
    lastPlayedAt: g.lastPlayedAt,
    completedAt: g.completedAt,
    trophies: g.trophies ? [g.trophies.earned, g.trophies.defined, g.trophies.platinumEarned] : null,
    durationHours: g.duration?.hours ?? null,
  };
}

export async function buildOfflineSnapshot(db: AnyDb, userId: UserId, now: Date = new Date()): Promise<OfflineSnapshot> {
  const year = mskDate(now).year;
  const [summary, games, backlog, stats] = await Promise.all([
    getCollectionSummary(db, userId),
    allPages(db, userId, { sort: 'last_played' }, now),
    allPages(db, userId, { status: 'backlog', sort: 'last_played' }, now),
    getStats(db, userId, { type: 'year', year, month: null }, now),
  ]);
  const byId = new Map(games.map((g) => [g.id, g]));
  // игра бэклога, не попавшая в общий список (потолок), всё равно нужна экрану «Бэклог»
  for (const g of backlog) if (!byId.has(g.id)) byId.set(g.id, g);
  return {
    v: OFFLINE_SNAPSHOT_VERSION,
    generatedAt: now.toISOString(),
    profileId: userId as number,
    onlineId: summary.profile?.onlineId ?? null,
    totals: {
      games: summary.totals.games, hours: summary.totals.hours, trophiesEarned: summary.totals.trophiesEarned, platinumEarned: summary.totals.platinumEarned,
    },
    counts: {
      playing: summary.counts.playing, completed: summary.counts.completed, dropped: summary.counts.dropped, backlog: summary.counts.backlog, shelved: summary.counts.shelved,
    },
    games: [...byId.values()].map(toOfflineGame),
    backlog: backlog.map((g) => g.id),
    stats: {
      year,
      completed: stats.header.completed,
      dropped: stats.header.dropped,
      hours: stats.header.hours,
      platinum: stats.header.platinum,
      hoursByMonth: stats.hours.byMonth.slice(0, 12),
      topByHours: stats.top.byHours.slice(0, 5).map((x) => ({ title: x.game.title, hours: x.hours })),
    },
  };
}
