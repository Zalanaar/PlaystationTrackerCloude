import { getDb } from '@/db';
import { CatalogError } from '@/server/catalog/rawg';
import { asOfIso, cachedUpcoming, dbCatalogCache } from '@/server/catalog/cache';
import { getRawgKey } from '@/server/env';
import { fail, ok } from '@/server/http';
import { filterOwned } from '@/server/owned/marks';
import { markPlanned } from '@/server/roadmap/db';
import { applyCatalogReleaseDates } from '@/server/roadmap/sync-release-dates';
import { parseUpcomingPage } from '@/server/roadmap/validation';
import { rawgReserve } from '@/server/usage/rawg-reserve';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Предстоящие релизы PlayStation на год вперёд. Живой RAWG — только при промахе общего кэша (12 ч). Контракт 17.13, t278u.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const p = parseUpcomingPage(new URL(req.url).searchParams);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  const apiKey = getRawgKey();
  let cached;
  try {
    const db = getDb();
    cached = await cachedUpcoming(p.value, { apiKey, reserve: rawgReserve(a.user.id), store: dbCatalogCache(db) });
  } catch (e) {
    const reason = e instanceof CatalogError ? e.reason : 'network';
    return fail(503, 'catalog_unavailable', 'Каталог игр недоступен. Введи данные вручную.', { reason });
  }
  try {
    const db = getDb();
    // Свежие даты с этой (закэшированной) страницы — в план без дополнительных запросов к RAWG.
    const applied = await applyCatalogReleaseDates(db, a.user.id, cached.value.candidates).catch(() => []);
    const updated = applied.map((c) => ({ id: c.id, releaseDate: c.to }));
    return ok({
      candidates: await markPlanned(db, a.user.id, await filterOwned(db, a.user.id, cached.value.candidates).catch(() => cached.value.candidates)),
      page: cached.value.page, hasMore: cached.value.hasMore, total: cached.value.total, updated,
      asOf: asOfIso(cached.fetchedAt), stale: cached.stale,
    });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
