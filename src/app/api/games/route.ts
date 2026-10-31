import { getDb } from '@/db';
import { listGames } from '@/server/collection/query';
import { parseListQuery } from '@/server/collection/validation';
import { fail, ok } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Список игр коллекции. Контракт 9.2.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const p = parseListQuery(new URL(req.url).searchParams);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    return ok(await listGames(getDb(), a.user.id, p.value));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
