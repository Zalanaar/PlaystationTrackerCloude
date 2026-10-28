import { getDb } from '@/db';
import { readJsonBody } from '@/server/collection/http';
import { NotFoundError, restoreStatuses } from '@/server/collection/mutations';
import { parseRestoreBody } from '@/server/collection/validation';
import { fail, ok } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Откат статусов из бэкапа. Контракт 9.9.
export async function POST(req: Request) {
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const p = parseRestoreBody(read.body);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    return ok(await restoreStatuses(getDb(), p.value.backupId));
  } catch (e) {
    if (e instanceof NotFoundError) return fail(404, 'not_found', 'Бэкап не найден.');
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
