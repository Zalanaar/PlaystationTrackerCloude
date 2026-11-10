import { describe, expect, it } from 'vitest';
import { catalogPage } from './links';

describe('catalogPage', () => {
  it('ссылки по ключу каталога', () => {
    expect(catalogPage('3498')).toEqual({ url: 'https://rawg.io/games/3498', site: 'RAWG' });
    expect(catalogPage('ps-10002694')?.url).toBe('https://store.playstation.com/en-us/concept/10002694');
    expect(catalogPage('ps-UP9000-PPSA01411_00-0000000000000000')?.url).toBe('https://store.playstation.com/en-us/product/UP9000-PPSA01411_00-0000000000000000');
    expect(catalogPage('steam-1245620')?.url).toBe('https://store.steampowered.com/app/1245620');
    expect(catalogPage('xb-9NBLGGH4R315')?.url).toBe('https://www.xbox.com/en-US/games/store/x/9NBLGGH4R315');
    expect(catalogPage('wd-Q12345')?.url).toBe('https://www.wikidata.org/wiki/Q12345');
    expect(catalogPage('ns-70010000000025')).toBeNull();
    expect(catalogPage('ps-a/b')).toBeNull();
  });
});
