import { getDb } from '@/db';
import { CatalogError, searchCatalog } from '@/server/catalog/rawg';
import { withFallback } from '@/server/catalog/fallback';
import { catalogFallback } from '@/server/catalog/sources';
import { getRawgKey } from '@/server/env';
import { fail, ok } from '@/server/http';
import { filterOwned } from '@/server/owned/marks';
import { parseCatalogPlaystation, parseCatalogQuery } from '@/server/roadmap/validation';
import { rawgReserve } from '@/server/usage/rawg-reserve';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Поиск релиза в RAWG (при сбое — запасной каталог). Ошибка каталога не роняет экран: 503 catalog_unavailable, ручной ввод остаётся. Контракт 17.9.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const p = parseCatalogQuery(new URL(req.url).searchParams);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  const ps = parseCatalogPlaystation(new URL(req.url).searchParams);
  if (!ps.ok) return fail(400, 'invalid_request', ps.message);
  let candidates;
  try {
    // RAWG главный; если не ответил — запасной каталог (Пакет 7)
    const fb = catalogFallback();
    const alt = ps.value ? fb.playstation : fb.any;
    const r = await withFallback(
      () => searchCatalog(p.value, { apiKey: getRawgKey(), playstationOnly: ps.value, reserve: rawgReserve(a.user.id) }),
      alt ? () => alt(p.value, 10) : null,
      { breaker: fb.breaker },
    );
    candidates = r.candidates;
  } catch (e) {
    const reason = e instanceof CatalogError ? e.reason : 'network';
    return fail(503, 'catalog_unavailable', 'Каталог игр недоступен. Введите данные вручную.', { reason });
  }
  try {
    return ok({ candidates: await filterOwned(getDb(), a.user.id, candidates) });
  } catch {
    // БД недоступна: поиск важнее фильтра, отдаём как есть (ручной ввод и План от отметок не зависят)
    return ok({ candidates });
  }
}
