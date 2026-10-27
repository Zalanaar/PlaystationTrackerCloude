import { getDb } from '@/db';
import { readJsonBody } from '@/server/collection/http';
import { getGamesByIds } from '@/server/collection/query';
import { parseBulkBody } from '@/server/collection/validation';
import { fail, ok } from '@/server/http';
import { BulkMissingError, setGamesStatusBulk } from '@/server/sync/status-rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Массовая смена статуса, одна транзакция. Контракт 9.6.
export async function POST(req: Request) {
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const p = parseBulkBody(read.body);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    const db = getDb();
    const changed = await setGamesStatusBulk(db, p.value.ids, p.value.status);
    const games = await getGamesByIds(db, p.value.ids);
    return ok({ requested: p.value.ids.length, changed, games });
  } catch (e) {
    if (e instanceof BulkMissingError) return fail(404, 'not_found', 'Часть игр не найдена.', { missingIds: e.missingIds });
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
