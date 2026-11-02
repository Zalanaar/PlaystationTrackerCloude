import { getDb } from '@/db';
import { requireUser } from '@/server/auth/require-user';
import { fail, originAllowed } from '@/server/http';
import { manualExists } from '@/server/manual/store';
import { parseManualId } from '@/server/manual/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Смена статуса записи «не куплено» запрещена: статус всегда backlog, пока запись не склеена с игрой библиотеки. Контракт Фазы 43, 43.2.
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const id = parseManualId((await ctx.params).id);
  if (id === null) return fail(400, 'invalid_request', 'Некорректный id.');
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  try {
    if (!(await manualExists(getDb(), a.user.id, id))) return fail(404, 'not_found', 'Игра не найдена.');
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
  return fail(409, 'manual_status_locked', 'Статус игры «не куплено» не меняется: сначала нажмите «Купил».');
}
