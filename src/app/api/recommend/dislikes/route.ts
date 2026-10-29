import { getDb } from '@/db';
import { fail, ok } from '@/server/http';
import { listDislikes } from '@/server/recommend/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Скрытые «на сейчас» (неистёкшие отметки игр из бэклога). Контракт 18.9.
export async function GET() {
  try {
    return ok(await listDislikes(getDb()));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
