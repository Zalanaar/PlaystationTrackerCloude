import { getDb } from '@/db';
import { readJsonBody } from '@/server/collection/http';
import { resetAllStatuses } from '@/server/collection/mutations';
import { parseResetAllBody } from '@/server/collection/validation';
import { fail, ok } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Сброс статусов всей коллекции с бэкапом. Контракт 9.8.
export async function POST(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const p = parseResetAllBody(read.body);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    return ok(await resetAllStatuses(getDb(), a.user.id));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
