import { getDb } from '@/db';
import { fail, ok } from '@/server/http';
import { listExternalDislikes } from '@/server/recommend/discover-dislikes';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Скрытые внешние игры (неистёкшие отметки). Контракт 19.7.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    return ok(await listExternalDislikes(getDb(), a.user.id));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
