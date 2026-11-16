import { getDb } from '@/db';
import { requireUser } from '@/server/auth/require-user';
import { fail, ok } from '@/server/http';
import { buildOfflineSnapshot } from '@/server/offline/snapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Пакет 7, п. 2: копия коллекции, бэклога и статистики года для офлайн-просмотра. no-store: браузер хранит её только в
// Cache Storage (кэш «ps-data», стирается при выходе и смене профиля), HTTP-кэш не участвует.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    return ok(await buildOfflineSnapshot(getDb(), a.user.id));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
