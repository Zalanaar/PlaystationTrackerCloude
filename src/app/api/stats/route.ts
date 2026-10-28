import { getDb } from '@/db';
import { fail, ok } from '@/server/http';
import { mskDate } from '@/server/stats/period';
import { getStats } from '@/server/stats/query';
import { parseStatsQuery } from '@/server/stats/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Статистика за год/месяц. Сессию проверяет src/proxy.ts. Контракт 10.1.
export async function GET(req: Request) {
  const p = parseStatsQuery(new URL(req.url).searchParams, mskDate(new Date()).year);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    return ok(await getStats(getDb(), p.value));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
