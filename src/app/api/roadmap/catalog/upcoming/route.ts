import { getDb } from '@/db';
import { CatalogError, getUpcoming } from '@/server/catalog/rawg';
import { getRawgKey } from '@/server/env';
import { fail, ok } from '@/server/http';
import { markPlanned } from '@/server/roadmap/db';
import { parseUpcomingPage } from '@/server/roadmap/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Предстоящие релизы PlayStation на год вперёд (RAWG, кэш 1 час). Контракт 17.13.
export async function GET(req: Request) {
  const p = parseUpcomingPage(new URL(req.url).searchParams);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  let page;
  try {
    page = await getUpcoming(p.value, { apiKey: getRawgKey() });
  } catch (e) {
    const reason = e instanceof CatalogError ? e.reason : 'network';
    return fail(503, 'catalog_unavailable', 'Каталог игр недоступен. Введите данные вручную.', { reason });
  }
  try {
    return ok({ candidates: await markPlanned(getDb(), page.candidates), page: page.page, hasMore: page.hasMore });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
