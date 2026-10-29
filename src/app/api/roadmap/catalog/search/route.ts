import { CatalogError, searchCatalog } from '@/server/catalog/rawg';
import { getRawgKey } from '@/server/env';
import { fail, ok } from '@/server/http';
import { parseCatalogQuery } from '@/server/roadmap/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Поиск релиза в RAWG. Ошибка каталога не роняет экран: 503 catalog_unavailable, ручной ввод остаётся. Контракт 17.9.
export async function GET(req: Request) {
  const p = parseCatalogQuery(new URL(req.url).searchParams);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    return ok({ candidates: await searchCatalog(p.value, { apiKey: getRawgKey() }) });
  } catch (e) {
    const reason = e instanceof CatalogError ? e.reason : 'network';
    return fail(503, 'catalog_unavailable', 'Каталог игр недоступен. Введите данные вручную.', { reason });
  }
}
