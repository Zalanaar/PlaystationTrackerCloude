import { getDb } from '@/db';
import { fail, ok } from '@/server/http';
import { listDislikes } from '@/server/recommend/db';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Скрытые «на сейчас» (неистёкшие отметки игр из бэклога). Контракт 18.9.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    return ok(await listDislikes(getDb(), a.user.id));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
