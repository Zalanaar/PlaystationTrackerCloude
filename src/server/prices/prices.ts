// П13.3: цена покупки игры и «стоимость часа» (контракт «П13.3»). Цена — целые рубли, 0 = бесплатно.
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { visibleGameRow } from '@/server/collection/visibility';
import { MIN_HOURS, PRICE_MAX, perHour } from '@/shared/price';

const { games, gamePrices } = schema;

export { PRICE_MAX, MIN_HOURS, perHour };
const TOP = 3;

export class PriceError extends Error {
  constructor(readonly code: 'game_not_found') { super(code); }
}

/** Цена из тела запроса: целое 0..1 000 000 или null (убрать); иначе undefined (400). */
export function parsePrice(v: unknown): number | null | undefined {
  if (v === null) return null;
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= PRICE_MAX ? v : undefined;
}

/** Часы игры с дублями (как у карточки), секунды. */
const gameSecondsSql = sql<number>`("games"."play_duration_seconds" + coalesce((select sum(d."play_duration_seconds") from "games" d where d."user_id" = "games"."user_id" and d."duplicate_of_game_id" = "games"."id"), 0))::int`;

const hours1 = (seconds: number) => Math.round((seconds / 3600) * 10) / 10;
async function assertVisible(db: AnyDb, userId: UserId, gameId: number): Promise<void> {
  const [g] = await db.select({ id: games.id }).from(games).where(and(eq(games.userId, userId), eq(games.id, gameId), visibleGameRow())).limit(1);
  if (!g) throw new PriceError('game_not_found');
}

export async function getGamePrice(db: AnyDb, userId: UserId, gameId: number): Promise<{ price: number | null }> {
  await assertVisible(db, userId, gameId);
  const [r] = await db.select({ price: gamePrices.price }).from(gamePrices).where(and(eq(gamePrices.userId, userId), eq(gamePrices.gameId, gameId))).limit(1);
  return { price: r?.price ?? null };
}

export async function setGamePrice(db: AnyDb, userId: UserId, gameId: number, price: number | null): Promise<{ price: number | null }> {
  await assertVisible(db, userId, gameId);
  if (price === null) {
    await db.delete(gamePrices).where(and(eq(gamePrices.userId, userId), eq(gamePrices.gameId, gameId)));
    return { price: null };
  }
  await db.insert(gamePrices).values({ userId, gameId, price })
    .onConflictDoUpdate({ target: gamePrices.gameId, set: { price, updatedAt: sql`now()` } });
  return { price };
}

export type CostGame = { id: number; title: string; price: number; hours: number; perHour: number | null };
export type CostStats = {
  /** игр с ценой (видимые) */
  priced: number;
  /** сумма цен, ₽ */
  total: number;
  /** часы в играх с ценой */
  hours: number;
  /** общая стоимость часа: сумма цен / сумма часов; null — меньше часа на всё */
  perHour: number | null;
  /** самые выгодные (меньше всего ₽/ч, от часа игры) */
  best: CostGame[];
  /** самые дорогие за час */
  worst: CostGame[];
  /** куплены, но сыграно меньше часа: сколько и на какую сумму */
  idle: { count: number; total: number };
};

export function buildCostStats(rows: readonly { id: number; title: string; price: number; seconds: number }[]): CostStats {
  const list: CostGame[] = rows.map((r) => {
    const hours = hours1(r.seconds);
    return { id: r.id, title: r.title, price: r.price, hours, perHour: perHour(r.price, hours) };
  });
  const total = list.reduce((a, g) => a + g.price, 0);
  const hours = Math.round(list.reduce((a, g) => a + g.hours, 0) * 10) / 10;
  const played = list.filter((g) => g.perHour !== null);
  const byPh = [...played].sort((a, b) => (a.perHour as number) - (b.perHour as number) || b.hours - a.hours || a.id - b.id);
  const worst = [...played].filter((g) => g.price > 0).sort((a, b) => (b.perHour as number) - (a.perHour as number) || a.id - b.id).slice(0, TOP);
  const idle = list.filter((g) => g.perHour === null);
  return {
    priced: list.length,
    total,
    hours,
    perHour: perHour(total, hours),
    best: byPh.slice(0, TOP),
    worst: worst.filter((g) => !byPh.slice(0, TOP).some((b) => b.id === g.id)),
    idle: { count: idle.length, total: idle.reduce((a, g) => a + g.price, 0) },
  };
}

export async function getCostStats(db: AnyDb, userId: UserId): Promise<CostStats> {
  const rows = await db
    .select({ id: games.id, title: games.name, price: gamePrices.price, seconds: gameSecondsSql })
    .from(gamePrices)
    .innerJoin(games, and(eq(games.userId, gamePrices.userId), eq(games.id, gamePrices.gameId)))
    .where(and(eq(gamePrices.userId, userId), visibleGameRow()));
  return buildCostStats(rows.map((r) => ({ ...r, seconds: Number(r.seconds) })));
}
