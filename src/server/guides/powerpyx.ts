// F2-B (пакет 3): индекс PowerPyx /guides/ — разбор страницы и детект JS-челленджа. Без сети (сеть — в refresh.ts).
import { guideKey, isDlcTitle } from '@/shared/guide-key';

export const POWERPYX_INDEX_URL = 'https://www.powerpyx.com/guides/';
/** Меньше строк — это не каталог (челлендж, обрезанный ответ, смена разметки): снимок не перезаписываем. */
export const MIN_INDEX_ROWS = 500;
const ORIGIN = 'https://www.powerpyx.com/';

export type GuideEntry = { title: string; titleKey: string; url: string; kind: 'trophy' | 'wiki' };

const ENT: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', rsquo: '’', lsquo: '‘', ndash: '–', mdash: '—', hellip: '…' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}
const text = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/** Ссылка только на сам powerpyx.com по https, без query/фрагмента. */
function cleanUrl(href: string): string | null {
  const h = decodeEntities(href).trim();
  if (!h.startsWith(ORIGIN)) return null;
  try {
    const u = new URL(h);
    if (u.protocol !== 'https:' || u.hostname !== 'www.powerpyx.com' || u.pathname === '/') return null;
    return `${u.origin}${u.pathname}`;
  } catch { return null; }
}

/**
 * Строки таблицы индекса: первая ссылка ячейки — гайд по трофеям (название игры), ссылка «Wiki» — вики того же названия.
 * DLC, пустые названия и чужие ссылки пропускаются; дубли URL — один раз.
 */
export function parseGuideIndex(html: string): GuideEntry[] {
  const out: GuideEntry[] = [];
  const seen = new Set<string>();
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cell = /<td[^>]*class="[^"]*column-1[^"]*"[^>]*>([\s\S]*?)<\/td>/i.exec(row[1]);
    if (!cell) continue;
    const links = [...cell[1].matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
    if (links.length === 0) continue;
    const title = text(links[0][2]);
    if (!title || isDlcTitle(title)) continue;
    const titleKey = guideKey(title);
    if (!titleKey) continue;
    links.forEach((a, i) => {
      const kind = i === 0 ? 'trophy' : /^wiki$/i.test(text(a[2])) ? 'wiki' : null;
      const url = kind ? cleanUrl(a[1]) : null;
      if (!kind || !url || seen.has(url)) return;
      seen.add(url);
      out.push({ title, titleKey, url, kind });
    });
  }
  return out;
}

export type IndexCheck = { ok: true; entries: GuideEntry[] } | { ok: false; outcome: 'challenge' | 'too_few' };

/** Ответ — настоящий каталог? Челлендж «One moment, please…» / `cf-mitigated` / мало строк → нет. */
export function checkIndexResponse(headers: Headers, html: string): IndexCheck {
  if (headers.has('cf-mitigated')) return { ok: false, outcome: 'challenge' };
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';
  if (/one moment/i.test(title) || /just a moment/i.test(title)) return { ok: false, outcome: 'challenge' };
  const entries = parseGuideIndex(html);
  if (entries.filter((e) => e.kind === 'trophy').length < MIN_INDEX_ROWS) return { ok: false, outcome: 'too_few' };
  return { ok: true, entries };
}
