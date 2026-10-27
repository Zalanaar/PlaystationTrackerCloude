import { getDb } from '@/db';
import { fail, ok } from '@/server/http';
import { mskDate } from '@/server/stats/period';
import { getWrapped } from '@/server/wrapped/query';
import { parseWrappedQuery } from '@/server/wrapped/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Итоги года для сторис-слайдов. Сессию проверяет src/proxy.ts. Контракт 11.1.
export async function GET(req: Request) {
  const p = parseWrappedQuery(new URL(req.url).searchParams, mskDate(new Date()).year);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    // Ник берём из env (PSN_TARGET_ONLINE_ID); без PSN-настроек просто null. Секреты в ответ не попадают.
    const onlineId = process.env.PSN_TARGET_ONLINE_ID?.trim() || null;
    return ok(await getWrapped(getDb(), p.value.year, onlineId));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
