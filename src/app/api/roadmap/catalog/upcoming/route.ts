import { getDb } from '@/db';
import { CatalogError, getCatalogGame, getUpcoming } from '@/server/catalog/rawg';
import { getRawgKey } from '@/server/env';
import { fail, ok } from '@/server/http';
import { filterOwned } from '@/server/owned/marks';
import { markPlanned } from '@/server/roadmap/db';
import { applyCatalogReleaseDates, refreshPlannedReleaseDates } from '@/server/roadmap/sync-release-dates';
import { parseUpcomingPage } from '@/server/roadmap/validation';
import { rawgReserve } from '@/server/usage/rawg-reserve';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Предстоящие релизы PlayStation на год вперёд (RAWG, кэш 1 час). Контракт 17.13.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const p = parseUpcomingPage(new URL(req.url).searchParams);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  let page;
  const apiKey = getRawgKey();
  try {
    page = await getUpcoming(p.value, { apiKey, reserve: rawgReserve(a.user.id) });
  } catch (e) {
    const reason = e instanceof CatalogError ? e.reason : 'network';
    return fail(503, 'catalog_unavailable', 'Каталог игр недоступен. Введи данные вручную.', { reason });
  }
  try {
    const db = getDb();
    // Свежие даты с этой страницы — сразу в план (окно «на релизе» и карточки «Релизы»/очереди едут за каталогом).
    const applied = await applyCatalogReleaseDates(db, a.user.id, page.candidates).catch(() => []);
    const more = page.page === 1 && apiKey
      ? await refreshPlannedReleaseDates(db, a.user.id, {
          fetchGame: (id) => getCatalogGame(id, { apiKey, reserve: rawgReserve(a.user.id) }),
          skipIds: new Set(page.candidates.map((c) => c.externalId)),
        }).catch(() => [])
      : [];
    const updated = [...applied, ...more].map((c) => ({ id: c.id, releaseDate: c.to }));
    return ok({
      candidates: await markPlanned(db, a.user.id, await filterOwned(db, a.user.id, page.candidates).catch(() => page.candidates)),
      page: page.page, hasMore: page.hasMore, total: page.total, updated,
    });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
