import { getDb } from '@/db';
import { fail, ok } from '@/server/http';
import { listExternalDislikes } from '@/server/recommend/discover-dislikes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Скрытые внешние игры (неистёкшие отметки). Контракт 19.7.
export async function GET() {
  try {
    return ok(await listExternalDislikes(getDb()));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
