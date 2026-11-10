// Атрибуция каталога под поиском (Пакет 7): RAWG, а если ответил запасной каталог — его имя со ссылкой.
import type { FallbackCatalog } from '@/server/catalog/rawg';
import { Icon } from '../icons';

type Key = 'rawg' | FallbackCatalog;
export const CATALOG_SITES: Record<Key, { name: string; url: string }> = {
  rawg: { name: 'RAWG', url: 'https://rawg.io' },
  psstore: { name: 'PlayStation Store', url: 'https://store.playstation.com' },
  steam: { name: 'Steam', url: 'https://store.steampowered.com' },
  eshop: { name: 'Nintendo eShop', url: 'https://www.nintendo.com' },
  msstore: { name: 'Microsoft Store', url: 'https://www.xbox.com' },
  wikidata: { name: 'Wikidata', url: 'https://www.wikidata.org' },
  giantbomb: { name: 'Giant Bomb', url: 'https://www.giantbomb.com' },
};

/** Каталоги выдачи по порядку появления; пустая выдача = RAWG (главный). */
export function catalogsOf(list: readonly { catalog?: FallbackCatalog }[]): Key[] {
  const out: Key[] = [];
  for (const c of list) {
    const k: Key = c.catalog ?? 'rawg';
    if (!out.includes(k)) out.push(k);
  }
  return out.length > 0 ? out : ['rawg'];
}

/** variant: note — строка в подвале шторки; inline — короткая строка под подсказками (ссылки вне Tab). */
export function CatalogCredit({ list, variant = 'note', className }: { list: readonly { catalog?: FallbackCatalog }[]; variant?: 'note' | 'inline'; className?: string }) {
  const keys = catalogsOf(list);
  const fallback = keys.some((k) => k !== 'rawg');
  if (variant === 'inline') {
    return (
      <p className={className} data-testid="catalog-credit" data-fallback={fallback ? '1' : undefined}>
        Данные об играх:{' '}
        {keys.map((k, i) => (
          <span key={k}>
            {i > 0 && ', '}
            <a href={CATALOG_SITES[k].url} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-label={`${CATALOG_SITES[k].name} (новая вкладка)`}>{CATALOG_SITES[k].name}</a>
          </span>
        ))}
        {fallback && ' (RAWG недоступен, запасной каталог)'}
      </p>
    );
  }
  return (
    <p className={className ?? 'ps-rec-note'} data-testid="catalog-credit" data-fallback={fallback ? '1' : undefined}>
      <span>{fallback ? 'RAWG недоступен, данные:' : 'Данные об играх:'}</span>
      {keys.map((k) => (
        <a key={k} className="ps-rec-note__link" href={CATALOG_SITES[k].url} target="_blank" rel="noopener noreferrer" aria-label={`${CATALOG_SITES[k].name} (новая вкладка)`}>
          {CATALOG_SITES[k].name}<Icon name="external-link" size={12} />
        </a>
      ))}
    </p>
  );
}
