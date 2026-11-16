import { describe, expect, it, vi } from 'vitest';
import type { WrappedResponse } from './types';
import { fetchCoverDataUrl, safeCoverUrl, shareModel, SHARE_H, SHARE_W } from './share';
import { renderShareImage } from './share-image';

const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const cdn = (n: number) => `https://image.api.playstation.com/vulcan/c${n}.png`;
const g = (id: number, title: string, coverUrl: string | null = cdn(id)) => ({ id, title, coverUrl }) as never;
const data = (o: Partial<WrappedResponse> = {}): WrappedResponse => ({
  year: 2026, mode: 'story', scope: 'year', period: { from: null, to: null, fromUtc: null, toUtc: null }, years: [], profile: { onlineId: 'Zalanaar26', avatarUrl: null },
  firstSnapshotDate: null, periodPartial: true, slides: [],
  hours: { hasData: true, total: 412.4, days: 17, byMonth: [], estimatedByMonth: [], estimatedHours: 0, hasEstimate: false, topMonth: null },
  topGames: { hasData: true, items: [['Astro Bot', 53], ['Final Fantasy VII Rebirth', 46], ['Hades II', 39]].map(([t, h], i) => ({ rank: i + 1, seconds: 1, hours: h as number, estimated: false, game: g(i + 1, t as string, i === 2 ? 'https://evil.example/x.png' : cdn(i + 1)) })) },
  finished: { hasData: true, completed: { count: 12, items: [] }, dropped: { count: 3, items: [] }, busiestMonth: null },
  trophies: { hasData: true, counts: { platinum: 7, gold: 31, silver: 88, bronze: 240, total: 366 }, platinum: { first: null, last: null, rarest: null }, rare: [] },
  genres: { hasData: false, items: [] },
  longestGame: { hasData: false, seconds: 0, hours: 0, estimated: false, playCount: 0, game: null },
  emptyState: null,
  bestGame: { hasData: true, rating: 10, hours: 40, estimated: false, game: g(1, 'Astro Bot') },
  ...o,
}) as WrappedResponse;

describe('картинка «Поделиться» (П8.3)', () => {
  it('обложки только с CDN PSN по https, без логина/порта; ширина в w', () => {
    expect(safeCoverUrl(cdn(1), 160)).toBe(`${cdn(1)}?w=160`);
    for (const bad of ['http://image.api.playstation.com/a.png', 'https://evil.example/a.png', 'https://u:p@image.api.playstation.com/a.png', 'https://image.api.playstation.com:8443/a.png', 'javascript:alert(1)', '', null]) expect(safeCoverUrl(bad, 160)).toBeNull();
  });
  it('модель: часы, пройдено/платины/трофеи, игра года по оценке, топ-3; текущий год — «предварительно», прошлый — нет', () => {
    const m = shareModel(data(), 2026);
    expect(m).toMatchObject({ year: 2026, preliminary: true, nick: 'Zalanaar26', hours: '412,4' });
    expect(m.stats).toEqual([{ value: '12', label: 'игр пройдено' }, { value: '7', label: 'платин' }, { value: '366', label: 'трофеев' }]);
    expect(m.goty).toMatchObject({ title: 'Astro Bot', kicker: 'Игра года · оценка 10 из 10', cover: `${cdn(1)}?w=480` });
    expect(m.top3.map((x) => [x.title, x.hoursText, x.cover])).toEqual([['Astro Bot', '53 ч', `${cdn(1)}?w=160`], ['Final Fantasy VII Rebirth', '46 ч', `${cdn(2)}?w=160`], ['Hades II', '39 ч', null]]);
    expect(shareModel(data({ year: 2025 }), 2026).preliminary).toBe(false);
  });
  it('загрузка обложки: таймаут/ошибка/не картинка/чужой хост = null, без исключения', async () => {
    const ok = vi.fn(async () => new Response(PNG1, { headers: { 'content-type': 'image/png' } }));
    expect(await fetchCoverDataUrl(cdn(1), ok as never)).toMatch(/^data:image\/png;base64,/);
    expect(await fetchCoverDataUrl('https://evil.example/x.png', ok as never)).toBeNull();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(await fetchCoverDataUrl(cdn(1), (async () => new Response('<html>', { headers: { 'content-type': 'text/html' } })) as never)).toBeNull();
    expect(await fetchCoverDataUrl(cdn(1), (async () => { throw new Error('timeout'); }) as never)).toBeNull();
  });
  it('рендер: PNG 1080×1920 с кириллицей, private no-store, без публичного кэша', async () => {
    const f = vi.fn(async () => new Response(PNG1, { headers: { 'content-type': 'image/png' } }));
    const res = await renderShareImage(shareModel(data(), 2026), f as never);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(1, 4).toString()).toBe('PNG');
    expect([buf.readUInt32BE(16), buf.readUInt32BE(20)]).toEqual([SHARE_W, SHARE_H]);
    if (process.env.SHARE_PNG) (await import('node:fs')).writeFileSync(process.env.SHARE_PNG, buf);
  }, 30_000);
});
