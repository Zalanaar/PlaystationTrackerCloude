import { getDb } from '@/db';
import { CatalogError, searchCatalog } from '@/server/catalog/rawg';
import { asOfIso, cachedSearch, dbCatalogCache } from '@/server/catalog/cache';
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

// Поиск релиза в RAWG (при сбое — запасной каталог). Кэш запроса 12 ч; при 429 — последние данные + asOf. Контракт 17.9, t278u.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const p = parseCatalogQuery(new URL(req.url).searchParams);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  const ps = parseCatalogPlaystation(new URL(req.url).searchParams);
  if (!ps.ok) return fail(400, 'invalid_request', ps.message);
  const apiKey = getRawgKey();
  const deps = { apiKey, playstationOnly: ps.value, reserve: rawgReserve(a.user.id) };
  let candidates;
  let asOf: string | undefined;
  let stale = false;
  try {
    try {
      const cached = await cachedSearch(p.value, { ...deps, store: dbCatalogCache(getDb()) });
      candidates = cached.value;
      asOf = asOfIso(cached.fetchedAt);
      stale = cached.stale;
    } catch (e) {
      if (e instanceof CatalogError) throw e;
      candidates = await searchCatalog(p.value, deps);
    }
  } catch (e) {
    try {
      const fb = catalogFallback();
      const alt = ps.value ? fb.playstation : fb.any;
      const r = await withFallback(
        () => Promise.reject(e instanceof CatalogError ? e : new CatalogError('network')),
        alt ? () => alt(p.value, 10) : null,
        { breaker: fb.breaker },
      );
      candidates = r.candidates;
    } catch (err) {
      const reason = err instanceof CatalogError ? err.reason : (e instanceof CatalogError ? e.reason : 'network');
      return fail(503, 'catalog_unavailable', 'Каталог игр недоступен. Введи данные вручную.', { reason });
    }
  }
  const body = { candidates, ...(asOf ? { asOf, stale } : {}) };
  try {
    return ok({ ...body, candidates: await filterOwned(getDb(), a.user.id, candidates) });
  } catch {
    return ok(body);
  }
}
