// «Охочусь сейчас»: закрепить игру за платиной и отдельные трофеи; полученные сами снимаются.
import { and, asc, eq, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { NotFoundError } from '@/server/collection/mutations';
import { gameVisible } from '@/server/collection/visibility';
import { HUNT_TROPHY_LIMIT, type HuntGame, type HuntTrophy, type HuntsView } from '@/shared/hunts';

export { HUNT_TROPHY_LIMIT, parseHuntGameBody, parseHuntTrophyBody, type HuntsView } from '@/shared/hunts';

export class HuntLimitError extends Error {}
export class HuntConflictError extends Error {
  constructor(readonly message: string) { super(message); }
}

const { games, gameTrophySets, huntGames, huntTrophies, trophies, trophySets } = schema;

const definedSql = sql<number>`(${trophySets.definedBronze} + ${trophySets.definedSilver} + ${trophySets.definedGold} + ${trophySets.definedPlatinum})::int`;
const earnedSql = sql<number>`(${trophySets.earnedBronze} + ${trophySets.earnedSilver} + ${trophySets.earnedGold} + ${trophySets.earnedPlatinum})::int`;

async function ownVisibleGame(db: AnyDb, userId: UserId, gameId: number): Promise<{ id: number; title: string; coverUrl: string | null } | null> {
  const [row] = await db
    .select({ id: games.id, title: games.name, coverUrl: games.imageUrl })
    .from(games)
    .where(and(eq(games.id, gameId), eq(games.userId, userId), gameVisible(games.id, userId)))
    .limit(1);
  return row ?? null;
}

async function setProgress(db: AnyDb, userId: UserId, gameId: number): Promise<Pick<HuntGame, 'earned' | 'defined' | 'remaining' | 'progress' | 'platEarned'> | null> {
  const rows = await db
    .select({
      defined: definedSql,
      earned: earnedSql,
      definedPlatinum: trophySets.definedPlatinum,
      earnedPlatinum: trophySets.earnedPlatinum,
    })
    .from(trophySets)
    .innerJoin(gameTrophySets, and(eq(gameTrophySets.trophySetId, trophySets.id), eq(gameTrophySets.userId, userId)))
    .where(and(eq(gameTrophySets.gameId, gameId), eq(gameTrophySets.userId, userId), eq(trophySets.userId, userId)));
  if (!rows.length) return null;
  const plat = rows.filter((r) => r.definedPlatinum >= 1);
  const pick = (plat.length ? plat : rows).reduce((a, b) => {
    const ap = a.defined > 0 ? a.earned / a.defined : 0;
    const bp = b.defined > 0 ? b.earned / b.defined : 0;
    return bp > ap ? b : a;
  });
  const defined = pick.defined;
  const earned = pick.earned;
  const remaining = Math.max(0, defined - earned);
  return { earned, defined, remaining, progress: defined > 0 ? Math.min(100, Math.floor((earned / defined) * 100)) : 0, platEarned: pick.earnedPlatinum >= 1 };
}

export async function getHunts(db: AnyDb, userId: UserId): Promise<HuntsView> {
  const earnedPins = await db
    .select({ setId: huntTrophies.trophySetId, trophyId: huntTrophies.trophyId })
    .from(huntTrophies)
    .innerJoin(trophies, and(eq(trophies.userId, huntTrophies.userId), eq(trophies.trophySetId, huntTrophies.trophySetId), eq(trophies.trophyId, huntTrophies.trophyId)))
    .where(and(eq(huntTrophies.userId, userId), eq(trophies.earned, true)));
  for (const p of earnedPins) {
    await db.delete(huntTrophies).where(and(eq(huntTrophies.userId, userId), eq(huntTrophies.trophySetId, p.setId), eq(huntTrophies.trophyId, p.trophyId)));
  }

  const [hg] = await db.select({ gameId: huntGames.gameId }).from(huntGames).where(eq(huntGames.userId, userId)).limit(1);
  let game: HuntGame | null = null;
  if (hg) {
    const g = await ownVisibleGame(db, userId, hg.gameId);
    const prog = g ? await setProgress(db, userId, g.id) : null;
    if (!g || !prog || prog.platEarned) {
      await db.delete(huntGames).where(eq(huntGames.userId, userId));
    } else {
      game = { id: g.id, title: g.title, coverUrl: g.coverUrl, ...prog };
    }
  }

  const rows = await db
    .select({
      gameId: huntTrophies.gameId,
      setId: huntTrophies.trophySetId,
      trophyId: huntTrophies.trophyId,
      gameTitle: games.name,
      coverUrl: games.imageUrl,
      name: trophies.name,
      iconUrl: trophies.iconUrl,
      type: trophies.type,
      hidden: trophies.hidden,
      earned: trophies.earned,
      createdAt: huntTrophies.createdAt,
    })
    .from(huntTrophies)
    .innerJoin(games, and(eq(games.id, huntTrophies.gameId), eq(games.userId, userId)))
    .innerJoin(trophies, and(eq(trophies.userId, userId), eq(trophies.trophySetId, huntTrophies.trophySetId), eq(trophies.trophyId, huntTrophies.trophyId)))
    .where(and(eq(huntTrophies.userId, userId), gameVisible(games.id, userId), eq(trophies.earned, false)))
    .orderBy(asc(huntTrophies.createdAt));

  const list: HuntTrophy[] = rows.map((r) => ({
    gameId: r.gameId,
    setId: r.setId,
    trophyId: r.trophyId,
    gameTitle: r.gameTitle,
    coverUrl: r.coverUrl,
    name: r.name,
    iconUrl: r.iconUrl,
    type: r.type,
    hidden: r.hidden,
    earned: r.earned,
  }));
  return { game, trophies: list };
}

export async function setHuntGame(db: AnyDb, userId: UserId, gameId: number | null): Promise<HuntsView> {
  if (gameId === null) {
    await db.delete(huntGames).where(eq(huntGames.userId, userId));
    return getHunts(db, userId);
  }
  const g = await ownVisibleGame(db, userId, gameId);
  if (!g) throw new NotFoundError();
  const prog = await setProgress(db, userId, gameId);
  if (!prog) throw new HuntConflictError('У этой игры ещё нет трофеев.');
  if (prog.platEarned) throw new HuntConflictError('Платина уже получена.');
  const now = new Date();
  await db.insert(huntGames).values({ userId, gameId, createdAt: now })
    .onConflictDoUpdate({ target: huntGames.userId, set: { gameId, createdAt: now } });
  return getHunts(db, userId);
}

export async function setHuntTrophy(db: AnyDb, userId: UserId, gameId: number, setId: number, trophyId: number, on: boolean): Promise<HuntsView> {
  const g = await ownVisibleGame(db, userId, gameId);
  if (!g) throw new NotFoundError();
  const [link] = await db
    .select({ trophySetId: gameTrophySets.trophySetId })
    .from(gameTrophySets)
    .where(and(eq(gameTrophySets.userId, userId), eq(gameTrophySets.gameId, gameId), eq(gameTrophySets.trophySetId, setId)))
    .limit(1);
  if (!link) throw new NotFoundError();
  const [tr] = await db
    .select({ earned: trophies.earned })
    .from(trophies)
    .where(and(eq(trophies.userId, userId), eq(trophies.trophySetId, setId), eq(trophies.trophyId, trophyId)))
    .limit(1);
  if (!tr) throw new NotFoundError();
  if (!on) {
    await db.delete(huntTrophies).where(and(eq(huntTrophies.userId, userId), eq(huntTrophies.trophySetId, setId), eq(huntTrophies.trophyId, trophyId)));
    return getHunts(db, userId);
  }
  if (tr.earned) throw new HuntConflictError('Этот трофей уже получен.');
  const [exists] = await db
    .select({ trophyId: huntTrophies.trophyId })
    .from(huntTrophies)
    .where(and(eq(huntTrophies.userId, userId), eq(huntTrophies.trophySetId, setId), eq(huntTrophies.trophyId, trophyId)))
    .limit(1);
  if (!exists) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(huntTrophies).where(eq(huntTrophies.userId, userId));
    if (n >= HUNT_TROPHY_LIMIT) throw new HuntLimitError();
    await db.insert(huntTrophies).values({ userId, gameId, trophySetId: setId, trophyId, createdAt: new Date() });
  }
  return getHunts(db, userId);
}
