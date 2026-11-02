import { getDb } from '@/db';
import { requireUser } from '@/server/auth/require-user';
import { readJsonBody } from '@/server/collection/http';
import { fail, ok } from '@/server/http';
import { addManual, listManual, ManualDuplicateError, ManualLimitError, MANUAL_LIMIT } from '@/server/manual/store';
import { addOtherPlatform, listOtherPlatform } from '@/server/manual/other-platform';
import { parseAnyManualAddBody, parseKindParam, parseNbFlag } from '@/server/manual/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Записи Бэклога «вне библиотеки» (source: 'manual'). ?nb=1 = только «не куплено». Контракт Фазы 43, 43.2.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const sp = new URL(req.url).searchParams;
  const nb = parseNbFlag(sp);
  if (!nb.ok) return fail(400, 'invalid_request', nb.message);
  const kind = parseKindParam(sp);
  if (!kind.ok) return fail(400, 'invalid_request', kind.message);
  try {
    // Фаза 44: ?kind=other_platform = список «Играл на другой платформе»; без kind Бэклог видит только ps_backlog
    if (kind.value === 'other_platform') return ok({ items: await listOtherPlatform(getDb(), a.user.id) });
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
  const p = parseAnyManualAddBody(read.body);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    return ok(p.value.kind === 'other_platform' ? await addOtherPlatform(getDb(), a.user.id, p.value.v) : await addManual(getDb(), a.user.id, p.value.v));
  } catch (e) {
    if (e instanceof ManualDuplicateError) {
      return fail(409, 'duplicate_game', e.info.duplicate === 'library' ? 'Эта игра уже есть в библиотеке.' : 'Эта игра уже есть в Плане.', { ...e.info });
    }
    if (e instanceof ManualLimitError) return fail(409, 'manual_limit', e.limit === MANUAL_LIMIT ? `В Бэклоге не больше ${MANUAL_LIMIT} игр «не куплено».` : `В списке не больше ${e.limit} игр.`, { limit: e.limit });
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
