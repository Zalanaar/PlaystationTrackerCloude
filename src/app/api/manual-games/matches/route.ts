import { getDb } from '@/db';
import { requireUser } from '@/server/auth/require-user';
import { fail, ok } from '@/server/http';
import { listMatches } from '@/server/manual/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Карточки «Это та игра?» для «Входящих»: записи «не куплено» с неуверенным совпадением. Контракт Фазы 43, 43.5.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    return ok({ matches: await listMatches(getDb(), a.user.id) });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
