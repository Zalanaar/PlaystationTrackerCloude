import { getDb } from '@/db';
import { fail, ok, originAllowed } from '@/server/http';
import { undislikeExternal } from '@/server/recommend/discover-dislikes';
import { parseExternalId } from '@/server/recommend/validation';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Снять «Не интересно» (источник всегда rawg). Идемпотентно. Контракт Фазы 30, 30.5.
export async function DELETE(req: Request, ctx: { params: Promise<{ externalId: string }> }) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const externalId = parseExternalId((await ctx.params).externalId);
  if (externalId === null) return fail(400, 'invalid_request', 'Некорректный id.');
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  try {
    await undislikeExternal(getDb(), a.user.id, externalId);
    return ok({ externalId });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
