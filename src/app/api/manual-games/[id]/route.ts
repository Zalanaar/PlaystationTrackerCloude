import { getDb } from '@/db';
import { requireUser } from '@/server/auth/require-user';
import { fail, ok, originAllowed } from '@/server/http';
import { readJsonBody } from '@/server/collection/http';
import { updateOtherPlatform } from '@/server/manual/other-platform';
import { ManualNotFoundError, removeManual } from '@/server/manual/store';
import { parseManualId, parseOtherPlatformPatch } from '@/server/manual/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Удалить запись из Бэклога. Идемпотентно, только свои записи. Контракт Фазы 43, 43.2.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const id = parseManualId((await ctx.params).id);
  if (id === null) return fail(400, 'invalid_request', 'Некорректный id.');
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  try {
    return ok({ id, removed: await removeManual(getDb(), a.user.id, id) });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

// Пакет 5: запись «с другой платформы» — платформа, статус △ ○ □ ✕, оценка 0–10, заметка. Чужая, склеенная или ps_backlog = 404.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const id = parseManualId((await ctx.params).id);
  if (id === null) return fail(400, 'invalid_request', 'Некорректный id.');
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const p = parseOtherPlatformPatch(read.body);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    return ok({ item: await updateOtherPlatform(getDb(), a.user.id, id, p.value) });
  } catch (e) {
    if (e instanceof ManualNotFoundError) return fail(404, 'not_found', 'Запись не найдена.');
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
