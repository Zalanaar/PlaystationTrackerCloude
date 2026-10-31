// Видимость игр: скрытые (контракт 9.10) и дубли (контракт 25). Условия SQL, общие для коллекции, статистики и Итогов.
// Подзапросы несут user_id (N-1, 22.12): не сканируют игры других пользователей и не зависят от глобальности id.
import { type AnyColumn, type SQL, and, isNull, sql } from 'drizzle-orm';
import { schema } from '@/db';

/** Строка games видима как отдельная карточка: не скрыта и не дубль (25.3). Для запросов, где games уже в FROM. */
export const visibleGameRow = (): SQL => and(isNull(schema.games.hiddenAt), isNull(schema.games.duplicateOfGameId)) as SQL;

/** Колонка с id игры указывает на видимую игру пользователя: не скрытую и не дубль. */
export const gameVisible = (gameIdCol: AnyColumn, userId: number): SQL =>
  sql`${gameIdCol} in (select "id" from "games" where "user_id" = ${userId} and "hidden_at" is null and "duplicate_of_game_id" is null)`;

/**
 * Для снимков часов (25.3): снимки дублей остаются в расчёте (их часы входят в главную), нужны только игры не скрытые
 * и, для дубля, с не скрытой главной.
 */
export const snapshotGameVisible = (gameIdCol: AnyColumn, userId: number): SQL =>
  sql`${gameIdCol} in (select g."id" from "games" g where g."user_id" = ${userId} and g."hidden_at" is null and (g."duplicate_of_game_id" is null or g."duplicate_of_game_id" not in (select p."id" from "games" p where p."user_id" = ${userId} and p."hidden_at" is not null)))`;

/**
 * Трофейный сет учитывается: у него есть хотя бы одна видимая игра группы или он сирота (нет связей).
 * Дубль не делает сет невидимым (сет привязан к нескольким версиям и считается один раз, 25.3).
 * Не учитываются только сеты, все связанные игры которых скрыты (сама игра или главная дубля).
 */
export const trophySetCounted = (setIdCol: AnyColumn, userId: number): SQL =>
  sql`${setIdCol} not in (select gts."trophy_set_id" from "game_trophy_sets" gts join "games" g on g."id" = gts."game_id" and g."user_id" = ${userId} left join "games" p on p."id" = g."duplicate_of_game_id" and p."user_id" = ${userId} where gts."user_id" = ${userId} group by gts."trophy_set_id" having bool_and(g."hidden_at" is not null or p."hidden_at" is not null))`;

/** SQL-выражение: id главной карточки игры (сама игра или её главная). Для таблицы games под алиасом/именем `g`. */
export const effectiveGameIdSql = (alias: string): SQL => sql.raw(`coalesce("${alias}"."duplicate_of_game_id", "${alias}"."id")`);
