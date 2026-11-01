import { getDb } from '@/db';
import { readJsonBody } from '@/server/collection/http';
import { getGamesByIds } from '@/server/collection/query';
import { parseGameId, parseStatusPutBody } from '@/server/collection/validation';
import { fail, ok } from '@/server/http';
import { setGameStatus, StatusRuleError } from '@/server/sync/status-rules';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Смена статуса игры. Контракт 9.4.
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const id = parseGameId((await ctx.params).id);
  if (id === null) return fail(400, 'invalid_request', 'Некорректный id игры.');
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const p = parseStatusPutBody(read.body);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    const db = getDb();
    await setGameStatus(db, a.user.id, id, p.value.status, new Date(), { expectedStatus: p.value.expectedStatus, restore: p.value.restore });
    const [game] = await getGamesByIds(db, a.user.id, [id]);
    return ok({ game });
  } catch (e) {
    if (e instanceof StatusRuleError && e.code === 'not_found') return fail(404, 'not_found', 'Игра не найдена.');
    if (e instanceof StatusRuleError && e.code === 'status_conflict') return fail(409, 'status_conflict', e.message, { status: e.currentStatus });
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
