import { getDb } from '@/db';
import { requireUser } from '@/server/auth/require-user';
import { CatalogError } from '@/server/catalog/rawg';
import { getRawgKey } from '@/server/env';
import { fail, ok } from '@/server/http';
import { rawgResetAt, searchPlayStation } from '@/server/manual/search';
import { flagCandidates } from '@/server/manual/store';
import { parseManualSearchQuery } from '@/server/manual/validation';
import { rawgReserve } from '@/server/usage/rawg-reserve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Поиск игры PS5/PS4 в RAWG по нажатию. Лимит RAWG на профиль, кэш. Контракт Фазы 43, 43.3.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const q = parseManualSearchQuery(new URL(req.url).searchParams);
  if (!q.ok) return fail(400, 'invalid_request', q.message);
  let found;
  try {
    found = await searchPlayStation(q.value, { apiKey: getRawgKey(), reserve: rawgReserve(a.user.id) });
  } catch (e) {
    const reason = e instanceof CatalogError ? e.reason : 'network';
    return fail(503, 'catalog_unavailable', 'Каталог игр недоступен.', { reason, ...(reason === 'rate_limited' ? { resetAt: rawgResetAt(new Date()) } : {}) });
  }
  try {
    return ok({ candidates: await flagCandidates(getDb(), a.user.id, found.candidates), cached: found.cached });
  } catch {
    // БД недоступна: поиск важнее пометок, но без них «В бэклог» не предупредит о дубле на этом шаге (POST проверит ещё раз)
    return ok({ candidates: found.candidates.map((c) => ({ ...c, duplicate: null, inBacklog: false })), cached: found.cached });
  }
}
