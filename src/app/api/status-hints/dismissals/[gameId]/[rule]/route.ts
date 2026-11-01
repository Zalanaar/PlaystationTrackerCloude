import { getDb } from '@/db';
import { requireUser } from '@/server/auth/require-user';
import { fail, ok, originAllowed } from '@/server/http';
import { parseGameId, parseHintRule } from '@/server/recommend/validation';
import { undismissHint } from '@/server/sync/status-hints-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Отмена отказа. Идемпотентно. Контракт 28.7.
export async function DELETE(req: Request, ctx: { params: Promise<{ gameId: string; rule: string }> }) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const params = await ctx.params;
  const gameId = parseGameId(params.gameId);
  const rule = parseHintRule(params.rule);
  if (gameId === null || rule === null) return fail(400, 'invalid_request', 'Некорректный запрос.');
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  try {
    await undismissHint(getDb(), a.user.id, gameId, rule);
    return ok({ gameId, rule });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
