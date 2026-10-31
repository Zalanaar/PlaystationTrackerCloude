// Видимость скрытых игр (контракт 9.10). Условия SQL, общие для коллекции, статистики и Итогов.
// Подзапросы несут user_id (N-1, 22.12): не сканируют игры других пользователей и не зависят от глобальности id.
import { type AnyColumn, type SQL, sql } from 'drizzle-orm';

/** Колонка с id игры указывает на видимую (не скрытую) игру пользователя. */
export const gameVisible = (gameIdCol: AnyColumn, userId: number): SQL =>
  sql`${gameIdCol} in (select "id" from "games" where "user_id" = ${userId} and "hidden_at" is null)`;

/**
 * Трофейный сет учитывается: у него есть хотя бы одна видимая игра или он сирота (нет связей).
 * Не учитываются только сеты, все связанные игры которых скрыты.
 */
export const trophySetCounted = (setIdCol: AnyColumn, userId: number): SQL =>
  sql`${setIdCol} not in (select gts."trophy_set_id" from "game_trophy_sets" gts join "games" g on g."id" = gts."game_id" and g."user_id" = ${userId} where gts."user_id" = ${userId} group by gts."trophy_set_id" having bool_and(g."hidden_at" is not null))`;
