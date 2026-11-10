// Страница игры у каталога по ключу (Пакет 7). Числовой id = RAWG, префикс = запасной каталог. Неизвестное = null.
export type CatalogPage = { url: string; site: string };

export function catalogPage(externalId: string): CatalogPage | null {
  if (/^\d{1,12}$/.test(externalId)) return { url: `https://rawg.io/games/${externalId}`, site: 'RAWG' };
  let m = /^ps-([A-Za-z0-9_-]{1,60})$/.exec(externalId);
  if (m) return { url: `https://store.playstation.com/en-us/${/^\d+$/.test(m[1]) ? 'concept' : 'product'}/${m[1]}`, site: 'PlayStation Store' };
  m = /^steam-(\d{1,12})$/.exec(externalId);
  if (m) return { url: `https://store.steampowered.com/app/${m[1]}`, site: 'Steam' };
  m = /^xb-([A-Za-z0-9]{6,20})$/.exec(externalId);
  if (m) return { url: `https://www.xbox.com/en-US/games/store/x/${m[1]}`, site: 'Microsoft Store' };
  m = /^wd-(Q\d{1,12})$/.exec(externalId);
  if (m) return { url: `https://www.wikidata.org/wiki/${m[1]}`, site: 'Wikidata' };
  m = /^gb-(\d{1,12})$/.exec(externalId);
  if (m) return { url: `https://www.giantbomb.com/games/3030-${m[1]}/`, site: 'Giant Bomb' };
  return null;
}
