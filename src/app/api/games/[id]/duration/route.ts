import { getDb } from '@/db';
import { readJsonBody } from '@/server/collection/http';
import { NotFoundError, setDurationOverride } from '@/server/collection/mutations';
import { getGamesByIds } from '@/server/collection/query';
import { parseDurationBody, parseGameId } from '@/server/collection/validation';
import { fail, ok } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Ручная длительность прохождения: {"hours": 24.5} или {"hours": null} (сброс). Контракт 16.5.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseGameId((await ctx.params).id);
  if (id === null) return fail(400, 'invalid_request', 'Некорректный id игры.');
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const p = parseDurationBody(read.body);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    const db = getDb();
    await setDurationOverride(db, id, p.value.hours);
    const [game] = await getGamesByIds(db, [id]);
    return ok({ game });
  } catch (e) {
    if (e instanceof NotFoundError) return fail(404, 'not_found', 'Игра не найдена.');
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
