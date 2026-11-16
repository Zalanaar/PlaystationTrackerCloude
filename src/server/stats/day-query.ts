// П11.1 «Дневник дня» (контракт «П11. Дневник дня»). Видимость как у «Активности» (снимки) и ленты трофеев (сеты), дубль сводится к главной карточке.
import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { effectiveGameIdSql, snapshotGameVisible, trophySetCounted } from '@/server/collection/visibility';
import type { TrophyType } from '@/server/trophies/types';
import { DAY_TROPHIES_MAX, secondsToMinutes, type DayFinished, type DayGame, type DayResponse, type DayTrophy } from './day';
import { mskDateString, mskMidnightUtc } from './period';

const { games, gameTrophySets, trophies, trophySets } = schema;

const rowsOf = <T>(res: unknown): T[] => (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as T[];
const dayRange = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return { from: mskMidnightUtc(y, m, d), to: mskMidnightUtc(y, m, d + 1) };
};

async function dayGames(db: AnyDb, userId: UserId, date: string): Promise<{ known: boolean; games: DayGame[] }> {
  // дельта к предыдущему снимку той же игры (как activity-query), только игры со снимком в этот день
  const res = await db.execute(sql`
    with d as (
      select p.game_id, p.snapshot_date,
             p.play_duration_seconds - lag(p.play_duration_seconds) over (partition by p.game_id order by p.snapshot_date) as delta
      from playtime_snapshots p
      where p.user_id = ${userId} and p.snapshot_date <= ${date}::date
        and p.game_id in (select s.game_id from playtime_snapshots s where s.user_id = ${userId} and s.snapshot_date = ${date}::date)
    )
    select coalesce(g.duplicate_of_game_id, g.id) as id, eg.name as title, eg.image_url as cover,
           sum(greatest(d.delta, 0))::int as seconds, count(d.delta)::int as deltas
    from d
    join games g on g.id = d.game_id and g.user_id = ${userId}
    left join games pg on pg.id = g.duplicate_of_game_id and pg.user_id = ${userId}
    join games eg on eg.id = coalesce(g.duplicate_of_game_id, g.id) and eg.user_id = ${userId}
    where d.snapshot_date = ${date}::date and g.hidden_at is null and pg.hidden_at is null
    group by 1, 2, 3
  `);
  const rows = rowsOf<{ id: number | string; title: string; cover: string | null; seconds: number | string; deltas: number | string }>(res);
  const known = rows.some((r) => Number(r.deltas) > 0);
  const list = rows
    .map((r) => ({ id: Number(r.id), title: r.title, coverUrl: r.cover, minutes: secondsToMinutes(Number(r.seconds)) }))
    .filter((g) => g.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes || a.title.localeCompare(b.title, 'ru'));
  return { known, games: list };
}

/** Соседние игровые дни: ближайшие даты с положительной суммой видимых дельт. */
async function neighbours(db: AnyDb, userId: UserId, date: string, today: string): Promise<{ prev: string | null; next: string | null }> {
  const res = await db.execute(sql`
    with d as (
      select p.snapshot_date,
             p.play_duration_seconds - lag(p.play_duration_seconds) over (partition by p.game_id order by p.snapshot_date) as delta,
             (g.hidden_at is null and pg.hidden_at is null) as visible
      from playtime_snapshots p
      join games g on g.id = p.game_id and g.user_id = p.user_id
      left join games pg on pg.id = g.duplicate_of_game_id and pg.user_id = g.user_id
      where p.user_id = ${userId}
    ), days as (
      select snapshot_date from d where visible group by snapshot_date having sum(greatest(delta, 0)) > 0
    )
    select (select max(snapshot_date) from days where snapshot_date < ${date}::date)::text as prev,
           (select min(snapshot_date) from days where snapshot_date > ${date}::date and snapshot_date <= ${today}::date)::text as next
  `);
  const r = rowsOf<{ prev: string | null; next: string | null }>(res)[0];
  return { prev: r?.prev ?? null, next: r?.next ?? null };
}

async function dayTrophies(db: AnyDb, userId: UserId, date: string): Promise<DayResponse['trophies']> {
  const { from, to } = dayRange(date);
  const owner = db
    .select({ setId: gameTrophySets.trophySetId, gameId: sql<number>`min(${effectiveGameIdSql('games')})`.as('day_owner_game_id') })
    .from(gameTrophySets)
    .innerJoin(games, eq(games.id, gameTrophySets.gameId))
    .where(and(eq(gameTrophySets.userId, userId), eq(games.userId, userId), snapshotGameVisible(games.id, userId)))
    .groupBy(gameTrophySets.trophySetId)
    .as('day_owner');
  const rows = await db
    .select({
      id: trophies.id, type: trophies.type, name: trophies.name, iconUrl: trophies.iconUrl,
      gameId: owner.gameId, gameTitle: games.name, setName: trophySets.name,
    })
    .from(trophies)
    .innerJoin(trophySets, and(eq(trophySets.id, trophies.trophySetId), eq(trophySets.userId, userId)))
    .leftJoin(owner, eq(owner.setId, trophies.trophySetId))
    .leftJoin(games, and(eq(games.id, owner.gameId), eq(games.userId, userId)))
    .where(and(
      eq(trophies.userId, userId), eq(trophies.earned, true), gte(trophies.earnedAt, from), lt(trophies.earnedAt, to),
      trophySetCounted(trophies.trophySetId, userId),
    ))
    .orderBy(sql`case ${trophies.type} when 'platinum' then 0 when 'gold' then 1 when 'silver' then 2 else 3 end`, asc(trophies.earnedAt), asc(trophies.id));
  const counts = { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 };
  for (const r of rows) { counts[r.type as TrophyType]++; counts.total++; }
  const items: DayTrophy[] = rows.slice(0, DAY_TROPHIES_MAX).map((r) => ({
    id: r.id, type: r.type as TrophyType, name: r.name, iconUrl: r.iconUrl,
    game: r.gameId === null ? null : { id: Number(r.gameId), title: r.gameTitle ?? r.setName },
  }));
  return { counts, items };
}

async function dayFinished(db: AnyDb, userId: UserId, date: string): Promise<DayFinished[]> {
  const r = dayRange(date);
  const from = sql`${r.from.toISOString()}::timestamptz`;
  const to = sql`${r.to.toISOString()}::timestamptz`;
  const res = await db.execute(sql`
    select g.id, g.name as title, g.image_url as cover,
           case when s.completed_at >= ${from} and s.completed_at < ${to} then 'completed' else 'dropped' end as kind
    from game_status s
    join games g on g.id = s.game_id and g.user_id = s.user_id
    where s.user_id = ${userId} and g.hidden_at is null and g.duplicate_of_game_id is null
      and ((s.completed_at >= ${from} and s.completed_at < ${to}) or (s.dropped_at >= ${from} and s.dropped_at < ${to}))
    order by g.name
  `);
  return rowsOf<{ id: number | string; title: string; cover: string | null; kind: 'completed' | 'dropped' }>(res)
    .map((r) => ({ id: Number(r.id), title: r.title, coverUrl: r.cover, kind: r.kind }));
}

export async function getDay(db: AnyDb, userId: UserId, date: string, now: Date = new Date()): Promise<DayResponse> {
  const today = mskDateString(now);
  const [g, n, t, f] = await Promise.all([dayGames(db, userId, date), neighbours(db, userId, date, today), dayTrophies(db, userId, date), dayFinished(db, userId, date)]);
  const future = date > today;
  return {
    date, today, known: !future && g.known,
    minutes: future ? 0 : g.games.reduce((s, x) => s + x.minutes, 0),
    games: future ? [] : g.games, trophies: t, finished: f, prev: n.prev, next: n.next,
  };
}
