import { getDb } from '@/db';
import { requireUser } from '@/server/auth/require-user';
import { fail, ok } from '@/server/http';
import { searchLibrary } from '@/server/owned/marks';
import { parseSearchParams } from '@/server/owned/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Поиск по библиотеке пользователя для выбора сборника. Контракт Фазы 40, 40.2.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const p = parseSearchParams(new URL(req.url).searchParams);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    return ok({ games: await searchLibrary(getDb(), a.user.id, p.value.q, p.value.limit) });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
