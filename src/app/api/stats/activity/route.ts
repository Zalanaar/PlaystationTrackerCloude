import { getDb } from '@/db';
import { fail, ok } from '@/server/http';
import { getActivity } from '@/server/stats/activity-query';
import { parseActivityQuery } from '@/server/stats/validation';
import { mskDate } from '@/server/stats/period';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Стрик игровых дней и тепловая карта года по снимкам. Сессию проверяет src/proxy.ts. Контракт 14.3.
export async function GET(req: Request) {
  const p = parseActivityQuery(new URL(req.url).searchParams, mskDate(new Date()).year);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    return ok(await getActivity(getDb(), p.value.year));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
