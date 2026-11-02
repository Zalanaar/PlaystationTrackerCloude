import { getDb } from '@/db';
import { requireUser } from '@/server/auth/require-user';
import { fail, ok, originAllowed } from '@/server/http';
import { ManualNotFoundError, setNotPurchased } from '@/server/manual/store';
import { parseManualId } from '@/server/manual/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function toggle(req: Request, ctx: { params: Promise<{ id: string }> }, notPurchased: boolean) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const id = parseManualId((await ctx.params).id);
  if (id === null) return fail(400, 'invalid_request', 'Некорректный id.');
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  try {
    return ok({ item: await setNotPurchased(getDb(), a.user.id, id, notPurchased) });
  } catch (e) {
    if (e instanceof ManualNotFoundError) return fail(404, 'not_found', 'Игра не найдена.');
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

// «Купил»: снять пометку «не куплено». Идемпотентно. Контракт Фазы 43, 43.2.
export const POST = (req: Request, ctx: { params: Promise<{ id: string }> }) => toggle(req, ctx, false);
// «Отменить» снятие пометки: вернуть «не куплено». Идемпотентно.
export const DELETE = (req: Request, ctx: { params: Promise<{ id: string }> }) => toggle(req, ctx, true);
