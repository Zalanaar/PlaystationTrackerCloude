// Видимость скрытых игр (контракт 9.10). Условия SQL, общие для коллекции, статистики и Итогов.
import { type AnyColumn, type SQL, sql } from 'drizzle-orm';

/** Колонка с id игры указывает на видимую (не скрытую) игру. */
export const gameVisible = (gameIdCol: AnyColumn): SQL =>
  sql`${gameIdCol} in (select "id" from "games" where "hidden_at" is null)`;

/**
 * Трофейный сет учитывается: у него есть хотя бы одна видимая игра или он сирота (нет связей).
 * Не учитываются только сеты, все связанные игры которых скрыты.
 */
export const trophySetCounted = (setIdCol: AnyColumn): SQL =>
  sql`${setIdCol} not in (select gts."trophy_set_id" from "game_trophy_sets" gts join "games" g on g."id" = gts."game_id" group by gts."trophy_set_id" having bool_and(g."hidden_at" is not null))`;
