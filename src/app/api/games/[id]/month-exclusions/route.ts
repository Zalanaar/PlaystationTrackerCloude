import { getDb } from '@/db';
import { readJsonBody } from '@/server/collection/http';
import { NotFoundError } from '@/server/collection/mutations';
import { parseGameId, parseMonthExclusionBody } from '@/server/collection/validation';
import { fail, ok } from '@/server/http';
import { MonthExclusionConflictError, setMonthExclusion } from '@/server/stats/exclusions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Убрать игру из месяца / вернуть в месяц (Статистика, «Игры месяца»). Контракт 15.1.
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseGameId((await ctx.params).id);
  if (id === null) return fail(400, 'invalid_request', 'Некорректный id игры.');
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const p = parseMonthExclusionBody(read.body);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    const r = await setMonthExclusion(getDb(), id, p.value.month, p.value.excluded);
    return ok({ gameId: id, month: p.value.month, excluded: p.value.excluded, ...r });
  } catch (e) {
    if (e instanceof NotFoundError) return fail(404, 'not_found', 'Игра не найдена.');
    if (e instanceof MonthExclusionConflictError) {
      return fail(409, 'month_exclusion_conflict', e.message, {
        gameId: e.gameId,
        month: e.month,
        rangeMonths: e.rangeMonths,
        excludedMonths: e.excludedMonths,
      });
    }
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
