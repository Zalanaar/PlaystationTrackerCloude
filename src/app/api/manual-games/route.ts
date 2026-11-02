import { getDb } from '@/db';
import { requireUser } from '@/server/auth/require-user';
import { readJsonBody } from '@/server/collection/http';
import { fail, ok } from '@/server/http';
import { addManual, listManual, ManualDuplicateError, ManualLimitError, MANUAL_LIMIT } from '@/server/manual/store';
import { parseManualAddBody, parseNbFlag } from '@/server/manual/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Записи Бэклога «вне библиотеки» (source: 'manual'). ?nb=1 = только «не куплено». Контракт Фазы 43, 43.2.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const nb = parseNbFlag(new URL(req.url).searchParams);
  if (!nb.ok) return fail(400, 'invalid_request', nb.message);
  try {
    return ok({ items: await listManual(getDb(), a.user.id, { nb: nb.value }) });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

// «В бэклог»: запись со статусом backlog и пометкой «не куплено». Дубль с библиотекой или Планом = 409 duplicate_game, повтор с confirmDuplicate.
export async function POST(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const p = parseManualAddBody(read.body);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    return ok(await addManual(getDb(), a.user.id, p.value));
  } catch (e) {
    if (e instanceof ManualDuplicateError) {
      return fail(409, 'duplicate_game', e.info.duplicate === 'library' ? 'Эта игра уже есть в библиотеке.' : 'Эта игра уже есть в Плане.', { ...e.info });
    }
    if (e instanceof ManualLimitError) return fail(409, 'manual_limit', `В Бэклоге не больше ${MANUAL_LIMIT} игр «не куплено».`);
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
