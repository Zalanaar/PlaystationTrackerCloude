import { getDb } from '@/db';
import { fail, ok } from '@/server/http';
import { getRoadmap } from '@/server/roadmap/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Посчитанный план на лету. Сессию проверяет src/proxy.ts. Контракт 17.5.
export async function GET() {
  try {
    return ok(await getRoadmap(getDb()));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
