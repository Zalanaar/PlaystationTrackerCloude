import { getDb } from '@/db';
import { fail, ok } from '@/server/http';
import { getSyncStatus } from '@/server/sync/status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Сессию проверяет src/proxy.ts. К PSN не обращается. Контракт 8.4.
export async function GET() {
  try {
    return ok(await getSyncStatus(getDb()));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
