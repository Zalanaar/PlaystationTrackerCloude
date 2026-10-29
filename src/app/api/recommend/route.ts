import { getDb } from '@/db';
import { fail, ok } from '@/server/http';
import { getRecommendations } from '@/server/recommend/db';
import { parseTime } from '@/server/recommend/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// «Подскажи»: топ-9 из бэклога. Сессию проверяет src/proxy.ts. Контракт 18.4.
export async function GET(req: Request) {
  const t = parseTime(new URL(req.url).searchParams.get('time'));
  if (!t.ok) return fail(400, 'invalid_request', t.message);
  try {
    return ok(await getRecommendations(getDb(), t.value));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
