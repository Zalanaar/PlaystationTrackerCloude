import { getDb } from '@/db';
import { readJsonBody } from '@/server/collection/http';
import { fail, ok, originAllowed } from '@/server/http';
import { deletePlanned, NotFoundError, updatePlanned, WantNeedsDateError } from '@/server/roadmap/db';
import { parseId, parsePlannedPatch } from '@/server/roadmap/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// Правка и удаление невышедшей игры. Контракт 17.7.
export async function PATCH(req: Request, ctx: Ctx) {
  const id = parseId((await ctx.params).id);
  if (id === null) return fail(400, 'invalid_request', 'Некорректный id.');
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const p = parsePlannedPatch(read.body);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    return ok({ planned: await updatePlanned(getDb(), id, p.value) });
  } catch (e) {
    if (e instanceof NotFoundError) return fail(404, 'not_found', 'Игра не найдена.');
    if (e instanceof WantNeedsDateError) return fail(400, 'invalid_request', 'Для «хочу на релизе» нужна дата выхода.', { reason: 'want_requires_release_date' });
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const id = parseId((await ctx.params).id);
  if (id === null) return fail(400, 'invalid_request', 'Некорректный id.');
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  try {
    await deletePlanned(getDb(), id);
    return ok({ deleted: true, id });
  } catch (e) {
    if (e instanceof NotFoundError) return fail(404, 'not_found', 'Игра не найдена.');
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
