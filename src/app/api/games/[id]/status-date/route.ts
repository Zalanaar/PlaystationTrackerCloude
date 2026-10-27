import { getDb } from '@/db';
import { readJsonBody } from '@/server/collection/http';
import { getGamesByIds } from '@/server/collection/query';
import { parseDateBody, parseGameId } from '@/server/collection/validation';
import { fail, ok } from '@/server/http';
import { setStatusDate, StatusRuleError } from '@/server/sync/status-rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Ручная правка даты завершения/броска. Контракт 9.5.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseGameId((await ctx.params).id);
  if (id === null) return fail(400, 'invalid_request', 'Некорректный id игры.');
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const p = parseDateBody(read.body);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    const db = getDb();
    await setStatusDate(db, id, p.value.date, new Date(), p.value.field);
    const [game] = await getGamesByIds(db, [id]);
    return ok({ game });
  } catch (e) {
    if (e instanceof StatusRuleError) {
      if (e.code === 'not_found') return fail(404, 'not_found', 'Игра не найдена.');
      if (e.code === 'date_not_allowed') return fail(409, 'status_conflict', e.message, { status: e.currentStatus });
      return fail(400, 'invalid_request', e.message);
    }
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
