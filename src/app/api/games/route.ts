import { getDb } from '@/db';
import { listGames } from '@/server/collection/query';
import { parseListQuery } from '@/server/collection/validation';
import { fail, ok } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Список игр коллекции. Сессию проверяет src/proxy.ts. Контракт 9.2.
export async function GET(req: Request) {
  const p = parseListQuery(new URL(req.url).searchParams);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    return ok(await listGames(getDb(), p.value));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
