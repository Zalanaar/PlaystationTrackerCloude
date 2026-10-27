import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './schema';

/** Любая БД Drizzle со схемой проекта: Neon в рантайме, PGlite в тестах, а также транзакция. */
export type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>;
