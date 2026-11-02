import { getDb } from '@/db';
import { requireUser } from '@/server/auth/require-user';
import { readJsonBody } from '@/server/collection/http';
import { fail, ok } from '@/server/http';
import { addManualBatch } from '@/server/manual/store';
import { parseManualBatchBody } from '@/server/manual/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Пакетное добавление «в бэклог» (до 10 игр), частичный успех, идемпотентно. Контракт Фазы 43.1, 43.1.2.
export async function POST(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const p = parseManualBatchBody(read.body);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  let db;
  try {
    db = getDb();
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
  const results = await addManualBatch(db, a.user.id, p.value);
  if (results.every((r) => r.status === 'error' && r.code === 'db_unavailable')) return fail(503, 'db_unavailable', 'База данных недоступна.');
  return ok({ results, created: results.filter((r) => r.status === 'created').length });
}
