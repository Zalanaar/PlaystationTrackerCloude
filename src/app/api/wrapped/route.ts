import { getDb } from '@/db';
import { fail, okRevalidated } from '@/server/http';
import { mskDate } from '@/server/stats/period';
import { getWrapped } from '@/server/wrapped/query';
import { parseWrappedQuery } from '@/server/wrapped/validation';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Итоги года для сторис-слайдов. Контракт 11.1.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const p = parseWrappedQuery(new URL(req.url).searchParams, mskDate(new Date()).year);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    // Ник пользователя из его профиля (allowed_users.psn_online_id); иначе getWrapped возьмёт его из сохранённого профиля PSN. Env с ником владельца чужим не отдаётся.
    const onlineId = a.user.row.psnOnlineId?.trim() || null;
    return okRevalidated(req, await getWrapped(getDb(), a.user.id, p.value.year, onlineId, new Date(), { withService: p.value.withService }));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
