import { getDb } from '@/db';
import { fail, ok } from '@/server/http';
import { getRecommendations } from '@/server/recommend/db';
import { parseTime } from '@/server/recommend/validation';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// «Подскажи»: топ-9 из бэклога. Контракт 18.4.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const t = parseTime(new URL(req.url).searchParams.get('time'));
  if (!t.ok) return fail(400, 'invalid_request', t.message);
  try {
    return ok(await getRecommendations(getDb(), a.user.id, t.value));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
