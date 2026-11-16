// П8.3: данные картинки «Поделиться» (1080×1920) — без JSX и сети, чтобы проверять юнит-тестами.
import type { WrappedResponse } from './types';
import { yearSummary, summaryTiles, type SummaryGame } from '@/ui/wrapped/look';
import { hoursText } from '@/ui/wrapped/model';

export const SHARE_W = 1080;
export const SHARE_H = 1920;
/** Обложки берём только с CDN PSN (как в CSP img-src): адрес из БД не должен вести сервер куда угодно (SSRF). */
export const COVER_HOST = 'image.api.playstation.com';

export function safeCoverUrl(u: string | null | undefined, width: number): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:' || url.hostname !== COVER_HOST || url.username || url.password || url.port) return null;
    url.searchParams.set('w', String(width));
    return url.toString();
  } catch {
    return null;
  }
}

export type ShareModel = {
  year: number;
  /** год ещё идёт (по МСК): «предварительно» на картинке */
  preliminary: boolean;
  nick: string | null;
  hours: string | null;
  hoursLabel: string;
  stats: { value: string; label: string }[];
  goty: (SummaryGame & { kicker: string; cover: string | null }) | null;
  top3: (SummaryGame & { cover: string | null; hoursText: string | null })[];
};

export function shareModel(d: WrappedResponse, mskYearNow: number): ShareModel {
  const s = yearSummary(d);
  const tiles = summaryTiles(s);
  const hoursTile = tiles.find((t) => t.key === 'hours');
  const goty = s.gameOfYear;
  return {
    year: s.year,
    preliminary: s.year >= mskYearNow,
    nick: s.nick,
    hours: hoursTile ? hoursTile.value : null,
    hoursLabel: 'часов в играх',
    stats: tiles.filter((t) => t.key !== 'hours').map((t) => ({ value: t.value, label: t.label })),
    goty: goty ? {
      ...goty,
      kicker: goty.reason === 'rating' && goty.rating !== null ? `Игра года · оценка ${goty.rating} из 10` : 'Игра года',
      cover: safeCoverUrl(goty.coverUrl, 480),
    } : null,
    top3: s.top3.map((g) => ({ ...g, cover: safeCoverUrl(g.coverUrl, 160), hoursText: g.hours !== null ? `${g.estimated ? '≈ ' : ''}${hoursText(g.hours)} ч` : null })),
  };
}

/** Загрузка обложки для картинки: только CDN PSN, таймаут, лимит размера; ошибка = без обложки (плашка с буквой). */
export async function fetchCoverDataUrl(url: string | null, fetchImpl: typeof fetch = fetch, timeoutMs = 3000): Promise<string | null> {
  if (!url || new URL(url).hostname !== COVER_HOST) return null;
  try {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
    const type = r.headers.get('content-type') ?? '';
    if (!r.ok || !/^image\/(png|jpeg)$/.test(type.split(';')[0].trim())) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 2_000_000) return null;
    return `data:${type.split(';')[0].trim()};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}
