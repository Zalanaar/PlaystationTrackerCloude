import { getDb } from '@/db';
import { getGameDetails } from '@/server/collection/details';
import { parseGameId } from '@/server/collection/validation';
import { fail, ok } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Детали игры для окна: GameItem, даты, трофеи. Контракт 12.5.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const id = parseGameId((await ctx.params).id);
  if (id === null) return fail(400, 'invalid_request', 'Некорректный id игры.');
  try {
    const details = await getGameDetails(getDb(), a.user.id, id);
    if (!details) return fail(404, 'not_found', 'Игра не найдена.');
    return ok(details);
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
