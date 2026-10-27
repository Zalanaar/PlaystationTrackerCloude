import { Pool } from '@neondatabase/serverless';
import { drizzle, type NeonDatabase } from 'drizzle-orm/neon-serverless';
import * as schema from './schema';

export type Db = NeonDatabase<typeof schema>;

let cached: Db | undefined;

/** Ленивое подключение: сборка и тесты не требуют DATABASE_URL. Pooled-URL Neon. */
export function getDb(): Db {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  cached = drizzle(new Pool({ connectionString: url }), { schema });
  return cached;
}

export { schema };
