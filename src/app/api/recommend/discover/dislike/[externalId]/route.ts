import { getDb } from '@/db';
import { fail, ok, originAllowed } from '@/server/http';
import { undislikeExternal } from '@/server/recommend/discover-dislikes';
import { parseExternalId } from '@/server/recommend/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Снять «Не интересно» (источник всегда rawg). Идемпотентно. Контракт 19.7.
export async function DELETE(req: Request, ctx: { params: Promise<{ externalId: string }> }) {
  const externalId = parseExternalId((await ctx.params).externalId);
  if (externalId === null) return fail(400, 'invalid_request', 'Некорректный id.');
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  try {
    await undislikeExternal(getDb(), externalId);
    return ok({ externalId });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
