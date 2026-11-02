import { getDb } from '@/db';
import { requireUser } from '@/server/auth/require-user';
import { CatalogError } from '@/server/catalog/rawg';
import { getRawgKey } from '@/server/env';
import { fail, ok } from '@/server/http';
import { rawgResetAt, searchPlayStation, suggestPlayStation } from '@/server/manual/search';
import { flagCandidates } from '@/server/manual/store';
import { parseManualSearchParams } from '@/server/manual/validation';
import { rawgReserve, rawgSuggestReserve } from '@/server/usage/rawg-reserve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Поиск игры PS5/PS4 в RAWG по нажатию. Лимит RAWG на профиль, кэш. Контракт Фазы 43, 43.3.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const q = parseManualSearchParams(new URL(req.url).searchParams);
  if (!q.ok) return fail(400, 'invalid_request', q.message);
  const state = { quota: false };
  let found;
  try {
    found = q.value.suggest
      ? await suggestPlayStation(q.value.q, { apiKey: getRawgKey(), reserve: rawgSuggestReserve(a.user.id, state) })
      : await searchPlayStation(q.value.q, { apiKey: getRawgKey(), reserve: rawgReserve(a.user.id) });
  } catch (e) {
    // мягкий предел подсказок (43.1.3): клиент откатывается на поиск по Enter
    if (state.quota) return fail(429, 'rate_limited', 'Лимит подсказок на сегодня исчерпан. Ищите по Enter.', { reason: 'suggest_limited', resetAt: rawgResetAt(new Date()) });
    const reason = e instanceof CatalogError ? e.reason : 'network';
    // жёсткая квота RAWG в режиме подсказок (43.1.3): отдельная причина, клиент прекращает и подсказки, и Enter-поиск до resetAt
    if (q.value.suggest && reason === 'rate_limited') return fail(429, 'rate_limited', 'Дневной лимит каталога исчерпан.', { reason: 'quota', resetAt: rawgResetAt(new Date()) });
    return fail(503, 'catalog_unavailable', 'Каталог игр недоступен.', { reason, ...(reason === 'rate_limited' ? { resetAt: rawgResetAt(new Date()) } : {}) });
  }
  try {
    return ok({ candidates: await flagCandidates(getDb(), a.user.id, found.candidates), cached: found.cached });
  } catch {
    // БД недоступна: поиск важнее пометок, но без них «В бэклог» не предупредит о дубле на этом шаге (POST проверит ещё раз)
    return ok({ candidates: found.candidates.map((c) => ({ ...c, duplicate: null, inBacklog: false })), cached: found.cached });
  }
}
