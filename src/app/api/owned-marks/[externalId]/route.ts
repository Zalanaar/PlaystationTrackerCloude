import { getDb } from '@/db';
import { requireUser } from '@/server/auth/require-user';
import { fail, ok, originAllowed } from '@/server/http';
import { removeOwnedMark } from '@/server/owned/marks';
import { parseOwnedExternalId } from '@/server/owned/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// «Вернуть в подборку»: снять отметку. Идемпотентно, трогает только записи этого пользователя. Контракт Фазы 40, 40.2.
export async function DELETE(req: Request, ctx: { params: Promise<{ externalId: string }> }) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const externalId = parseOwnedExternalId((await ctx.params).externalId);
  if (externalId === null) return fail(400, 'invalid_request', 'Некорректный id.');
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  try {
    return ok({ externalId, removed: await removeOwnedMark(getDb(), a.user.id, externalId) });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
