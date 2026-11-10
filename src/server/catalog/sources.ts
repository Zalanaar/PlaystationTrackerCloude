// Запасные каталоги (Пакет 7): какой источник отвечает за какой поиск, когда RAWG не ответил.
// Каждый источник независим: его сбой (таймаут, смена неофициального API) не роняет остальные.
import type { CatalogFallback } from '@/server/manual/search';
import { rawgBreaker, type FallbackResult } from './fallback';
import { searchPsStore } from './psstore';
import type { CatalogCandidate } from './rawg';

export type FallbackSourcesDeps = { fetch?: typeof fetch };

const one = async (catalog: FallbackResult['catalog'], p: Promise<CatalogCandidate[]>): Promise<FallbackResult> => ({ candidates: await p, catalog });

/** Набор запасных поисков для маршрутов. */
export function catalogFallback(deps: FallbackSourcesDeps = {}): CatalogFallback {
  return {
    breaker: rawgBreaker,
    playstation: (q, limit) => one('psstore', searchPsStore(q, { fetch: deps.fetch, limit })),
    any: (q, limit) => one('psstore', searchPsStore(q, { fetch: deps.fetch, limit })),
  };
}
