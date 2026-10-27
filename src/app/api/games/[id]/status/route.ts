import { getDb } from '@/db';
import { readJsonBody } from '@/server/collection/http';
import { getGamesByIds } from '@/server/collection/query';
import { parseGameId, parseStatusBody } from '@/server/collection/validation';
import { fail, ok } from '@/server/http';
import { setGameStatus, StatusRuleError } from '@/server/sync/status-rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Смена статуса игры. Контракт 9.4.
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseGameId((await ctx.params).id);
  if (id === null) return fail(400, 'invalid_request', 'Некорректный id игры.');
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const p = parseStatusBody(read.body);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    const db = getDb();
    await setGameStatus(db, id, p.value.status);
    const [game] = await getGamesByIds(db, [id]);
    return ok({ game });
  } catch (e) {
    if (e instanceof StatusRuleError && e.code === 'not_found') return fail(404, 'not_found', 'Игра не найдена.');
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
