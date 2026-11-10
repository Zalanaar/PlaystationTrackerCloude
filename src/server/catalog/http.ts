// Общий запрос JSON для запасных каталогов: свой таймаут, предел размера, сбой = CatalogError с причиной (без URL и тела).
import { CatalogError } from './rawg';

export type SourceDeps = { fetch?: typeof fetch; timeoutMs?: number; limit?: number };
export const SOURCE_TIMEOUT_MS = 6000;
export const SOURCE_MAX_BYTES = 3_000_000;
export const USER_AGENT = 'PlaystationTracker/1.0 (+https://playstation-tracker-cloude.vercel.app)';

export async function fetchJson(url: URL, init: RequestInit, deps: SourceDeps, maxBytes = SOURCE_MAX_BYTES): Promise<unknown> {
  const doFetch = deps.fetch ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? SOURCE_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await doFetch(url, { cache: 'no-store', ...init, signal: ctl.signal });
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
    if (text.length > maxBytes) throw new CatalogError('bad_response');
    try {
      return JSON.parse(text);
    } catch {
      throw new CatalogError('bad_response');
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Ключ для схлопывания изданий/дублей: без «™®», регистра и пунктуации. */
export const titleKey = (s: string): string => s.toLowerCase().replace(/[™®©]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const EDITION_RE = /[\s:–-]*\b(standard|deluxe|premium|ultimate|gold|complete|definitive|digital deluxe|game of the year|goty|anniversary|launch)\s+edition\b.*$/i;
/** Название без хвоста издания («… Deluxe Edition»): издания одной игры схлопываются в одну строку. */
export const baseTitle = (s: string): string => s.replace(EDITION_RE, '').trim() || s;
/** Дополнения и наборы, не игры (по названию: у неофициальных API типа часто нет). */
export const ADDON_RE = /\b(add-?ons?|dlc|season pass|expansion pass|soundtrack|virtual currency|points pack|costume pack|skin pack)\b/i;
export const cleanTitle = (s: string): string => s.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
const DATE_RE = /^(\d{4}-\d{2}-\d{2})/;
export function isoDay(s: string | null | undefined): string | null {
  const d = s ? DATE_RE.exec(s)?.[1] ?? null : null;
  return d && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) ? d : null;
}
/** https-URL с разрешённого хоста, без мусора; иначе null. */
export function safeImage(raw: unknown, hosts: readonly string[]): string | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) return null;
  return u.toString();
}
