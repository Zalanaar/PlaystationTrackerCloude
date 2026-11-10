// Запасной каталог для Switch: поиск Nintendo (searching.nintendo-europe.com, без ключа). Неофициально: форма проверяется.
import { z } from 'zod';
import { CatalogError, type CatalogCandidate } from './rawg';
import { cleanTitle, fetchJson, isoDay, safeImage, titleKey, type SourceDeps } from './http';

const doc = z.object({
  fs_id: z.union([z.string(), z.number()]),
  title: z.string(),
  dates_released_dts: z.array(z.string()).nullable().optional(),
  image_url_sq_s: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  system_names_txt: z.array(z.string()).nullable().optional(),
});
const envelope = z.object({ response: z.object({ docs: z.array(z.unknown()) }) });
const IMG_HOSTS = ['nintendo.com', 'nintendo-europe.com'];

export function parseEshop(body: unknown, limit = 10): CatalogCandidate[] {
  const env = envelope.safeParse(body);
  if (!env.success) throw new CatalogError('bad_response');
  const out: CatalogCandidate[] = [];
  const seen = new Set<string>();
  for (const raw of env.data.response.docs) {
    const r = doc.safeParse(raw);
    if (!r.success) continue;
    const id = String(r.data.fs_id);
    if (!/^\d{1,15}$/.test(id)) continue;
    const title = cleanTitle(r.data.title);
    const key = titleKey(title);
    if (!title || !key || seen.has(key)) continue;
    seen.add(key);
    const systems = (r.data.system_names_txt ?? []).filter((s) => /switch/i.test(s));
    out.push({
      externalSource: 'rawg', externalId: `ns-${id}`, title, releaseDate: isoDay(r.data.dates_released_dts?.[0]),
      coverUrl: safeImage(r.data.image_url_sq_s ?? r.data.image_url, IMG_HOSTS),
      platforms: systems.length ? systems.map(cleanTitle) : ['Nintendo Switch'], playstation: false, catalog: 'eshop',
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function searchEshop(query: string, deps: SourceDeps = {}): Promise<CatalogCandidate[]> {
  const url = new URL('https://searching.nintendo-europe.com/en/select');
  url.searchParams.set('q', query);
  url.searchParams.set('fq', 'type:GAME AND (system_type:nintendoswitch* OR system_type:nintendoswitch2*)');
  url.searchParams.set('rows', String(Math.min(30, (deps.limit ?? 10) * 2)));
  url.searchParams.set('wt', 'json');
  url.searchParams.set('fl', 'fs_id,title,dates_released_dts,image_url_sq_s,image_url,system_names_txt');
  return parseEshop(await fetchJson(url, { headers: { Accept: 'application/json' } }, deps), deps.limit ?? 10);
}
