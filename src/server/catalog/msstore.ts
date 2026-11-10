// Запасной каталог для Xbox: подсказки Microsoft Store (displaycatalog autosuggest, без ключа, неофициально).
import { z } from 'zod';
import { CatalogError, type CatalogCandidate } from './rawg';
import { ADDON_RE, baseTitle, cleanTitle, fetchJson, safeImage, titleKey, type SourceDeps } from './http';

const product = z.object({ ProductId: z.string(), Title: z.string(), Type: z.string().optional(), Icon: z.string().nullable().optional() });
const envelope = z.object({ Results: z.array(z.object({ Products: z.array(z.unknown()).optional() }).passthrough()) });

export function parseMsStore(body: unknown, limit = 10): CatalogCandidate[] {
  const env = envelope.safeParse(body);
  if (!env.success) throw new CatalogError('bad_response');
  const out: CatalogCandidate[] = [];
  const seen = new Set<string>();
  for (const group of env.data.Results) {
    for (const raw of group.Products ?? []) {
      const r = product.safeParse(raw);
      if (!r.success || (r.data.Type && r.data.Type !== 'Game') || !/^[A-Za-z0-9]{6,20}$/.test(r.data.ProductId)) continue;
      const full = cleanTitle(r.data.Title);
      if (ADDON_RE.test(full) || /\bbundle\b/i.test(full) && /add-?ons?/i.test(full)) continue;
      const title = baseTitle(full);
      const key = titleKey(title);
      if (!title || !key || seen.has(key)) continue;
      seen.add(key);
      out.push({
        externalSource: 'rawg', externalId: `xb-${r.data.ProductId.toUpperCase()}`, title, releaseDate: null,
        coverUrl: safeImage(r.data.Icon, ['s-microsoft.com']),
        platforms: ['Xbox'], playstation: false, catalog: 'msstore',
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export async function searchMsStore(query: string, deps: SourceDeps = {}): Promise<CatalogCandidate[]> {
  const url = new URL('https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/autosuggest');
  url.searchParams.set('market', 'US');
  url.searchParams.set('languages', 'en-US');
  url.searchParams.set('query', query);
  url.searchParams.set('productFamilyNames', 'Games');
  url.searchParams.set('mediaType', 'games');
  return parseMsStore(await fetchJson(url, { headers: { Accept: 'application/json' } }, deps), deps.limit ?? 10);
}
