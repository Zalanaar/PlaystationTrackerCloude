// Запасной каталог (Пакет 7): RAWG главный, пока отвечает. Сбой RAWG (таймаут, сеть, 5xx, мусор в ответе) —
// тот же поиск в запасных каталогах без ключей: PlayStation Store, Steam, Nintendo eShop, Microsoft Store, Wikidata.
// После сбоя RAWG несколько минут не спрашиваем (не ждём 8 с таймаута на каждый поиск), потом снова пробуем RAWG первым.
import { CatalogError, type CatalogCandidate, type CatalogFailReason, type FallbackCatalog } from './rawg';

/** Причины «RAWG лежит» (наш лимит и 429 — не сбой каталога, запасной не подменяет квоту). */
export const OUTAGE_REASONS: ReadonlySet<CatalogFailReason> = new Set(['timeout', 'network', 'http_error', 'bad_response']);
export const RAWG_DOWN_MS = 5 * 60_000;

/** Чья выдача: RAWG, один запасной каталог или смесь нескольких запасных. */
export type CatalogName = 'rawg' | FallbackCatalog | 'mixed';

/** Память «RAWG недавно упал» на процесс (serverless: на инстанс). */
export class Breaker {
  private downUntil = 0;
  constructor(private readonly ms = RAWG_DOWN_MS) {}
  isDown(now: number): boolean {
    return now < this.downUntil;
  }
  down(now: number): void {
    this.downUntil = now + this.ms;
  }
  up(): void {
    this.downUntil = 0;
  }
}
export const rawgBreaker = new Breaker();

export type FallbackResult = { candidates: CatalogCandidate[]; catalog: CatalogName };

/**
 * primary — запрос RAWG; fallback — запасной поиск (null = запасного нет). Ошибка запасного не прячет исходную причину RAWG.
 * Вне сбоя (лимит, 429, нет ключа) ошибка RAWG пробрасывается как была.
 */
export async function withFallback(
  primary: () => Promise<CatalogCandidate[]>,
  fallback: (() => Promise<FallbackResult>) | null,
  o: { breaker?: Breaker; now?: () => number } = {},
): Promise<FallbackResult> {
  const now = o.now ?? Date.now;
  const br = o.breaker;
  let tried = false;
  if (fallback && br?.isDown(now())) {
    tried = true;
    try {
      return await fallback();
    } catch {
      // запасной тоже не ответил: пробуем RAWG — вдруг уже поднялся
    }
  }
  try {
    const candidates = await primary();
    br?.up();
    return { candidates, catalog: 'rawg' };
  } catch (e) {
    if (!(e instanceof CatalogError) || !OUTAGE_REASONS.has(e.reason)) throw e;
    br?.down(now());
    if (!fallback || tried) throw e;
    try {
      return await fallback();
    } catch {
      throw e;
    }
  }
}
