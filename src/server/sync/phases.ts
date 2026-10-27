// Фазы синка (контракт 8.1). Каждая единица работы = транзакция; курсор и счётчики пишутся в ней же.
// Только апсерты и вставки ON CONFLICT: повторный прогон даёт те же данные. Удалений нет.
import { and, asc, count, eq, gte, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { PsnGame, PsnTrophyDef, PsnTrophyEarned, PsnTrophySet } from '@/server/psn/types';
import type { PhaseFn, RunContext } from './context';
import { matchOrphansByName } from './link';

const { games, playtimeSnapshots, trophySets, gameTrophySets, trophies } = schema;

const GAMES_CHUNK = 100;
const LINK_BATCH = 5;
const RECHECK_MS = 7 * 86400_000;
const RELOAD_MISMATCH_MS = 86400_000;

const chunks = <T>(a: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
};
/** Ссылка на строку из VALUES конфликта: excluded."col". */
const ex = (col: string) => sql.raw(`excluded."${col}"`);

// ---------- games ----------
export const gamesPhase: PhaseFn = async (ctx, psn) => {
  const { games: list } = await psn.getPlayedGames();
  const now = ctx.now();
  if (list.length === 0) ctx.warn('empty_games_list', 'PSN вернул пустой список игр, снимки не записаны.');

  await ctx.db.transaction(async (tx) => {
    const before = new Map(
      (await tx.select({ titleId: games.titleId, d: games.playDurationSeconds }).from(games)).map((r) => [r.titleId, r.d] as const),
    );
    let upserted = 0;
    let snapshots = 0;
    for (const part of chunks(list, GAMES_CHUNK)) {
      const rows = await tx
        .insert(games)
        .values(part.map((g) => gameRow(g, now)))
        .onConflictDoUpdate({
          target: games.titleId,
          set: {
            conceptId: ex('concept_id'),
            name: ex('name'),
            category: ex('category'),
            imageUrl: sql`coalesce(${ex('image_url')}, ${games.imageUrl})`,
            psnGenres: ex('psn_genres'),
            playDurationSeconds: ex('play_duration_seconds'),
            playCount: ex('play_count'),
            firstPlayedAt: sql`coalesce(${ex('first_played_at')}, ${games.firstPlayedAt})`,
            lastPlayedAt: sql`coalesce(${ex('last_played_at')}, ${games.lastPlayedAt})`,
            lastSeenAt: ex('last_seen_at'),
            updatedAt: ex('updated_at'),
          },
        })
        .returning({ id: games.id, titleId: games.titleId });
      upserted += rows.length;

      const byTitle = new Map(part.map((g) => [g.titleId, g] as const));
      const snaps = rows.flatMap((r) => {
        const g = byTitle.get(r.titleId);
        return g
          ? [
              {
                gameId: r.id,
                snapshotDate: ctx.run.snapshotDate,
                playDurationSeconds: g.playDurationSeconds,
                playCount: g.playCount,
                lastPlayedAt: g.lastPlayedAt,
                capturedAt: now,
                syncRunId: ctx.run.id,
              },
            ]
          : [];
      });
      if (snaps.length) {
        await tx
          .insert(playtimeSnapshots)
          .values(snaps)
          .onConflictDoUpdate({
            target: [playtimeSnapshots.gameId, playtimeSnapshots.snapshotDate],
            set: {
              playDurationSeconds: ex('play_duration_seconds'),
              playCount: ex('play_count'),
              lastPlayedAt: ex('last_played_at'),
              capturedAt: ex('captured_at'),
              syncRunId: ex('sync_run_id'),
            },
          });
        snapshots += snaps.length;
      }
    }
    for (const g of list) {
      const prev = before.get(g.titleId);
      if (prev !== undefined && g.playDurationSeconds < prev) {
        ctx.warn('playtime_decreased', `${g.titleId}: время уменьшилось с ${prev} до ${g.playDurationSeconds} с`);
      }
    }
    ctx.counters.gamesSeen = list.length;
    ctx.counters.gamesUpserted = upserted;
    ctx.counters.snapshotsWritten = snapshots;
    ctx.cursor = { ...ctx.cursor, phase: 'trophy_sets', progress: undefined };
    await ctx.save(tx);
  });
  ctx.units++;
  return 'done';
};

function gameRow(g: PsnGame, now: Date): typeof games.$inferInsert {
  return {
    titleId: g.titleId,
    conceptId: g.conceptId,
    name: g.name,
    category: g.category,
    imageUrl: g.imageUrl,
    psnGenres: g.genres,
    playDurationSeconds: g.playDurationSeconds,
    playCount: g.playCount,
    firstPlayedAt: g.firstPlayedAt,
    lastPlayedAt: g.lastPlayedAt,
    lastSeenAt: now,
    updatedAt: now,
  };
}

// ---------- trophy sets ----------
/** Апсерт сетов; возвращает npCommunicationId -> id. Не трогает trophies_synced_at. */
async function upsertSets(db: AnyDb, sets: PsnTrophySet[], now: Date): Promise<Map<string, number>> {
  const uniq = [...new Map(sets.map((s) => [s.npCommunicationId, s] as const)).values()];
  const ids = new Map<string, number>();
  for (const part of chunks(uniq, 100)) {
    const rows = await db
      .insert(trophySets)
      .values(
        part.map((s) => ({
          npCommunicationId: s.npCommunicationId,
          npServiceName: s.npServiceName,
          name: s.name,
          platform: s.platform,
          iconUrl: s.iconUrl,
          definedBronze: s.defined.bronze,
          definedSilver: s.defined.silver,
          definedGold: s.defined.gold,
          definedPlatinum: s.defined.platinum,
          earnedBronze: s.earned.bronze,
          earnedSilver: s.earned.silver,
          earnedGold: s.earned.gold,
          earnedPlatinum: s.earned.platinum,
          progress: s.progress,
          lastUpdatedAt: s.lastUpdatedAt,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: trophySets.npCommunicationId,
        set: {
          npServiceName: ex('np_service_name'),
          name: ex('name'),
          platform: ex('platform'),
          iconUrl: sql`coalesce(${ex('icon_url')}, ${trophySets.iconUrl})`,
          definedBronze: ex('defined_bronze'),
          definedSilver: ex('defined_silver'),
          definedGold: ex('defined_gold'),
          definedPlatinum: ex('defined_platinum'),
          earnedBronze: ex('earned_bronze'),
          earnedSilver: ex('earned_silver'),
          earnedGold: ex('earned_gold'),
          earnedPlatinum: ex('earned_platinum'),
          progress: ex('progress'),
          lastUpdatedAt: sql`coalesce(${ex('last_updated_at')}, ${trophySets.lastUpdatedAt})`,
          updatedAt: ex('updated_at'),
        },
      })
      .returning({ id: trophySets.id, np: trophySets.npCommunicationId });
    for (const r of rows) ids.set(r.np, r.id);
  }
  return ids;
}

export const trophySetsPhase: PhaseFn = async (ctx, psn) => {
  const sets = await psn.getTrophySets();
  await ctx.db.transaction(async (tx) => {
    await upsertSets(tx, sets, ctx.now());
    ctx.cursor = { ...ctx.cursor, phase: 'trophy_link', progress: undefined };
    await ctx.save(tx);
  });
  ctx.units++;
  return 'done';
};

// ---------- trophy link ----------
function pendingGamesWhere(ctx: RunContext) {
  const weekAgo = new Date(ctx.now().getTime() - RECHECK_MS);
  return and(
    gte(games.lastSeenAt, ctx.run.startedAt),
    or(
      isNull(games.trophyCheckedAt),
      and(
        lt(games.trophyCheckedAt, weekAgo),
        // автосвязь по concept не отменяет перепроверку: у игры может появиться собственный сет по titleId
        sql`not exists (select 1 from game_trophy_sets l where l.game_id = ${games.id} and l.source in ('title_id', 'manual'))`,
      ),
    ),
  );
}

export const trophyLinkPhase: PhaseFn = async (ctx, psn) => {
  const where = pendingGamesWhere(ctx);
  const [{ n: pending }] = await ctx.db.select({ n: count() }).from(games).where(where);
  const done0 = ctx.cursor.progress?.done ?? 0;
  const total = done0 + pending;
  let done = done0;
  ctx.cursor = { ...ctx.cursor, progress: { done, total } };

  for (;;) {
    const batch = await ctx.db.select({ id: games.id, titleId: games.titleId }).from(games).where(where).orderBy(asc(games.id)).limit(LINK_BATCH);
    if (batch.length === 0) break;
    if (ctx.outOfTime()) return 'timeout';

    const found = await psn.findTrophySets(batch.map((g) => g.titleId));
    const now = ctx.now();
    await ctx.db.transaction(async (tx) => {
      const idByNp = await upsertSets(tx, [...found.values()].flat(), now);
      const links = batch.flatMap((g) =>
        (found.get(g.titleId) ?? []).flatMap((s) => {
          const setId = idByNp.get(s.npCommunicationId);
          return setId === undefined ? [] : [{ gameId: g.id, trophySetId: setId, source: 'title_id' as const }];
        }),
      );
      if (links.length) await tx.insert(gameTrophySets).values(links).onConflictDoNothing();
      await tx.update(games).set({ trophyCheckedAt: now }).where(inArray(games.id, batch.map((g) => g.id)));
      done += batch.length;
      ctx.cursor = { ...ctx.cursor, progress: { done, total: Math.max(total, done) } };
      await ctx.save(tx);
    });
    ctx.units++;
  }

  await ctx.db.transaction(async (tx) => {
    await linkByConcept(tx, ctx);
    await linkOrphansByName(tx, ctx);
    ctx.cursor = { ...ctx.cursor, phase: 'trophies', progress: undefined };
    await ctx.save(tx);
  });
  return 'done';
};

/** Игра без связей наследует сеты игр с тем же concept_id (другая платформенная версия). */
async function linkByConcept(db: AnyDb, ctx: RunContext): Promise<void> {
  await db.execute(sql`
    insert into game_trophy_sets (game_id, trophy_set_id, source)
    select distinct g.id, l.trophy_set_id, 'concept'::trophy_set_link_source
    from games g
    join games sib on sib.concept_id = g.concept_id and sib.id <> g.id
    join game_trophy_sets l on l.game_id = sib.id
    where g.concept_id is not null
      and g.last_seen_at >= ${ctx.run.startedAt.toISOString()}::timestamptz
      and not exists (select 1 from game_trophy_sets x where x.game_id = g.id)
    on conflict do nothing`);
}

/** Сеты-сироты связываются с игрой без связей только при однозначном совпадении нормализованного имени. */
async function linkOrphansByName(db: AnyDb, ctx: RunContext): Promise<void> {
  const orphans = await db
    .select({ setId: trophySets.id, name: trophySets.name })
    .from(trophySets)
    .where(sql`not exists (select 1 from game_trophy_sets l where l.trophy_set_id = ${trophySets.id})`);
  if (orphans.length === 0) return;
  const free = await db
    .select({ gameId: games.id, name: games.name })
    .from(games)
    .where(sql`not exists (select 1 from game_trophy_sets l where l.game_id = ${games.id})`);
  const { links, ambiguous } = matchOrphansByName(orphans, free);
  if (links.length) {
    await db.insert(gameTrophySets).values(links.map((l) => ({ gameId: l.gameId, trophySetId: l.setId, source: 'name' as const }))).onConflictDoNothing();
  }
  for (const id of ambiguous) ctx.warn('name_link_ambiguous', `Сет #${id}: имя совпало с несколькими играми, связь не создана.`);
}

// ---------- trophies ----------
const definedSum = sql`(${trophySets.definedBronze} + ${trophySets.definedSilver} + ${trophySets.definedGold} + ${trophySets.definedPlatinum})`;
const earnedSum = sql`(${trophySets.earnedBronze} + ${trophySets.earnedSilver} + ${trophySets.earnedGold} + ${trophySets.earnedPlatinum})`;
const localRows = sql`(select count(*) from trophies t where t.trophy_set_id = ${trophySets.id})`;
const localEarned = sql`(select count(*) from trophies t where t.trophy_set_id = ${trophySets.id} and t.earned)`;

function staleSetsWhere(ctx: RunContext, skipIds: number[]) {
  const dayAgo = new Date(ctx.now().getTime() - RELOAD_MISMATCH_MS);
  return and(
    or(
      isNull(trophySets.trophiesSyncedAt),
      sql`${trophySets.lastUpdatedAt} > ${trophySets.trophiesSyncedAt}`,
      and(lt(trophySets.trophiesSyncedAt, dayAgo), or(sql`${localRows} <> ${definedSum}`, sql`${localEarned} <> ${earnedSum}`)),
    ),
    skipIds.length ? notInArray(trophySets.id, skipIds) : undefined,
  );
}

export const trophiesPhase: PhaseFn = async (ctx, psn) => {
  const processed: number[] = [];
  const [{ n: pending }] = await ctx.db.select({ n: count() }).from(trophySets).where(staleSetsWhere(ctx, processed));
  const done0 = ctx.cursor.progress?.done ?? 0;
  const total = done0 + pending;
  let done = done0;
  ctx.cursor = { ...ctx.cursor, progress: { done, total } };

  for (;;) {
    const [set] = await ctx.db
      .select({
        id: trophySets.id,
        np: trophySets.npCommunicationId,
        service: trophySets.npServiceName,
        defined: sql<number>`${definedSum}::int`,
        have: sql<number>`${localRows}::int`,
      })
      .from(trophySets)
      .where(staleSetsWhere(ctx, processed))
      .orderBy(asc(trophySets.id))
      .limit(1);
    if (!set) break;
    if (ctx.outOfTime()) return 'timeout';
    processed.push(set.id);

    const ref = { npCommunicationId: set.np, npServiceName: set.service === 'trophy2' ? ('trophy2' as const) : ('trophy' as const) };
    const earned = await psn.getEarnedTrophies(ref);
    const defs = set.have < set.defined || set.have === 0 ? await psn.getTrophyDefinitions(ref) : [];
    const rows = mergeTrophies(set.id, earned, defs, ctx.now());

    if (rows.length === 0 && set.defined > 0) {
      // пустой ответ при непустом сете: не считаем загруженным, чтобы не потерять данные
      ctx.warn('empty_trophy_list', `Сет ${set.np}: PSN вернул пустой список трофеев.`);
      continue;
    }
    await ctx.db.transaction(async (tx) => {
      for (const part of chunks(rows, 200)) {
        await tx
          .insert(trophies)
          .values(part)
          .onConflictDoUpdate({
            target: [trophies.trophySetId, trophies.trophyId],
            set: {
              type: ex('type'),
              hidden: ex('hidden'),
              name: sql`coalesce(${ex('name')}, ${trophies.name})`,
              detail: sql`coalesce(${ex('detail')}, ${trophies.detail})`,
              iconUrl: sql`coalesce(${ex('icon_url')}, ${trophies.iconUrl})`,
              rarity: sql`coalesce(${ex('rarity')}, ${trophies.rarity})`,
              earnedRate: sql`coalesce(${ex('earned_rate')}, ${trophies.earnedRate})`,
              // полученный трофей не откатывается (контракт 1.5)
              earned: sql`${trophies.earned} or ${ex('earned')}`,
              earnedAt: sql`case when ${ex('earned')} then coalesce(${ex('earned_at')}, ${trophies.earnedAt}) else ${trophies.earnedAt} end`,
              updatedAt: ex('updated_at'),
            },
          });
      }
      const now = ctx.now();
      await tx.update(trophySets).set({ trophiesSyncedAt: now, updatedAt: now }).where(eq(trophySets.id, set.id));
      ctx.counters.trophySetsSynced += 1;
      ctx.counters.trophiesUpserted += rows.length;
      done += 1;
      ctx.cursor = { ...ctx.cursor, progress: { done, total: Math.max(total, done) } };
      await ctx.save(tx);
    });
    ctx.units++;
  }
  return 'done';
};

export function mergeTrophies(setId: number, earned: PsnTrophyEarned[], defs: PsnTrophyDef[], now: Date): Array<typeof trophies.$inferInsert> {
  const defById = new Map(defs.map((d) => [d.trophyId, d] as const));
  const out = new Map<number, typeof trophies.$inferInsert>();
  const base = (id: number) => out.get(id);
  for (const e of earned) {
    const d = defById.get(e.trophyId);
    out.set(e.trophyId, {
      trophySetId: setId,
      trophyId: e.trophyId,
      type: e.type,
      name: d?.name ?? null,
      detail: d?.detail ?? null,
      iconUrl: d?.iconUrl ?? null,
      hidden: e.hidden || (d?.hidden ?? false),
      earned: e.earned,
      earnedAt: e.earned ? e.earnedAt : null,
      rarity: e.rarity,
      earnedRate: e.earnedRate,
      updatedAt: now,
    });
  }
  for (const d of defs) {
    if (base(d.trophyId)) continue;
    out.set(d.trophyId, {
      trophySetId: setId,
      trophyId: d.trophyId,
      type: d.type,
      name: d.name,
      detail: d.detail,
      iconUrl: d.iconUrl,
      hidden: d.hidden,
      earned: false,
      earnedAt: null,
      updatedAt: now,
    });
  }
  return [...out.values()];
}

