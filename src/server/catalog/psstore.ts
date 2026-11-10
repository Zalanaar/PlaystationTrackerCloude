// Запасной каталог для игр PlayStation: поиск PlayStation Store (без ключа), когда RAWG не отвечает.
// Тот же GraphQL-запрос, что делает витрина store.playstation.com (persisted query getSearchResults).
// Форма ответа не документирована: разбор оборонительный, неожиданная форма = bad_response, кривая запись пропускается.
import { z } from 'zod';
import { CatalogError, type CatalogCandidate } from './rawg';
import { baseTitle } from './http';

export const PSSTORE_URL = 'https://web.np.playstation.com/api/graphql/v1/op';
/** Хеш persisted query витрины; если Sony его сменит, ответ станет ошибкой и поиск честно скажет «каталог недоступен». */
export const PSSTORE_SEARCH_HASH = '4df6284f982e57bec70f23c77e2c219dc792eb19af7fb3d3a81767aa3f1958aa';
export const PSSTORE_TIMEOUT_MS = 6000;
export const PSSTORE_MAX_BYTES = 2_000_000;
export const PSSTORE_PAGE_SIZE = 24;
/** Префикс id запасного каталога: id RAWG — числа, пересечений нет; ссылка на rawg.io для таких id не строится. */
export const PSSTORE_ID_PREFIX = 'ps-';

export type PsStoreDeps = { fetch?: typeof fetch; timeoutMs?: number; limit?: number };

const media = z.object({ type: z.string().optional(), role: z.string().optional(), url: z.string() });
const item = z.object({
  id: z.string(),
  name: z.string(),
  __typename: z.string().optional(),
  storeDisplayClassification: z.string().nullable().optional(),
  platforms: z.array(z.string()).nullable().optional(),
  media: z.array(z.unknown()).nullable().optional(),
  releaseDate: z.string().nullable().optional(),
});
const envelope = z.object({ data: z.object({ universalSearch: z.object({ results: z.array(z.unknown()) }) }) });

/** Не игры: дополнения, демо, валюта и т.п. */
const NOT_GAME = new Set(['ADD_ON', 'ADD_ON_PACK', 'CHARACTER', 'COSTUME', 'GAME_LEVEL', 'ITEM', 'VIRTUAL_CURRENCY', 'DEMO', 'THEME', 'AVATAR', 'SOUNDTRACK', 'VIDEO', 'APPLICATION', 'SEASON_PASS']);
const COVER_ROLES = ['MASTER', 'GAMEHUB_COVER_ART', 'EDITION_KEY_ART', 'PORTRAIT_BANNER', 'FOUR_BY_THREE_BANNER'];
const ID_RE = /^[A-Za-z0-9_-]{1,60}$/;
const PLATFORM_NAMES: Record<string, string> = { PS5: 'PlayStation 5', PS4: 'PlayStation 4', PS3: 'PlayStation 3', PSVITA: 'PS Vita', PS_VITA: 'PS Vita' };

/** Ключ для схлопывания изданий одной игры: без «™®», регистра и пунктуации. */
const dedupeKey = (s: string): string => s.toLowerCase().replace(/[™®©]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function cover(list: readonly unknown[] | null | undefined): string | null {
  const imgs = (list ?? []).flatMap((m) => {
    const r = media.safeParse(m);
    if (!r.success || (r.data.type && r.data.type !== 'IMAGE')) return [];
    let u: URL;
    try {
      u = new URL(r.data.url);
    } catch {
      return [];
    }
    if (u.protocol !== 'https:' || u.hostname !== 'image.api.playstation.com' || r.data.url.length > 2048) return [];
    return [{ role: (r.data.role ?? '').toUpperCase(), url: `${u.origin}${u.pathname}` }];
  });
  for (const role of COVER_ROLES) {
    const hit = imgs.find((i) => i.role === role);
    if (hit) return hit.url;
  }
  return imgs[0]?.url ?? null;
}

const DATE_RE = /^(\d{4}-\d{2}-\d{2})/;

/** Разбор ответа: только игры (без дополнений и демо), издания одной игры — одной строкой, порядок витрины. */
export function parsePsStore(body: unknown, limit = 10): CatalogCandidate[] {
  const env = envelope.safeParse(body);
  if (!env.success) throw new CatalogError('bad_response');
  const out: CatalogCandidate[] = [];
  const seen = new Set<string>();
  for (const raw of env.data.data.universalSearch.results) {
    const r = item.safeParse(raw);
    if (!r.success) continue;
    const g = r.data;
    const cls = (g.storeDisplayClassification ?? '').toUpperCase();
    if (NOT_GAME.has(cls)) continue;
    const title = g.name.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!title || !ID_RE.test(g.id)) continue;
    const key = dedupeKey(baseTitle(title));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const plats = (g.platforms ?? []).map((p) => p.toUpperCase());
    const d = g.releaseDate ? DATE_RE.exec(g.releaseDate)?.[1] ?? null : null;
    out.push({
      externalSource: 'rawg',
      externalId: `${PSSTORE_ID_PREFIX}${g.id}`.slice(0, 64),
      title,
      releaseDate: d && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) ? d : null,
      coverUrl: cover(g.media),
      platforms: plats.map((p) => PLATFORM_NAMES[p] ?? p),
      // витрина PlayStation: всё найденное — игры для PlayStation (платформы могут не прийти)
      playstation: true,
      catalog: 'psstore',
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Поиск в PlayStation Store. Ошибки только CatalogError (timeout, network, http_error, rate_limited, bad_response). */
export async function searchPsStore(query: string, deps: PsStoreDeps = {}): Promise<CatalogCandidate[]> {
  const variables = { countryCode: 'US', languageCode: 'en', nextCursor: '', pageOffset: 0, pageSize: PSSTORE_PAGE_SIZE, searchTerm: query };
  const extensions = { persistedQuery: { version: 1, sha256Hash: PSSTORE_SEARCH_HASH } };
  const url = new URL(PSSTORE_URL);
  url.searchParams.set('operationName', 'getSearchResults');
  url.searchParams.set('variables', JSON.stringify(variables));
  url.searchParams.set('extensions', JSON.stringify(extensions));
  const doFetch = deps.fetch ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? PSSTORE_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await doFetch(url, {
        signal: ctl.signal,
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-apollo-operation-name': 'getSearchResults',
          'x-psn-store-locale-override': 'en-US',
          Origin: 'https://store.playstation.com',
          Referer: 'https://store.playstation.com/',
        },
      });
    } catch (e) {
      throw new CatalogError(ctl.signal.aborted || (e instanceof Error && e.name === 'AbortError') ? 'timeout' : 'network');
    }
    if (res.status === 429) throw new CatalogError('rate_limited');
    if (!res.ok) throw new CatalogError('http_error');
    let text: string;
    try {
      text = await res.text();
    } catch {
      throw new CatalogError(ctl.signal.aborted ? 'timeout' : 'network');
    }
    if (text.length > PSSTORE_MAX_BYTES) throw new CatalogError('bad_response');
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new CatalogError('bad_response');
    }
    return parsePsStore(body, deps.limit ?? 10);
  } finally {
    clearTimeout(timer);
  }
}
