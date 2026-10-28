import { getDb } from '@/db';
import { getGameDetails } from '@/server/collection/details';
import { parseGameId } from '@/server/collection/validation';
import { fail, ok } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Детали игры для окна: GameItem, даты, трофеи. Сессию проверяет src/proxy.ts. Контракт 12.5.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseGameId((await ctx.params).id);
  if (id === null) return fail(400, 'invalid_request', 'Некорректный id игры.');
  try {
    const details = await getGameDetails(getDb(), id);
    if (!details) return fail(404, 'not_found', 'Игра не найдена.');
    return ok(details);
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
