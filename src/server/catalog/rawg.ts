// Единственное место с сетью к RAWG (контракт 17.9). Ключ только из env, в ошибки, логи и ответы не попадает.
// Формат ответа по документации rawg.io/apidocs (GET /api/games?search=): { results: [{ id, name, released, tba, background_image, platforms: [{ platform: { name, slug } }] }] }.
// Вживую без ключа не проверялось: разбор оборонительный, неожиданная форма = bad_response, а не пустая выдача.
import { z } from 'zod';

export type CatalogCandidate = {
  externalSource: 'rawg';
  externalId: string;
  title: string;
  releaseDate: string | null;
  coverUrl: string | null;
  platforms: string[];
  playstation: boolean;
};

export type CatalogFailReason = 'no_key' | 'timeout' | 'network' | 'http_error' | 'rate_limited' | 'bad_response';

export class CatalogError extends Error {
  constructor(readonly reason: CatalogFailReason) {
    super(`catalog_${reason}`);
  }
}

export const RAWG_BASE = 'https://api.rawg.io/api/games';
export const RAWG_TIMEOUT_MS = 8000;
export const RAWG_MAX_BYTES = 1_000_000;
export const RAWG_PAGE_SIZE = 10;

export type CatalogDeps = {
  apiKey: string | null;
  /** Инжектируемый fetch для тестов. */
  fetch?: typeof fetch;
  timeoutMs?: number;
};

const raw = z.object({
  id: z.union([z.number(), z.string()]),
  name: z.string(),
  released: z.string().nullable().optional(),
  tba: z.boolean().optional(),
  background_image: z.string().nullable().optional(),
  platforms: z.array(z.object({ platform: z.object({ name: z.string(), slug: z.string().optional() }) })).nullable().optional(),
});
const envelope = z.object({ results: z.array(z.unknown()) });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string): boolean => DATE_RE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export function mapResults(body: unknown): CatalogCandidate[] {
  const env = envelope.safeParse(body);
  if (!env.success) throw new CatalogError('bad_response');
  const out: CatalogCandidate[] = [];
  for (const item of env.data.results) {
    const r = raw.safeParse(item);
    if (!r.success) continue; // одна кривая запись не ломает остальные
    const g = r.data;
    const title = g.name.trim().slice(0, 200);
    const id = String(g.id).trim();
    if (!title || !id || id.length > 64) continue;
    const slugs = (g.platforms ?? []).map((p) => p.platform.slug ?? '');
    const cover = g.background_image;
    out.push({
      externalSource: 'rawg',
      externalId: id,
      title,
      releaseDate: !g.tba && g.released && validDate(g.released) ? g.released : null,
      coverUrl: cover && cover.startsWith('https://') && cover.length <= 2048 ? cover : null,
      platforms: (g.platforms ?? []).map((p) => p.platform.name),
      playstation: slugs.some((s) => s.startsWith('playstation')),
    });
  }
  // Стабильно: PlayStation-версии первыми, внутри групп порядок релевантности RAWG.
  return [...out.filter((c) => c.playstation), ...out.filter((c) => !c.playstation)];
}

export async function searchCatalog(query: string, deps: CatalogDeps): Promise<CatalogCandidate[]> {
  if (!deps.apiKey) throw new CatalogError('no_key');
  const doFetch = deps.fetch ?? fetch;
  const url = new URL(RAWG_BASE);
  url.searchParams.set('key', deps.apiKey);
  url.searchParams.set('search', query);
  url.searchParams.set('page_size', String(RAWG_PAGE_SIZE));

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? RAWG_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await doFetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
    } catch (e) {
      // сообщение исходной ошибки не пробрасываем: оно может содержать URL с ключом
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
    if (text.length > RAWG_MAX_BYTES) throw new CatalogError('bad_response');
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new CatalogError('bad_response');
    }
    return mapResults(body);
  } finally {
    clearTimeout(timer);
  }
}
