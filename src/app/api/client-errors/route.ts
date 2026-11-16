import { getDb } from '@/db';
import { requireUser } from '@/server/auth/require-user';
import { clientErrorsSummary, parseClientError, recordClientError } from '@/server/client-errors/log';
import { readJsonBody } from '@/server/collection/http';
import { fail, ok } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// П10: журнал ошибок браузера. GET — сводка для панели синка (7 дней, 3 последних), только свои записи.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    return ok(await clientErrorsSummary(getDb(), a.user.id));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

// POST — записать одну ошибку (Origin и JSON проверяются; не больше 30 в час, сверх лимита stored:false).
export async function POST(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const p = parseClientError(read.body);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    return ok({ stored: await recordClientError(getDb(), a.user.id, p.value) });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
