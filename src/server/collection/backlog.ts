// Фаза 48 (п. 11): единое число «бэклог» для всех экранов.
// Бэклог = видимые игры библиотеки со статусом backlog: скрытые (в том числе скрытые PS PC) и дубли не считаются.
// Записи «вручную» (Фаза 43), «Не предлагать» (Подскажи) и «Убрать из плана» (План) в это число не входят и не вычитаются:
// экраны показывают их отдельной подписью от этого числа.
import { type SQL, and, eq, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { visibleGameRow } from './visibility';

const { games, gameStatus } = schema;

/** Условие «игра в бэклоге» для запросов, где games и game_status (по user_id и game_id) уже в FROM. */
export const backlogGameWhere = (): SQL => and(visibleGameRow(), eq(gameStatus.status, 'backlog')) as SQL;

/** Сколько игр в бэклоге (то же число, что `counts.backlog` сводки коллекции). */
export async function countBacklog(db: AnyDb, userId: UserId): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(games)
    .innerJoin(gameStatus, and(eq(gameStatus.gameId, games.id), eq(gameStatus.userId, userId)))
    .where(and(eq(games.userId, userId), backlogGameWhere()));
  return rows[0]?.n ?? 0;
}
