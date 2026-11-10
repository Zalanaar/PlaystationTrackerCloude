// Необязательный каталог: Giant Bomb API (ключ GIANTBOMB_API_KEY). Нет ключа = источник выключен, остальные работают.
import { z } from 'zod';
import { CatalogError, type CatalogCandidate } from './rawg';
import { cleanTitle, fetchJson, isoDay, safeImage, titleKey, USER_AGENT, type SourceDeps } from './http';

const game = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  original_release_date: z.string().nullable().optional(),
  image: z.object({ small_url: z.string().nullable().optional(), medium_url: z.string().nullable().optional() }).nullable().optional(),
  platforms: z.array(z.object({ name: z.string() })).nullable().optional(),
});
const envelope = z.object({ status_code: z.number().optional(), results: z.array(z.unknown()) });

export function parseGiantBomb(body: unknown, limit = 10): CatalogCandidate[] {
  const env = envelope.safeParse(body);
  if (!env.success) throw new CatalogError('bad_response');
  if (env.data.status_code === 100) throw new CatalogError('no_key'); // неверный ключ
  if (env.data.status_code !== undefined && env.data.status_code !== 1) throw new CatalogError('bad_response');
  const out: CatalogCandidate[] = [];
  const seen = new Set<string>();
  for (const raw of env.data.results) {
    const r = game.safeParse(raw);
    if (!r.success) continue;
    const title = cleanTitle(r.data.name);
    const key = titleKey(title);
    if (!title || !key || seen.has(key)) continue;
    seen.add(key);
    const platforms = (r.data.platforms ?? []).map((p) => cleanTitle(p.name)).filter(Boolean);
    out.push({
      externalSource: 'rawg', externalId: `gb-${r.data.id}`, title, releaseDate: isoDay(r.data.original_release_date),
      coverUrl: safeImage(r.data.image?.small_url ?? r.data.image?.medium_url, ['giantbomb.com', 'gamespot.com']),
      platforms, playstation: platforms.some((p) => /playstation [45]/i.test(p)), catalog: 'giantbomb',
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function searchGiantBomb(query: string, apiKey: string | null, deps: SourceDeps = {}): Promise<CatalogCandidate[]> {
  if (!apiKey) throw new CatalogError('no_key');
  const url = new URL('https://www.giantbomb.com/api/search/');
  for (const [k, v] of Object.entries({ api_key: apiKey, format: 'json', query, resources: 'game', limit: String(deps.limit ?? 10), field_list: 'id,name,original_release_date,image,platforms' })) url.searchParams.set(k, v);
  return parseGiantBomb(await fetchJson(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } }, deps), deps.limit ?? 10);
}
