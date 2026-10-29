import { getDb } from '@/db';
import { fail, ok, originAllowed } from '@/server/http';
import { NotFoundError, undislikeGame } from '@/server/recommend/db';
import { parseGameId } from '@/server/recommend/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Снять «Не интересно». Идемпотентно. Контракт 18.5.
export async function DELETE(req: Request, ctx: { params: Promise<{ gameId: string }> }) {
  const gameId = parseGameId((await ctx.params).gameId);
  if (gameId === null) return fail(400, 'invalid_request', 'Некорректный id.');
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  try {
    await undislikeGame(getDb(), gameId);
    return ok({ gameId });
  } catch (e) {
    if (e instanceof NotFoundError) return fail(404, 'not_found', 'Игра не найдена.');
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
