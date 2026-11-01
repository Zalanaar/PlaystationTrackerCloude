import { getDb } from '@/db';
import { requireUser } from '@/server/auth/require-user';
import { fail, ok } from '@/server/http';
import { getStatusHints } from '@/server/sync/status-hints-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Подсказки смены статуса: очередь «Проверить». Только предлагает, статус не меняет. Контракт 28.4.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    return ok(await getStatusHints(getDb(), a.user.id));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
