import { getDb } from '@/db';
import { fail, ok } from '@/server/http';
import { getDiscover } from '@/server/recommend/discover';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// «У тебя нет»: только чтение подборки, ни RAWG, ни LLM не вызываются (подборку считает синк). Контракт Фазы 30, 30.2.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    return ok(await getDiscover(getDb(), a.user.id));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
