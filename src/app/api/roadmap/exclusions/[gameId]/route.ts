import { getDb } from '@/db';
import { fail, ok, originAllowed } from '@/server/http';
import { NotFoundError, restoreGame } from '@/server/roadmap/db';
import { parseId } from '@/server/roadmap/validation';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Вернуть игру из «Не распределено» в конец очереди. Идемпотентно. Контракт 17.12.
export async function DELETE(req: Request, ctx: { params: Promise<{ gameId: string }> }) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const gameId = parseId((await ctx.params).gameId);
  if (gameId === null) return fail(400, 'invalid_request', 'Некорректный id.');
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  try {
    await restoreGame(getDb(), a.user.id, gameId);
    return ok({ excluded: false, gameId });
  } catch (e) {
    if (e instanceof NotFoundError) return fail(404, 'not_found', 'Игра не найдена.');
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
