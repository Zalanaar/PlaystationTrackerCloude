// item 4: облегчённые данные HTML первого экрана `/` — без полей, которые на `/` не рисуются; src/ui их там не читает.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CollectionInitial, GameItem } from './types';
import { slimGame, slimInitial } from './slim';

const full = (over: Partial<GameItem> = {}): GameItem => ({
  id: 7, title: 'Game', coverUrl: 'https://image.api.playstation.com/c.png', bannerUrl: 'https://image.api.playstation.com/b.jpg', tint: '#112233',
  platform: 'PS5', playSeconds: 3600, hours: 1, playCount: 2, lastPlayedAt: '2026-10-01T00:00:00.000Z', status: 'completed',
  completedAt: '2026-10-02T00:00:00.000Z', droppedAt: null,
  trophies: { earned: 1, defined: 2, progress: 50, platinumDefined: true, platinumEarned: false, byType: { platinum: { earned: 0, defined: 1 }, gold: { earned: 0, defined: 0 }, silver: { earned: 0, defined: 0 }, bronze: { earned: 1, defined: 1 } } },
  genres: [{ key: 'ACTION', label: 'Экшен' }], hiddenAt: null,
  duration: { hours: 6, source: 'hltb', bucket: 'lt10', remainingHours: 5, progress: 0.2, overrideHours: null, hltb: { status: 'found', id: 1, name: 'Game', mainHours: 6, extraHours: 7, checkedAt: '2026-10-01T00:00:00.000Z' } },
  linkedVersions: [], duplicateOfGameId: null, ...over,
});

describe('slimGame', () => {
  it('оставляет поля карточки, героя и строки, убирает длительность, трофеи по типам, баннер не «Играю»', () => {
    const s = slimGame(full());
    expect(s).toEqual({
      id: 7, title: 'Game', coverUrl: full().coverUrl, bannerUrl: null, tint: '#112233', platform: 'PS5', playSeconds: 3600, hours: 1, playCount: 2,
      lastPlayedAt: full().lastPlayedAt, status: 'completed', completedAt: full().completedAt, droppedAt: null,
      trophies: { earned: 1, defined: 2, progress: 50, platinumDefined: true, platinumEarned: false }, genres: full().genres,
    });
    expect(JSON.stringify(s).length).toBeLessThan(JSON.stringify(full()).length * 0.6);
  });
  it('«Играю» сохраняет баннер; непустые версии, скрытие и дубль остаются; без трофеев null', () => {
    const lv = [{ gameId: 8, title: 'Game PS4', platform: 'PS4' as const, hours: 2 }];
    const s = slimGame(full({ status: 'playing', linkedVersions: lv, hiddenAt: '2026-10-03T00:00:00.000Z', duplicateOfGameId: 3, trophies: null, tint: null }));
    expect(s.bannerUrl).toBe(full().bannerUrl);
    expect(s.linkedVersions).toEqual(lv);
    expect(s.hiddenAt).toBe('2026-10-03T00:00:00.000Z');
    expect(s.duplicateOfGameId).toBe(3);
    expect(s.trophies).toBeNull();
    expect('tint' in s).toBe(false);
  });
  it('slimInitial: флаг slim, сводка без continue/services, пакет облегчён, упавший блок как есть', () => {
    const list = { items: [full()], total: 1, limit: 20, offset: 0, counts: {}, years: [2026], forgottenCount: 0, durationCounts: {}, genreCounts: {}, hltbCounts: {} } as unknown as import('./types').GamesListResponse;
    const init = {
      summaryUrl: '/api/collection/summary', batchUrl: '/api/games/batch?b=x', now: 0, inbox: null,
      summary: { totals: {}, counts: {}, profile: null, playing: [full({ status: 'playing' })], services: [full()], continue: [full()], nearPlatinum: [{ game: full(), forecast: { setId: 1 } }] },
      batch: { results: [{ ok: true, data: list }, { ok: false, code: 'db_unavailable' }] },
    } as unknown as CollectionInitial;
    const s = slimInitial(init);
    expect(s.slim).toBe(true);
    expect(s.summary.services).toEqual([]);
    expect(s.summary.continue).toEqual([]);
    expect(s.summary.playing[0].bannerUrl).toBe(full().bannerUrl);
    expect(s.summary.nearPlatinum[0].forecast).toEqual({ setId: 1 });
    expect(s.summary.nearPlatinum[0].game.duration).toBeUndefined();
    const r0 = s.batch.results[0];
    expect(r0.ok && r0.data.items[0].duration).toBeUndefined();
    expect(r0.ok && r0.data.years).toEqual([2026]);
    expect(s.batch.results[1]).toEqual({ ok: false, code: 'db_unavailable' });
    expect(init.summary.services).toHaveLength(1); // исходник не мутирован
  });
});

/** Где src/ui читает поля, которых нет в облегчённых данных. Новый читатель на `/` = облегчённая игра без поля: проверь и допиши сюда. */
const ALLOWED: Record<string, RegExp> = {
  byType: /^$/, // нигде
  duration: /^src\/ui\/(collection\/(Backlog\w*|NextUpCard|DurationEditor|backlog|manual|dialog\/\w+)|wrapped\/\w+)\.tsx?$/,
  bannerUrl: /^src\/ui\/collection\/(PlayingHero|dialog\/\w+|GameDialog)\.tsx?$/,
  services: /^$/,
  continue: /^$/,
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

describe('src/ui не читает облегчённые поля вне разрешённых мест', () => {
  it.each(Object.keys(ALLOWED))('%s', (field) => {
    const re = new RegExp(`\\.${field}\\b`);
    const bad = files('src/ui').filter((f) => re.test(readFileSync(f, 'utf8')) && !ALLOWED[field].test(f));
    expect(bad).toEqual([]);
  });
});
