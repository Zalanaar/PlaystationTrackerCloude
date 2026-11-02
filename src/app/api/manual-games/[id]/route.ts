import { getDb } from '@/db';
import { requireUser } from '@/server/auth/require-user';
import { fail, ok, originAllowed } from '@/server/http';
import { removeManual } from '@/server/manual/store';
import { parseManualId } from '@/server/manual/validation';

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
