// Запасной каталог для PC: поиск магазина Steam (storesearch, без ключа). Неофициально: форма проверяется, кривые записи пропускаются.
import { z } from 'zod';
import { CatalogError, type CatalogCandidate } from './rawg';
import { ADDON_RE, baseTitle, cleanTitle, fetchJson, safeImage, titleKey, type SourceDeps } from './http';

const item = z.object({ type: z.string().optional(), name: z.string(), id: z.number().int().positive(), tiny_image: z.string().nullable().optional() });
const envelope = z.object({ items: z.array(z.unknown()) });
/** Не игры: саундтреки, инструменты, демо — по слову в названии (тип в выдаче всегда app). */
const NOT_GAME_RE = /\b(soundtrack|ost|dedicated server|sdk|demo|playtest|artbook|wallpaper)\b/i;

export function parseSteam(body: unknown, limit = 10): CatalogCandidate[] {
  const env = envelope.safeParse(body);
  if (!env.success) throw new CatalogError('bad_response');
  const out: CatalogCandidate[] = [];
  const seen = new Set<string>();
  for (const raw of env.data.items) {
    const r = item.safeParse(raw);
    if (!r.success || (r.data.type && r.data.type !== 'app')) continue;
    const title = cleanTitle(r.data.name);
    const key = titleKey(baseTitle(title));
    if (!title || !key || seen.has(key) || NOT_GAME_RE.test(title) || ADDON_RE.test(title)) continue;
    seen.add(key);
    const id = r.data.id;
    out.push({
      externalSource: 'rawg', externalId: `steam-${id}`, title, releaseDate: null,
      // обложка библиотеки (вертикальная); строится по appid
      coverUrl: safeImage(`https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900.jpg`, ['steamstatic.com'])
        ?? safeImage(r.data.tiny_image, ['steamstatic.com']),
      platforms: ['PC'], playstation: false, catalog: 'steam',
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function searchSteam(query: string, deps: SourceDeps = {}): Promise<CatalogCandidate[]> {
  const url = new URL('https://store.steampowered.com/api/storesearch/');
  url.searchParams.set('term', query);
  url.searchParams.set('cc', 'us');
  url.searchParams.set('l', 'english');
  return parseSteam(await fetchJson(url, { headers: { Accept: 'application/json' } }, deps), deps.limit ?? 10);
}
